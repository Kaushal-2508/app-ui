import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchExamEligibleStudentIds, filterToEligible } from "@/lib/examEligibility";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { getDisplayName } from "@/lib/displayName";
import { sortStudentRoster } from "@/lib/studentIdentity";
import { requireCurrentUser } from "@/lib/auth";
import { toastError } from "@/lib/toast";

export interface OfflineMarkRow {
  studentId: string;
  fullName: string;
  rollNumber: string | null;
  admissionNumber: string | null;
  classId: string;
  className: string | null;
  classSection: string | null;
  markId: string | null;
  marksObtained: number | null;
  /**
   * Teacher explicitly marked the student absent. Distinct from a null
   * `marksObtained`, which means "not entered yet" — telling those two apart is
   * the whole point of the flag. The DB enforces that they cannot both be set.
   */
  isAbsent: boolean;
  isPublished: boolean;
}

/** A row the teacher has actually decided on: a mark, or an explicit absence. */
export function isMarkRowDecided(row: {
  marksObtained: number | null;
  isAbsent: boolean;
}): boolean {
  return row.isAbsent || row.marksObtained != null;
}

export interface OfflineMarksExam {
  id: string;
  title: string;
  totalMarks: number;
  passMarks: number | null;
  /**
   * The exam's own status, not the marks' publication state. A draft or
   * archived exam cannot receive attempts at all (validate_attempt_creation
   * refuses them), so marks entered against one can never be saved. The
   * screen has to say so instead of letting the teacher type into a dead end.
   */
  status: string | null;
  isOffline: boolean;
  /** First class label — preserved for legacy callers. Use `classes` for the full list. */
  className: string | null;
  classSection: string | null;
  /** Every class the exam spans, in the same order as exam_classes. */
  classes: Array<{ id: string; name: string; section: string | null }>;
  subjectName: string | null;
}

export interface OfflineMarksData {
  exam: OfflineMarksExam;
  rows: OfflineMarkRow[];
}

/** Page size for the roster/marks reads. Well under PostgREST's silent 1000 cap. */
const ROSTER_PAGE_SIZE = 500;

export function useOfflineMarks(examId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.offlineMarks(examId),
    enabled: !!examId,
    // Marks entry is a single teacher editing their own screen; the server copy
    // does not change under them, and every mutation invalidates this key.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<OfflineMarksData> => {
      const { data: exam, error: examErr } = await supabase
        .from("exams")
        .select(
          `id, title, total_marks, pass_marks, status,
           exam_classes(class_id),
           exam_subjects(subject_id, universal_subjects(id, name))`
        )
        .eq("id", examId!)
        .single();
      if (examErr || !exam) throw examErr || new Error("Exam not found");

      const examRow = exam as unknown as {
        id: string;
        title: string;
        total_marks: number | null;
        pass_marks: number | null;
        status: string | null;
        exam_classes: Array<{ class_id: string }>;
        exam_subjects: Array<{
          subject_id: string;
          universal_subjects?: { id: string; name: string } | null;
        }>;
      };

      const classIds = (examRow.exam_classes || []).map((c) => c.class_id);

      // Fetch class names/sections with a dedicated query rather than the
      // nested exam_classes(classes(...)) join — PostgREST returns the
      // nested target as either an object or a single-element array depending
      // on cardinality detection, which silently produces undefined .name and
      // collapsed sort buckets when the exam spans multiple sections.
      const classInfoMap = new Map<string, { name: string; section: string | null }>();
      if (classIds.length > 0) {
        const { data: classRows, error: classErr } = await supabase
          .from("classes")
          .select("id, name, section")
          .in("id", classIds);
        if (classErr) throw classErr;
        ((classRows as Array<{ id: string; name: string; section: string | null }> | null) || [])
          .forEach((c) => {
            classInfoMap.set(c.id, { name: c.name, section: c.section ?? null });
          });
      }

      let students: Array<{
        user_id: string;
        class_id: string;
        profiles: { id: string; full_name: string | null; roll_number: string | null; admission_number: string | null } | null;
      }> = [];
      if (classIds.length > 0) {
        // Paged: an exam can span many sections, and PostgREST silently
        // truncates at 1000 rows — a truncated roster here would look exactly
        // like "those students aren't enrolled" and their marks would be lost.
        const classStudents: Array<Record<string, unknown>> = [];
        for (let from = 0; ; from += ROSTER_PAGE_SIZE) {
          const { data: page, error: studentsErr } = await supabase
            .from("class_assignments")
            .select(
              `user_id, class_id,
               profiles!class_assignments_user_id_fkey(id, full_name, roll_number, admission_number)`
            )
            .in("class_id", classIds)
            .eq("role", "student")
            .order("user_id", { ascending: true })
            .range(from, from + ROSTER_PAGE_SIZE - 1);
          if (studentsErr) throw studentsErr;
          const rows = (page as unknown as Array<Record<string, unknown>>) ?? [];
          classStudents.push(...rows);
          if (rows.length < ROSTER_PAGE_SIZE) break;
        }
        students = classStudents.map(
          (r) => ({
            user_id: r.user_id as string,
            class_id: r.class_id as string,
            profiles: r.profiles as {
              id: string;
              full_name: string | null;
              roll_number: string | null;
              admission_number: string | null;
            } | null,
          })
        );

        // Optional-subject filtering: drop students for whom this exam covers
        // only optional subjects they're not enrolled in. No-op for compulsory
        // / no-subject exams (everyone stays). See P4 migration.
        //
        // PAGED (fetchExamEligibleStudentIds): the roster above pages in 500s
        // because PostgREST truncates at 1000 silently, so an unpaged
        // eligibility set intersected with it would start deleting genuinely
        // eligible students past the cap — the filter failing in the direction
        // that looks like data loss.
        const eligibleSet = await fetchExamEligibleStudentIds(examId!);
        students = filterToEligible(students, (s) => s.user_id, eligibleSet).kept;
      }

      // Paged for the same reason as the roster: a silently truncated page here
      // would render already-entered marks as blank, and re-publishing would
      // overwrite them.
      const marks: Array<Record<string, unknown>> = [];
      for (let from = 0; ; from += ROSTER_PAGE_SIZE) {
        const { data: page, error: marksErr } = await supabase
          .from("offline_student_marks")
          .select("id, student_id, marks_obtained, is_absent, is_published")
          .eq("exam_id", examId!)
          .order("student_id", { ascending: true })
          .range(from, from + ROSTER_PAGE_SIZE - 1);
        if (marksErr) throw marksErr;
        const rows = (page as unknown as Array<Record<string, unknown>>) ?? [];
        marks.push(...rows);
        if (rows.length < ROSTER_PAGE_SIZE) break;
      }

      const markMap = new Map<
        string,
        { id: string; marks_obtained: number | null; is_absent: boolean; is_published: boolean }
      >();
      ((marks as unknown as Array<{
        id: string;
        student_id: string;
        marks_obtained: number | null;
        is_absent: boolean | null;
        is_published: boolean | null;
      }>) || []).forEach((m) => {
        markMap.set(m.student_id, {
          id: m.id,
          marks_obtained: m.marks_obtained == null ? null : Number(m.marks_obtained),
          is_absent: !!m.is_absent,
          is_published: !!m.is_published,
        });
      });

      const rows: OfflineMarkRow[] = students
        .map((s) => {
          const existing = markMap.get(s.user_id);
          const classInfo = classInfoMap.get(s.class_id);
          return {
            studentId: s.user_id,
            fullName: getDisplayName(s.profiles),
            rollNumber: s.profiles?.roll_number || null,
            admissionNumber: s.profiles?.admission_number || null,
            classId: s.class_id,
            className: classInfo?.name ?? null,
            classSection: classInfo?.section ?? null,
            markId: existing?.id ?? null,
            marksObtained: existing?.marks_obtained ?? null,
            isAbsent: existing?.is_absent ?? false,
            isPublished: existing?.is_published ?? false,
          };
        });

      // Block per section (keyed on classId — UUIDs are unique per section, so
      // sections stay contiguous even when their display names collide). Each
      // section independently reads in roll order or alphabetically.
      const orderedRows = sortStudentRoster(rows, {
        getRoll: (r) => r.rollNumber,
        getName: (r) => r.fullName,
        getGroupKey: (r) => r.classId,
        // Order the section blocks by display name so the user-facing sequence
        // is intuitive (Class 6-B before Class 6-C); same-name siblings fall
        // back to the classId tiebreak so they don't interleave.
        compareGroups: (a, b) => {
          const nameCmp = (a.className ?? "").localeCompare(b.className ?? "");
          if (nameCmp !== 0) return nameCmp;
          const sectionCmp = (a.classSection ?? "").localeCompare(b.classSection ?? "");
          if (sectionCmp !== 0) return sectionCmp;
          return a.classId.localeCompare(b.classId);
        },
      });

      const firstClassInfo = classIds.length > 0 ? classInfoMap.get(classIds[0]) : null;
      const firstSubject = examRow.exam_subjects?.[0]?.universal_subjects || null;
      const allClasses = classIds
        .map((id) => {
          const info = classInfoMap.get(id);
          return info ? { id, name: info.name, section: info.section } : null;
        })
        .filter((c): c is { id: string; name: string; section: string | null } => c !== null);

      return {
        exam: {
          id: examRow.id,
          title: examRow.title,
          totalMarks: Number(examRow.total_marks ?? 0),
          passMarks: examRow.pass_marks == null ? null : Number(examRow.pass_marks),
          status: examRow.status ?? null,
          isOffline: true,
          className: firstClassInfo?.name ?? null,
          classSection: firstClassInfo?.section ?? null,
          classes: allClasses,
          subjectName: firstSubject?.name ?? null,
        },
        rows: orderedRows,
      };
    },
  });
}

// A single-row draft upsert hook (with a raw toast.error, against section 19)
// used to sit here; it had no consumers and was removed on 2026-10-05 (Task 8).
// Drafts go through useSaveDraftOfflineMarks, live corrections through
// useUpdateOfflineMark.

/** PostgREST silently caps a response at 1000 rows, so bound every batch. */
const PUBLISH_BATCH_SIZE = 200;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Publishes a set of offline marks into the shared results plane.
 *
 * Batched deliberately: this used to run three sequential round-trips PER
 * STUDENT (select attempt, insert attempt, upsert result). A 40-student class
 * meant ~120 serialized requests, and adding absent students to the publish set
 * would only have made that worse. It is now a fixed handful of batched calls
 * regardless of class size.
 *
 * The writes stay on the client, under the existing RLS policies, rather than
 * moving into a SECURITY DEFINER RPC: that would mean re-implementing the
 * publish authority check by hand, and a wrong one is a privilege-escalation
 * bug. The tradeoff is that this is not one transaction — a mid-way failure
 * leaves earlier batches published, which the caller surfaces as an error so
 * the teacher can re-publish (every write is an idempotent upsert, so
 * re-running is safe).
 */
async function publishFinalResults(
  examId: string,
  rows: ReadonlyArray<{
    studentId: string;
    classId: string;
    marksObtained: number | null;
    isAbsent: boolean;
  }>,
  totalMax: number,
  passMarks: number | null,
  userId: string,
) {
  if (rows.length === 0) return;

  // 1. Resolve existing attempts for every student in one batched read.
  const attemptIdByStudent = new Map<string, string>();
  for (const batch of chunk(rows, PUBLISH_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("student_exam_attempts")
      .select("id, student_id")
      .eq("exam_id", examId)
      .in("student_id", batch.map((r) => r.studentId));
    if (error) throw error;
    for (const a of data ?? []) attemptIdByStudent.set(a.student_id, a.id);
  }

  // 2. Create the attempts that don't exist yet, in one batched insert.
  const missing = rows.filter((r) => !attemptIdByStudent.has(r.studentId));
  for (const batch of chunk(missing, PUBLISH_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("student_exam_attempts")
      .insert(
        batch.map((r) => ({
          exam_id: examId,
          student_id: r.studentId,
          class_id: r.classId,
          is_offline: true,
          is_submitted: true,
          submitted_at: new Date().toISOString(),
          evaluation_status: "teacher_reviewed" as const,
        })),
      )
      .select("id, student_id");
    if (error) throw error;
    for (const a of data ?? []) attemptIdByStudent.set(a.student_id, a.id);
  }

  // 3. Upsert the results themselves.
  const now = new Date().toISOString();
  const resultRows = rows.map((r) => {
    const attemptId = attemptIdByStudent.get(r.studentId);
    if (!attemptId) throw new Error("Failed to resolve attempt");
    const marks = r.isAbsent ? 0 : Number(r.marksObtained ?? 0);
    return {
      attempt_id: attemptId,
      total_marks_obtained: marks,
      total_max_marks: totalMax,
      // An absent student did not pass. Recorded explicitly rather than left to
      // the `marks >= passMarks` comparison, which a pass mark of 0 would make
      // read as a pass.
      is_pass: r.isAbsent ? false : passMarks != null ? marks >= passMarks : null,
      is_absent: r.isAbsent,
      is_published: true,
      published_at: now,
      published_by: userId,
      finalized_by: userId,
      finalized_at: now,
      // NEVER write `percentage` — it is a GENERATED column and including it
      // silently drops the whole row (CLAUDE.md §9).
    };
  });

  for (const batch of chunk(resultRows, PUBLISH_BATCH_SIZE)) {
    const { error } = await supabase
      .from("final_results")
      .upsert(batch, { onConflict: "attempt_id" });
    if (error) throw error;
  }
}

export function useSaveDraftOfflineMarks(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: OfflineMarkRow[]) => {
      const user = await requireCurrentUser();

      // An explicit absence is a decision worth saving, exactly like a mark.
      const decided = rows.filter(isMarkRowDecided);
      if (decided.length === 0) return { saved: 0 };

      const payload = decided.map((r) => ({
        exam_id: examId,
        student_id: r.studentId,
        marks_obtained: r.isAbsent ? null : r.marksObtained,
        is_absent: r.isAbsent,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }));

      for (const batch of chunk(payload, PUBLISH_BATCH_SIZE)) {
        const { error } = await supabase
          .from("offline_student_marks")
          .upsert(batch, {
            onConflict: "exam_id,student_id",
          });
        if (error) throw error;
      }
      return { saved: decided.length };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offlineMarks(examId) });
      if (res.saved > 0) {
        toast.success(`Draft saved (${res.saved})`);
      }
    },
    onError: (err: Error) => {
      toastError(err, { fallback: "Couldn't save the draft.", context: "saveDraftOfflineMarks" });
    },
  });
}

export function usePublishAllOfflineMarks(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rows,
      totalMax,
      passMarks,
    }: {
      rows: OfflineMarkRow[];
      totalMax: number;
      passMarks: number | null;
      /**
       * "update" = results are already live and the teacher is correcting or
       * completing them. Same write-through (marks + final_results), different
       * wording. A draft-only save on a published exam would leave
       * final_results stale, so this is the ONLY save path once published.
       */
      intent?: "publish" | "update";
    }) => {
      const user = await requireCurrentUser();

      // Absent students publish too — that is the point of the flag. Leaving
      // them out is what made "absent" and "not marked yet" look identical.
      const decided = rows.filter(isMarkRowDecided);
      if (decided.length === 0) {
        throw new Error("Enter at least one mark, or mark a student absent, before publishing");
      }

      const markPayload = decided.map((r) => ({
        exam_id: examId,
        student_id: r.studentId,
        marks_obtained: r.isAbsent ? null : r.marksObtained,
        is_absent: r.isAbsent,
        is_published: true,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }));

      for (const batch of chunk(markPayload, PUBLISH_BATCH_SIZE)) {
        const { error: upsertErr } = await supabase
          .from("offline_student_marks")
          .upsert(batch, {
            onConflict: "exam_id,student_id",
          });
        if (upsertErr) throw upsertErr;
      }

      await publishFinalResults(examId, decided, totalMax, passMarks, user.id);

      return {
        published: decided.length,
        absent: decided.filter((r) => r.isAbsent).length,
      };
    },
    onSuccess: (res, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offlineMarks(examId) });
      queryClient.invalidateQueries({ queryKey: ["student-results"] });
      const absentNote = res.absent > 0 ? ` (${res.absent} absent)` : "";
      const verb = vars.intent === "update" ? "Updated" : "Published";
      toast.success(`${verb} results for ${res.published} student(s)${absentNote}`);
    },
    onError: (err: Error, vars) => {
      toastError(err, {
        fallback:
          vars.intent === "update"
            ? "Couldn't update these results."
            : "Couldn't publish these results.",
        context: "publishOfflineMarks",
      });
    },
  });
}

export function useUpdateOfflineMark(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      row,
      totalMax,
      passMarks,
    }: {
      row: OfflineMarkRow;
      totalMax: number;
      passMarks: number | null;
    }) => {
      const user = await requireCurrentUser();
      if (!isMarkRowDecided(row)) {
        throw new Error("Enter a mark, or mark the student absent, before saving");
      }

      const { error } = await supabase
        .from("offline_student_marks")
        .upsert(
          {
            exam_id: examId,
            student_id: row.studentId,
            marks_obtained: row.isAbsent ? null : row.marksObtained,
            is_absent: row.isAbsent,
            is_published: true,
            created_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "exam_id,student_id" }
        );
      if (error) throw error;

      await publishFinalResults(examId, [row], totalMax, passMarks, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offlineMarks(examId) });
      queryClient.invalidateQueries({ queryKey: ["student-results"] });
    },
    onError: (err: Error) => {
      toastError(err, { fallback: "Couldn't update this mark.", context: "updateOfflineMark" });
    },
  });
}
