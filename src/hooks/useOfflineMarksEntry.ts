import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast";
import { translateError } from "@/lib/errorMessages";
import { queryKeys } from "@/lib/queryKeys";
import { getDisplayName } from "@/lib/displayName";
import { getCurrentUser } from "@/lib/auth";
import { sortStudentRoster } from "@/lib/studentIdentity";

type OfflineSectionMarkRow = Pick<
  Database["public"]["Tables"]["offline_section_marks"]["Row"],
  "attempt_id" | "section_id" | "marks_obtained" | "is_absent"
>;
type OfflineSectionMarkInsert =
  Database["public"]["Tables"]["offline_section_marks"]["Insert"];
type StudentExamAttemptInsert =
  Database["public"]["Tables"]["student_exam_attempts"]["Insert"];
type FinalResultInsert = Database["public"]["Tables"]["final_results"]["Insert"];

export interface OfflineMarksSection {
  id: string;
  title: string;
  totalMarks: number;
  sectionOrder: number;
}

export interface OfflineMarksStudentRow {
  studentId: string;
  fullName: string;
  rollNumber: string | null;
  admissionNumber: string | null;
  classId: string;
  className: string | null;
  attemptId: string | null;
  isAbsent: boolean;
  sectionMarks: Record<string, number>; // sectionId -> marks
  isRevised?: boolean;
  /** This student's result is already visible to them. Saving must never flip
   *  it back to unpublished as a side effect. */
  isPublished: boolean;
}

export interface OfflineMarksData {
  exam: {
    id: string;
    title: string;
    totalMarks: number;
    passMarks: number | null;
    resultVisibility: string;
    /** The "Already Created" flow: a paper that already happened, whose marks
     *  are being typed up after the fact. There is no reason to withhold those
     *  from students, so the publish control defaults ON for these. */
    isResultsOnly: boolean;
    /** First linked subject, for the header line. Mirrors useOfflineMarks. */
    subjectName: string | null;
    /**
     * The exam's own status, not the marks' publication state. A draft or
     * archived exam cannot receive attempts at all (validate_attempt_creation
     * refuses them), so marks entered against one can never be saved.
     */
    status: string | null;
  };
  sections: OfflineMarksSection[];
  students: OfflineMarksStudentRow[];
  /** Class members hidden because they aren't enrolled in this exam's optional
   *  subject. Lets the UI say "nobody has chosen this subject yet" instead of
   *  showing a bare empty grid. */
  ineligibleCount: number;
  /** At least one result is already published. Drives the publish control so
   *  it can't read "off" while students can already see their marks. */
  anyPublished: boolean;
}

/**
 * Loads all data needed for the offline marks entry screen:
 * - Exam sections (with max marks)
 * - Students mapped to the exam via exam_classes → class_assignments
 * - Existing attempts + offline_section_marks so previously-entered values hydrate
 */
export function useOfflineMarksEntry(examId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.offlineSectionMarks(examId),
    enabled: !!examId,
    queryFn: async (): Promise<OfflineMarksData> => {
      // 1. Exam + sections
      const { data: exam, error: examErr } = await supabase
        .from("exams")
        .select(
          `id, title, total_marks, pass_marks, status, result_visibility, is_results_only,
           exam_subjects(subject_id, universal_subjects(id, name)),
           exam_sections(id, title, total_marks, section_order),
           exam_classes(class_id, classes(id, name))`
        )
        .eq("id", examId!)
        .single();
      if (examErr || !exam) throw examErr || new Error("Exam not found");

      const examRow = exam as unknown as {
        id: string;
        title: string;
        total_marks: number | null;
        pass_marks: number | null;
        result_visibility: string | null;
        status: string | null;
        is_results_only: boolean | null;
        exam_subjects?: Array<{ subject_id: string; universal_subjects?: { id: string; name: string } | null }>;
        exam_sections: Array<{ id: string; title: string; total_marks: number | null; section_order: number }>;
        exam_classes: Array<{ class_id: string; classes?: { id: string; name: string } | null }>;
      };

      const sections: OfflineMarksSection[] = (examRow.exam_sections || [])
        .map((s) => ({
          id: s.id,
          title: s.title,
          totalMarks: Number(s.total_marks ?? 0),
          sectionOrder: s.section_order,
        }))
        .sort((a, b) => a.sectionOrder - b.sectionOrder);

      const classIds = (examRow.exam_classes || []).map((c) => c.class_id);
      const classNameMap = new Map<string, string>();
      (examRow.exam_classes || []).forEach((c) => {
        if (c.classes) classNameMap.set(c.class_id, c.classes.name);
      });

      // 2. Students enrolled in any of these classes
      let students: Array<{
        student_id: string;
        class_id: string;
        profiles: { id: string; full_name: string | null; roll_number: string | null; admission_number: string | null } | null;
      }> = [];
      if (classIds.length > 0) {
        const { data: classStudents, error: studentsErr } = await supabase
          .from("class_assignments")
          .select(
            `user_id, class_id,
             profiles!class_assignments_user_id_fkey(id, full_name, roll_number, admission_number)`
          )
          .in("class_id", classIds)
          .eq("role", "student")
          // Explicit bound: a filter is not a bound, and PostgREST truncates at
          // 1000 silently. One exam's classes never approach this.
          .range(0, 999);
        if (studentsErr) throw studentsErr;
        students = ((classStudents as unknown as Array<Record<string, unknown>>) || []).map((r) => ({
          student_id: r.user_id as string,
          class_id: r.class_id as string,
          profiles: r.profiles as {
            id: string;
            full_name: string | null;
            roll_number: string | null;
            admission_number: string | null;
          } | null,
        }));
      }

      // Optional-subject eligibility. An exam whose subjects are all optional
      // is only sat by the students enrolled in them, and the P3 trigger
      // (trg_enforce_exam_subject_enrollment) rejects attempt inserts for
      // anyone else with 42501 — so an unfiltered grid dies mid-save. One
      // server-side set per exam, no N+1. Same helper the sibling
      // useOfflineMarks already uses. No-op for compulsory / unlinked exams.
      let ineligibleCount = 0;
      if (students.length > 0) {
        const { data: eligible, error: eligErr } = await supabase.rpc(
          "exam_marking_eligible_students",
          { _exam: examId! },
        );
        if (eligErr) throw eligErr;
        const eligibleSet = new Set<string>(
          ((eligible as Array<{ student_id: string }> | null) ?? []).map((e) => e.student_id),
        );
        const beforeCount = students.length;
        students = students.filter((s) => eligibleSet.has(s.student_id));
        ineligibleCount = beforeCount - students.length;
      }

      // 3. Existing attempts
      const { data: attempts, error: attemptsErr } = await supabase
        .from("student_exam_attempts")
        .select("id, student_id, class_id")
        .eq("exam_id", examId!)
        .range(0, 999);
      if (attemptsErr) throw attemptsErr;
      const attemptMap = new Map<string, string>();
      ((attempts as unknown as Array<{ id: string; student_id: string }>) || []).forEach((a) => {
        attemptMap.set(a.student_id, a.id);
      });

      // 4. Existing offline_section_marks
      const attemptIds = Array.from(attemptMap.values());
      const marksRows: Array<{ attempt_id: string; section_id: string; marks_obtained: number; is_absent: boolean }> = [];
      if (attemptIds.length > 0) {
        // students × sections easily clears PostgREST's 1000-row cap on a
        // multi-class exam, and a truncated response silently drops already
        // saved marks out of the grid (they'd read as blank and get
        // overwritten on the next save). Page until exhausted.
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data: marksPage, error: marksErr } = await supabase
            .from("offline_section_marks")
            .select("attempt_id, section_id, marks_obtained, is_absent")
            .in("attempt_id", attemptIds)
            .range(from, from + PAGE - 1);
          if (marksErr) throw marksErr;
          const pageRows = (marksPage as OfflineSectionMarkRow[]) || [];
          marksRows.push(...pageRows);
          if (pageRows.length < PAGE) break;
        }
      }

      // 5. Published state per attempt. Without this the publish control reads
      //    "off" on every reopen and the next save silently unpublishes results
      //    students could already see.
      const publishedAttempts = new Set<string>();
      if (attemptIds.length > 0) {
        const { data: frRows, error: frErr } = await supabase
          .from("final_results")
          .select("attempt_id, is_published")
          .in("attempt_id", attemptIds)
          .range(0, 999);
        if (frErr) throw frErr;
        ((frRows as Array<{ attempt_id: string; is_published: boolean | null }> | null) ?? []).forEach(
          (r) => {
            if (r.is_published) publishedAttempts.add(r.attempt_id);
          },
        );
      }

      const studentRows: OfflineMarksStudentRow[] = students.map((s) => {
        const attemptId = attemptMap.get(s.student_id) || null;
        const studentMarks = attemptId
          ? marksRows.filter((m) => m.attempt_id === attemptId)
          : [];
        const sectionMarks: Record<string, number> = {};
        let isAbsent = false;
        studentMarks.forEach((m) => {
          sectionMarks[m.section_id] = Number(m.marks_obtained);
          if (m.is_absent) isAbsent = true;
        });

        return {
          studentId: s.student_id,
          fullName: getDisplayName(s.profiles),
          rollNumber: s.profiles?.roll_number || null,
          admissionNumber: s.profiles?.admission_number || null,
          classId: s.class_id,
          className: classNameMap.get(s.class_id) || null,
          attemptId,
          isAbsent,
          sectionMarks,
          isPublished: attemptId ? publishedAttempts.has(attemptId) : false,
        };
      });

      // One block per section: a fully-numbered section reads in roll order, a
      // section still missing roll numbers reads alphabetically (ERP order).
      const orderedStudentRows = sortStudentRoster(studentRows, {
        getRoll: (r) => r.rollNumber,
        getName: (r) => r.fullName,
        getGroupKey: (r) => r.className ?? "",
      });

      return {
        exam: {
          id: examRow.id,
          title: examRow.title,
          totalMarks: Number(examRow.total_marks ?? 0),
          passMarks: examRow.pass_marks,
          resultVisibility: examRow.result_visibility || "after_teacher_releases",
          isResultsOnly: !!examRow.is_results_only,
          subjectName: examRow.exam_subjects?.[0]?.universal_subjects?.name ?? null,
          status: examRow.status ?? null,
        },
        sections,
        students: orderedStudentRows,
        ineligibleCount,
        anyPublished: studentRows.some((s) => s.isPublished),
      };
    },
  });
}

/**
 * Saves offline marks for all students in one atomic batch.
 * - Creates student_exam_attempts if missing
 * - Upserts offline_section_marks rows
 * - Recomputes final_results
 */
export function useSaveOfflineMarks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      examId,
      students,
      sections,
      passMarks,
      publishResults,
    }: {
      examId: string;
      students: OfflineMarksStudentRow[];
      sections: OfflineMarksSection[];
      passMarks: number | null;
      publishResults: boolean;
    }) => {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      // Re-check eligibility at save time: the grid can sit open while a
      // student's optional choice changes. Skipping the ineligible keeps the
      // batch from tripping the 42501 trigger part-way through.
      const { data: eligible, error: eligErr } = await supabase.rpc(
        "exam_marking_eligible_students",
        { _exam: examId },
      );
      if (eligErr) throw eligErr;
      const eligibleSet = new Set<string>(
        ((eligible as Array<{ student_id: string }> | null) ?? []).map((e) => e.student_id),
      );
      const targets = students.filter((s) => eligibleSet.has(s.studentId));
      const skippedCount = students.length - targets.length;

      // PERF-DEBT: each student is three sequential writes and the batch is not
      // a transaction, so a mid-loop failure leaves earlier students committed.
      // Moving this to one RPC is the real fix. Until then failures are
      // collected and named, so a partial save reports exactly who is missing
      // instead of a generic toast over a half-written grid.
      const failed: string[] = [];
      // The underlying cause MUST survive to the toast. A bare `catch {}` here
      // hid an RLS rejection on final_results behind "Saved 0 of N. Please
      // retry" for two days across multiple schools — nobody could see why.
      let firstError: unknown = null;

      for (const student of targets) {
        try {
        // Ensure attempt exists
        let attemptId = student.attemptId;
        if (!attemptId) {
          const attemptInsert: StudentExamAttemptInsert = {
            exam_id: examId,
            student_id: student.studentId,
            class_id: student.classId,
            is_offline: true,
            is_submitted: true,
            submitted_at: new Date().toISOString(),
            evaluation_status: "teacher_reviewed",
          };

          const { data: newAttempt, error: createErr } = await supabase
            .from("student_exam_attempts")
            .insert(attemptInsert)
            .select("id")
            .single();
          if (createErr || !newAttempt) throw createErr || new Error("Failed to create attempt");
          attemptId = newAttempt.id;
        }

        if (!attemptId) throw new Error("Failed to resolve attempt");

        // Upsert section marks
        const sectionRows: OfflineSectionMarkInsert[] = sections.map((sec) => ({
          attempt_id: attemptId,
          section_id: sec.id,
          marks_obtained: student.isAbsent ? 0 : Number(student.sectionMarks[sec.id] ?? 0),
          is_absent: student.isAbsent,
          entered_by: user.id,
        }));
        const { error: upsertErr } = await supabase
          .from("offline_section_marks")
          .upsert(sectionRows, {
            onConflict: "attempt_id,section_id",
          });
        if (upsertErr) throw upsertErr;

        // Compute total + write final_results
        const totalObtained = student.isAbsent
          ? 0
          : sections.reduce((sum, sec) => sum + Number(student.sectionMarks[sec.id] ?? 0), 0);
        const totalMax = sections.reduce((sum, sec) => sum + sec.totalMarks, 0);
        const isPass = passMarks != null ? totalObtained >= passMarks : null;

        const sectionScores: Record<string, number> = {};
        sections.forEach((sec) => {
          sectionScores[sec.id] = student.isAbsent ? 0 : Number(student.sectionMarks[sec.id] ?? 0);
        });

        // Publishing is one-way here: correcting marks must never revoke a
        // result the student can already see. The publish control defaults to
        // off on every reopen, so writing `is_published: publishResults`
        // blindly silently unpublished on the next save. Un-publishing has to
        // be a deliberate action, not a side effect of editing.
        const alreadyPublished = student.isPublished === true;
        const nowPublished = publishResults || alreadyPublished;

        const finalResultRow: FinalResultInsert = {
          attempt_id: attemptId,
          total_marks_obtained: totalObtained,
          total_max_marks: totalMax,
          // Absence has to reach the published record, not just the section
          // marks. Without this the student shows up as a genuine 0, which is
          // the ambiguity the Absent toggle exists to remove.
          is_absent: student.isAbsent,
          // An absent student did not pass. Stated explicitly because the
          // `0 >= passMarks` comparison reads as a pass when passMarks is 0.
          is_pass: student.isAbsent ? false : isPass,
          section_scores: sectionScores as unknown as Json,
          is_published: nowPublished,
          finalized_by: user.id,
          finalized_at: new Date().toISOString(),
        };
        // Only stamp publisher/date on the transition, so the original
        // publication time survives later corrections.
        if (!alreadyPublished) {
          finalResultRow.published_at = nowPublished ? new Date().toISOString() : null;
          finalResultRow.published_by = nowPublished ? user.id : null;
        }

        const { error: resultErr } = await supabase
          .from("final_results")
          .upsert(finalResultRow, { onConflict: "attempt_id" });
        if (resultErr) throw resultErr;
        } catch (e) {
          failed.push(student.fullName);
          if (firstError === null) firstError = e;
          console.error(`[saveOfflineMarks] ${student.fullName}:`, e);
        }
      }

      if (failed.length > 0) {
        const shown = failed.slice(0, 3).join(", ");
        const more = failed.length > 3 ? ` and ${failed.length - 3} more` : "";
        // Translated (never raw Postgres, §19) so the toast names the cause.
        const reason = translateError(firstError, "Unknown error").title;
        throw new Error(
          `Saved ${targets.length - failed.length} of ${targets.length}. Couldn't save marks for ${shown}${more}. Reason: ${reason} Saved students keep their marks.`,
        );
      }

      return { savedCount: targets.length, skippedCount };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offlineSectionMarks(vars.examId) });
      toast({
        title: "Marks saved",
        description:
          `Saved marks for ${result.savedCount} student(s).` +
          (result.skippedCount > 0
            ? ` ${result.skippedCount} not enrolled in this optional subject were skipped.`
            : ""),
      });
    },
    onError: (err: Error) => {
      toastError(err, { fallback: "Couldn't save marks.", context: "saveOfflineMarks" });
    },
  });
}

/**
 * Flags a student result for recheck.
 */
export function useFlagForRecheck() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      attemptId,
      reason,
    }: {
      attemptId: string;
      reason: string;
    }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not authenticated");

      // Find the final_results row for this attempt
      const { data: finalResult, error: frErr } = await supabase
        .from("final_results")
        .select("id")
        .eq("attempt_id", attemptId)
        .maybeSingle();
      if (frErr) throw frErr;
      if (!finalResult) throw new Error("Final result not yet saved for this student");

      const recheckInsert: Database["public"]["Tables"]["recheck_requests"]["Insert"] = {
        result_id: finalResult.id,
        requested_by: auth.user.id,
        request_reason: reason || "Teacher-initiated recheck",
        status: "pending",
      };
      const { error } = await supabase.from("recheck_requests").insert(recheckInsert);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recheck-requests"] });
      toast({ title: "Flagged for recheck" });
    },
    onError: (err: Error) => {
      toastError(err, { fallback: "Couldn't flag for recheck.", context: "flagForRecheck" });
    },
  });
}
