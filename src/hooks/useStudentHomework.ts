import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useScopedStudentId } from "@/contexts/StudentScopeContext";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { uploadResumable } from "@/lib/storageUpload";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

const BUCKET = "homework-files";

type SubjectRef = { id: string; name: string };
type ClassRef = { id: string; name: string; section: string | null };

export interface StudentHomeworkRow {
  id: string;
  title: string;
  description: string | null;
  status: "published" | "checked";
  carries_marks: boolean;
  /** Marked assignment whose marks the teacher enters directly (no online submission). */
  offline_marks: boolean;
  max_marks: number | null;
  due_at: string;
  visible_from: string;
  /** true while now < visible_from — description/attachment are withheld server-side. */
  locked: boolean;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  checked_at: string | null;
  subject: SubjectRef | null;
  subjects: SubjectRef[];
  classes: ClassRef[];
  submission: { id: string; submitted_at: string; is_late: boolean } | null;
  result: { marks_awarded: number | null; feedback: string | null; status: string } | null;
}

/** Pending + Completed list. Server-side feed includes pre-window (locked)
 *  assignments with description/attachment withheld until they open. */
export function useStudentHomework() {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-homework", user?.id, scopedId ?? "self"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentHomeworkRow[]> => {
      // homework_student_feed (SECURITY DEFINER) returns every assigned
      // published/checked assignment for this student, with a `locked` flag and
      // sensitive fields nulled while locked, plus the student's own submission/
      // result. One round trip; no client-side join.
      const { data, error } = scopedId
        ? await supabase.rpc("homework_student_feed_for", { p_student_id: scopedId })
        : await supabase.rpc("homework_student_feed");
      if (error) throw error;
      return (data as unknown as StudentHomeworkRow[]) ?? [];
    },
  });
}

/** A single assignment for the student detail page (reuses the list shape). */
export function useStudentHomeworkDetail(homeworkId: string | undefined) {
  const list = useStudentHomework();
  const row = list.data?.find((r) => r.id === homeworkId) ?? null;
  return { row, isLoading: list.isLoading, error: list.error };
}

/** Signed URL via the homework-file-url edge fn (teacher attachment or any submission file).
 *  This is a single-flight MUTATION — its result object identity changes on every call, so it
 *  is ONLY safe for one-shot click handlers (e.g. "Download attachment"). NEVER pass
 *  `.mutateAsync` as a SubmissionFileViewer `getUrl`: the viewer's thumbnail effect depends on
 *  getUrl, and the changing identity drives an infinite render loop. Use
 *  useHomeworkFileUrlResolver() for that. */
export function useHomeworkFileUrl() {
  return useMutation({
    mutationFn: async (
      arg: { homework_assignment_id: string } | { submission_file_id: string },
    ): Promise<string> => {
      const res = await invokeEdgeFunction<{ url: string }>("homework-file-url", arg);
      return res.url;
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't open the file.", context: "homeworkFileUrl" }),
  });
}

/** A referentially-stable signed-URL resolver via the homework-file-url edge fn. Safe to pass as
 *  a SubmissionFileViewer `getUrl` (a thumbnail-effect dependency) and to call concurrently for
 *  many files — unlike useHomeworkFileUrl (a mutation whose object identity changes per call,
 *  which drives an infinite render loop). Errors propagate to the caller (the viewer shows a
 *  broken-thumbnail icon or toasts on download) — no auto-toast here, to avoid per-thumbnail spam. */
export function useHomeworkFileUrlResolver() {
  return useCallback(
    async (
      arg: { homework_assignment_id: string } | { submission_file_id: string },
    ): Promise<string> => {
      const res = await invokeEdgeFunction<{ url: string }>("homework-file-url", arg);
      return res.url;
    },
    [],
  );
}

/** Upload files to the private bucket then record the submission via submit-homework. */
export function useSubmitHomework() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      homeworkId,
      institutionId,
      files,
    }: {
      homeworkId: string;
      institutionId: string;
      files: File[];
    }) => {
      if (!user?.id) throw new Error("Not authenticated");
      if (files.length === 0) throw new Error("Attach at least one file.");
      if (files.length > 10) throw new Error("You can attach at most 10 files.");
      const uploaded: { path: string; name: string; mime: string; size: number }[] = [];
      for (const file of files) {
        const safeName = file.name.replace(/[^\w.-]+/g, "_");
        const path = `${institutionId}/submissions/${homeworkId}/${user.id}/${crypto.randomUUID()}-${safeName}`;
        await uploadResumable({
          bucket: BUCKET,
          path,
          file,
          contentType: file.type || "application/octet-stream",
        });
        uploaded.push({
          path,
          name: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
        });
      }
      return invokeEdgeFunction<{ submission_id: string; is_late: boolean; file_count: number }>(
        "submit-homework",
        { homework_assignment_id: homeworkId, files: uploaded },
      );
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["student-homework"] });
      toast.success(res.is_late ? "Submitted (marked late)" : "Submitted");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't submit your work.", context: "submitHomework" }),
  });
}
