import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface MarkingRosterRow {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  class_id: string;
  class_name: string;
  class_section: string | null;
  submission_id: string | null;
  submitted_at: string | null;
  is_late: boolean;
  result_status: "pending" | "graded" | "skipped" | null;
  marks_awarded: number | null;
  feedback: string | null;
}

export interface MarkingAssignment {
  id: string;
  title: string;
  status: "draft" | "published" | "checked";
  carries_marks: boolean;
  offline_marks: boolean;
  max_marks: number | null;
  due_at: string;
  visible_from: string;
  checked_at: string | null;
  description: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  subject: { id: string; name: string } | null;
  subjects: { id: string; name: string }[];
  classes: { id: string; name: string; section: string | null }[];
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** The assignment header (managers SELECT via RLS can_manage). */
export function useHomeworkMarkingAssignment(homeworkId: string | undefined) {
  return useQuery({
    queryKey: ["homework", homeworkId, "marking-assignment"],
    enabled: !!homeworkId,
    staleTime: 60_000,
    queryFn: async (): Promise<MarkingAssignment | null> => {
      const { data, error } = await supabase
        .from("homework_assignments")
        .select(`id, title, status, carries_marks, offline_marks, max_marks, due_at, visible_from, checked_at,
                 description, attachment_path, attachment_name, attachment_mime,
                 subject:subject_id ( id, name ),
                 homework_assignment_subjects ( universal_subjects ( id, name ) ),
                 homework_assignment_classes ( classes ( id, name, section ) )`)
        .eq("id", homeworkId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const r = data as unknown as Record<string, unknown>;
      return {
        id: r.id as string,
        title: r.title as string,
        status: r.status as MarkingAssignment["status"],
        carries_marks: r.carries_marks as boolean,
        offline_marks: (r.offline_marks as boolean) ?? false,
        max_marks: (r.max_marks as number | null) ?? null,
        due_at: r.due_at as string,
        visible_from: r.visible_from as string,
        checked_at: (r.checked_at as string | null) ?? null,
        description: (r.description as string | null) ?? null,
        attachment_path: (r.attachment_path as string | null) ?? null,
        attachment_name: (r.attachment_name as string | null) ?? null,
        attachment_mime: (r.attachment_mime as string | null) ?? null,
        subject: pickOne(r.subject as { id: string; name: string } | { id: string; name: string }[] | null),
        subjects: (() => {
          const fromJoin = ((r.homework_assignment_subjects as Array<{ universal_subjects: { id: string; name: string } | { id: string; name: string }[] | null }>) ?? [])
            .map((j) => pickOne(j.universal_subjects))
            .filter((s): s is { id: string; name: string } => s !== null);
          if (fromJoin.length > 0) return fromJoin;
          const primary = pickOne(r.subject as { id: string; name: string } | { id: string; name: string }[] | null);
          return primary ? [primary] : [];
        })(),
        classes: (
          ((r.homework_assignment_classes as Array<{ classes: { id: string; name: string; section: string | null } | { id: string; name: string; section: string | null }[] | null }>) ?? [])
            .map((j) => pickOne(j.classes))
            .filter((c): c is { id: string; name: string; section: string | null } => c !== null)
        ),
      };
    },
  });
}

// The generated RPC return type has non-nullable fields for columns that may be
// NULL in practice (submission_id, submitted_at, result_status, marks_awarded,
// feedback, roll_number, class_section are all nullable server-side for
// students who haven't submitted). We map through a narrow structural type to
// avoid `any` while safely coercing the non-nullable generated type.
type RpcRosterRow = {
  student_id: string;
  full_name: string;
  roll_number: string;
  class_id: string;
  class_name: string;
  class_section: string;
  submission_id: string;
  submitted_at: string;
  is_late: boolean;
  result_status: string;
  marks_awarded: number;
  feedback: string;
};

function mapRosterRow(row: RpcRosterRow): MarkingRosterRow {
  return {
    student_id: row.student_id,
    full_name: row.full_name,
    roll_number: row.roll_number ?? null,
    class_id: row.class_id,
    class_name: row.class_name,
    class_section: row.class_section ?? null,
    submission_id: row.submission_id ?? null,
    submitted_at: row.submitted_at ?? null,
    is_late: row.is_late ?? false,
    result_status: (row.result_status as MarkingRosterRow["result_status"]) ?? null,
    marks_awarded: row.marks_awarded ?? null,
    feedback: row.feedback ?? null,
  };
}

/** Full roster (submitted + not-submitted) via the SECURITY DEFINER RPC. */
export function useHomeworkMarkingRoster(homeworkId: string | undefined) {
  return useQuery({
    queryKey: ["homework", homeworkId, "roster"],
    enabled: !!homeworkId,
    staleTime: 30_000,
    queryFn: async (): Promise<MarkingRosterRow[]> => {
      const { data, error } = await supabase.rpc("homework_marking_roster", {
        _homework_id: homeworkId!,
      });
      if (error) throw error;
      return ((data ?? []) as RpcRosterRow[]).map(mapRosterRow);
    },
  });
}

/** Submission files for the page's submitters (managers SELECT via RLS). */
export function useHomeworkSubmissionFiles(submissionIds: string[]) {
  const sortedIds = [...submissionIds].sort();
  return useQuery({
    queryKey: ["homework", "submission-files", sortedIds],
    enabled: submissionIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_submission_files")
        .select("id, submission_id, file_name, file_mime, storage_path")
        .in("submission_id", submissionIds);
      if (error) throw error;
      const map = new Map<
        string,
        { id: string; name: string; mime: string; storagePath: string }[]
      >();
      (data ?? []).forEach((f) => {
        const arr = map.get(f.submission_id) ?? [];
        arr.push({
          id: f.id,
          name: f.file_name,
          mime: f.file_mime,
          storagePath: f.storage_path,
        });
        map.set(f.submission_id, arr);
      });
      return map;
    },
  });
}

/** Upsert one result (mark / feedback / skip). Audit trigger logs who/old/new. */
export function useUpsertHomeworkResult() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (arg: {
      homeworkId: string;
      submissionId: string;
      studentId: string;
      marksAwarded?: number | null;
      feedback?: string | null;
      status: "graded" | "skipped";
    }) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await supabase.from("homework_results").upsert(
        {
          submission_id: arg.submissionId,
          homework_assignment_id: arg.homeworkId,
          student_id: arg.studentId,
          marks_awarded: arg.status === "skipped" ? null : (arg.marksAwarded ?? null),
          feedback: arg.feedback ?? null,
          status: arg.status,
          evaluated_by: user.id,
          evaluated_at: new Date().toISOString(),
        },
        { onConflict: "submission_id" },
      );
      if (error) throw error;
    },
    onSuccess: (_d, arg) => {
      qc.invalidateQueries({ queryKey: ["homework", arg.homeworkId, "roster"] });
      qc.invalidateQueries({ queryKey: ["homework"] });
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't save the mark.",
        context: "upsertHomeworkResult",
      }),
  });
}

/** Publish marks / mark-as-checked (gated server-side). */
export function usePublishHomeworkMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (homeworkId: string) => {
      const { error } = await supabase.rpc("homework_publish_marks", {
        _homework_id: homeworkId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, homeworkId) => {
      qc.invalidateQueries({ queryKey: ["homework", homeworkId] });
      qc.invalidateQueries({ queryKey: ["homework"] });
      toast.success("Published. Students can now see their results");
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't publish. Make sure every submission is marked.",
        context: "publishHomeworkMarks",
      }),
  });
}

export interface RosterMarkInput {
  student_id: string;
  marks_awarded: number | null;
  feedback: string | null;
}

/** Bulk/single upsert of roster marks — offline assignments and non-submitter /
 *  late entry. Writes via the homework_upsert_roster_marks SECURITY DEFINER RPC,
 *  keyed on (assignment, student), so it works for students with no submission. */
export function useUpsertRosterMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arg: { homeworkId: string; marks: RosterMarkInput[] }) => {
      const { error } = await supabase.rpc("homework_upsert_roster_marks", {
        _homework_id: arg.homeworkId,
        _marks: arg.marks as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: (_d, arg) => {
      qc.invalidateQueries({ queryKey: ["homework", arg.homeworkId, "roster"] });
      qc.invalidateQueries({ queryKey: ["homework"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't save the marks.", context: "upsertRosterMarks" }),
  });
}
