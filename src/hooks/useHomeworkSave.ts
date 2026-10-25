import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { currentAcademicYearActive } from "@/lib/timetableCompat";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import type { HomeworkFormData, SaveHomeworkResult } from "@/types/homework";

export function useSaveHomework() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { institutionId } = useEffectiveInstitution();

  return useMutation({
    mutationFn: async ({ formData, publish = false }: { formData: HomeworkFormData; publish?: boolean }): Promise<SaveHomeworkResult> => {
      if (!user?.id) throw new Error("Not authenticated");
      const inst = formData.institutionId ?? institutionId;
      if (!inst) throw new Error("No institution context");

      // Validation guards — satisfy NOT NULL / CHECK constraints and narrow types
      const title = formData.title.trim();
      if (!title) throw new Error("Please enter a title.");
      const subjectIds = [...new Set(formData.subjectIds)];
      if (subjectIds.length === 0) throw new Error("Please pick at least one subject.");
      const primarySubjectId = subjectIds[0];
      if (formData.dueAt <= formData.visibleFrom) throw new Error("Due date must be after the visible-from date.");

      let homeworkId = formData.homeworkId;

      // Draft upsert: if we already have a draft id, verify it's still a draft.
      if (homeworkId) {
        const { data: existing, error } = await supabase
          .from("homework_assignments").select("id, status").eq("id", homeworkId).single();
        if (error || !existing) { homeworkId = undefined; }
        else if (existing.status !== "draft") { throw new Error("This assignment is locked. Create a new one."); }
      }

      const academicYear = await currentAcademicYearActive(inst);
      const row = {
        institution_id: inst,
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
        academic_year: academicYear,
      };

      if (homeworkId) {
        const { error } = await supabase.from("homework_assignments").update(row).eq("id", homeworkId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("homework_assignments").insert({ ...row, status: "draft", created_by: user.id }).select("id").single();
        if (error) throw error;
        homeworkId = data.id;
      }

      // Class junction: delete-then-insert (idempotent for the draft-update path).
      await supabase.from("homework_assignment_classes").delete().eq("homework_assignment_id", homeworkId);
      const uniqueClassIds = [...new Set(formData.classIds)];
      if (uniqueClassIds.length > 0) {
        const links = uniqueClassIds.map((class_id) => ({ homework_assignment_id: homeworkId!, class_id }));
        const { error } = await supabase.from("homework_assignment_classes").insert(links);
        if (error) throw error;
      }

      // Subject junction: same delete-then-insert. subject_id (primary) is
      // already on the row; this stores the full set, including the primary.
      await supabase.from("homework_assignment_subjects").delete().eq("homework_assignment_id", homeworkId);
      const subjectLinks = subjectIds.map((subject_id) => ({
        homework_assignment_id: homeworkId!,
        subject_id,
      }));
      const { error: subjErr } = await supabase
        .from("homework_assignment_subjects")
        .insert(subjectLinks);
      if (subjErr) throw subjErr;

      if (publish) {
        const { error } = await supabase.from("homework_assignments").update({ status: "published" }).eq("id", homeworkId);
        if (error) throw error;
      }

      return { homeworkId: homeworkId!, status: publish ? "published" : "draft" };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["homework"] });
      qc.invalidateQueries({ queryKey: ["homework-drafts"] });
      toast.success(result.status === "published" ? "Homework published" : "Draft saved");
    },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't save the homework.", context: "saveHomework" }),
  });
}
