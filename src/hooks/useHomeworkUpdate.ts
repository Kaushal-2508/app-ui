import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import type { HomeworkFormData, SaveHomeworkResult } from "@/types/homework";

export function useUpdateHomework() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ homeworkId, formData, publish = false }:
      { homeworkId: string; formData: HomeworkFormData; publish?: boolean }): Promise<SaveHomeworkResult> => {
      if (!user?.id) throw new Error("Not authenticated");
      // Validation guards — satisfy NOT NULL / CHECK constraints and narrow types
      const title = formData.title.trim();
      if (!title) throw new Error("Please enter a title.");
      const subjectIds = [...new Set(formData.subjectIds)];
      if (subjectIds.length === 0) throw new Error("Please pick at least one subject.");
      const primarySubjectId = subjectIds[0];
      if (formData.dueAt <= formData.visibleFrom) throw new Error("Due date must be after the visible-from date.");

      const { data: updated, error: upErr } = await supabase.from("homework_assignments").update({
        subject_id: primarySubjectId,
        title,
        description: formData.description.trim() || null,
        carries_marks: formData.carriesMarks,
        max_marks: formData.carriesMarks ? formData.maxMarks : null,
        offline_marks: formData.carriesMarks ? formData.offlineMarks : false,
        attachment_path: formData.attachmentPath,
        attachment_name: formData.attachmentName,
        attachment_mime: formData.attachmentMime,
        visible_from: formData.visibleFrom.toISOString(),
        due_at: formData.dueAt.toISOString(),
      }).eq("id", homeworkId).select("id");
      if (upErr) throw upErr;
      if (!updated || updated.length === 0) throw new Error("You don't have permission to edit this assignment, or it's locked.");

      await supabase.from("homework_assignment_classes").delete().eq("homework_assignment_id", homeworkId);
      const uniqueClassIds = [...new Set(formData.classIds)];
      if (uniqueClassIds.length > 0) {
        const { error } = await supabase.from("homework_assignment_classes")
          .insert(uniqueClassIds.map((class_id) => ({ homework_assignment_id: homeworkId, class_id })));
        if (error) throw error;
      }

      await supabase.from("homework_assignment_subjects").delete().eq("homework_assignment_id", homeworkId);
      const { error: subjErr } = await supabase.from("homework_assignment_subjects")
        .insert(subjectIds.map((subject_id) => ({ homework_assignment_id: homeworkId, subject_id })));
      if (subjErr) throw subjErr;

      if (publish) {
        const { error } = await supabase.from("homework_assignments").update({ status: "published" }).eq("id", homeworkId);
        if (error) throw error;
      }
      return { homeworkId, status: publish ? "published" : "draft" };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["homework"] });
      qc.invalidateQueries({ queryKey: ["homework", r.homeworkId] });
      qc.invalidateQueries({ queryKey: ["homework-drafts"] });
      toast.success(r.status === "published" ? "Homework published" : "Changes saved");
    },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't update the homework.", context: "updateHomework" }),
  });
}
