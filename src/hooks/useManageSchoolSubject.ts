import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { logActivityEvent } from "@/lib/activityLog";
import { resolveClassGroupIdFromClassId } from "@/lib/subjectCode";
import { deleteInstitutionSubject, unassignSubjectFromClass } from "@/lib/subjectAdmin";

function bustSubjectCaches(queryClient: ReturnType<typeof useQueryClient>) {
  invalidateSyllabusCache(queryClient);
  queryClient.invalidateQueries({ queryKey: ["class-group-subjects"] });
  queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
  queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
}

interface DeleteSubjectInput {
  subjectId: string;
  subjectName: string;
  institutionId: string;
  className?: string;
}

/**
 * Permanent hard-delete of a school-owned (institute) subject, via the
 * transactional `delete_institution_subject` RPC: it authorizes the caller,
 * names every blocker (homework, optional batches, student remarks, locked
 * exams) BEFORE touching anything, removes the subject's teacher assignments
 * in the same transaction (the FK is ON DELETE SET NULL, which would otherwise
 * strand subject-less rows), verifies the delete landed, and writes the audit
 * row server-side. A blocked delete now changes nothing at all.
 * NEVER call this for a Global subject (institution_id IS NULL) — the RPC
 * refuses them, but route those through useRemoveSubjectFromClass instead.
 */
export function useDeleteSchoolSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteSubjectInput) =>
      deleteInstitutionSubject(input.subjectId, input.className ?? null),
    onSuccess: (result) => {
      bustSubjectCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
      toast.success(
        result.assignments_removed > 0
          ? `Subject deleted (${result.assignments_removed} teacher assignment${result.assignments_removed !== 1 ? "s" : ""} removed)`
          : "Subject deleted",
      );
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't delete the subject.", context: "deleteSchoolSubject" }),
  });
}

interface RemoveSubjectInput {
  subjectId: string;
  subjectName: string;
  classId: string; // the section the user is viewing
  institutionId: string;
  className?: string;
}

/**
 * Unassign a subject from a class without touching universal_subjects. Used for
 * Global subjects (and any case where we must not delete the shared row).
 * The `unassign_subject_from_class` RPC clears the class_group mapping (trigger
 * fans out to scm), residual legacy section mappings, AND the teacher
 * assignments for that subject — all in one transaction. Leaving assignments
 * behind is what blanks out a teacher's portal while still looking assigned.
 */
export function useRemoveSubjectFromClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RemoveSubjectInput) =>
      unassignSubjectFromClass(input.subjectId, input.classId),
    onSuccess: (result) => {
      bustSubjectCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
      toast.success(
        result.assignments_removed > 0
          ? `Subject removed from class (${result.assignments_removed} teacher assignment${result.assignments_removed !== 1 ? "s" : ""} removed)`
          : "Subject removed from class",
      );
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't remove the subject.", context: "removeSubjectFromClass" }),
  });
}

interface UpdateSubjectInput {
  subjectId: string;
  name: string;
  category: string | null;
  institutionId: string;
  classId: string; // for duplicate-name scoping within the class_group
}

/** Rename + recategorise a school-owned subject. Code is left unchanged. */
export function useUpdateSchoolSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSubjectInput) => {
      const trimmed = input.name.trim();
      if (!trimmed) throw new Error("Subject name is required.");
      const nameLower = trimmed.toLowerCase();

      const classGroupId = await resolveClassGroupIdFromClassId(input.classId);
      if (classGroupId) {
        const { data: existing, error: existingError } = await supabase
          .from("subject_class_group_mappings" as never)
          .select("subject_id, universal_subjects!inner(name, is_active)")
          .eq("class_group_id", classGroupId);
        if (existingError) throw existingError;
        for (const row of (existing ?? []) as Array<{
          subject_id: string;
          universal_subjects: { name: string; is_active: boolean } | null;
        }>) {
          if (row.subject_id === input.subjectId) continue;
          const us = row.universal_subjects;
          if (!us || !us.is_active) continue;
          if (us.name.trim().toLowerCase() === nameLower) {
            throw new Error("A subject with this name already exists in this class. Use a different name.");
          }
        }
      }

      const { error } = await supabase
        .from("universal_subjects")
        .update({ name: trimmed, category: input.category })
        .eq("id", input.subjectId);
      if (error) throw error;

      await logActivityEvent({
        action: "subject_updated",
        entityType: "Subject",
        entityId: input.subjectId,
        entityName: trimmed,
        metadata: { institution_id: input.institutionId },
      });
    },
    onSuccess: () => {
      bustSubjectCaches(queryClient);
      toast.success("Subject updated");
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update the subject.", context: "updateSchoolSubject" }),
  });
}
