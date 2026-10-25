import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import type { ClassSubject } from "@/hooks/useClassSubjects";

const LIST_KEY = "class-group-subjects";

export interface ClassGroupSubjectMapping {
  id: string;
  institution_id: string;
  class_group_id: string;
  subject_id: string;
  created_at: string;
  is_optional: boolean;
}

/**
 * Reads `subject_class_group_mappings` joined to `universal_subjects`.
 * Used by the container-first admin UI (SubjectMappingMatrix) so one
 * row per Class 10 replaces three rows (10A/B/C) in the matrix.
 *
 * Writes still go through `subject_class_group_mappings` — the DB
 * trigger (migration 20260423120000) fans out to
 * `subject_class_mappings` per section, keeping the §7 dual-table
 * invariant and every existing RLS JOIN in `useClassSubjects` /
 * `useTeacherAssignedSubjects` working unchanged.
 */
export function useClassGroupSubjects(
  classGroupId: string | null,
  institutionId: string | null
) {
  return useQuery({
    queryKey: [LIST_KEY, classGroupId, institutionId],
    queryFn: async (): Promise<{
      global: ClassSubject[];
      institute: ClassSubject[];
      all: ClassSubject[];
      mappings: ClassGroupSubjectMapping[];
    }> => {
      if (!classGroupId || !institutionId) {
        return { global: [], institute: [], all: [], mappings: [] };
      }

      const { data, error } = await supabase
        .from("subject_class_group_mappings" as never)
        .select(`
          id,
          institution_id,
          class_group_id,
          subject_id,
          created_at,
          is_optional,
          universal_subjects!inner(id, name, code, institution_id, is_active)
        `)
        .eq("class_group_id", classGroupId)
        .eq("institution_id", institutionId);

      if (error) throw error;

      const rows = (data ?? []) as unknown as Array<
        ClassGroupSubjectMapping & {
          universal_subjects: {
            id: string;
            name: string;
            code: string | null;
            institution_id: string | null;
            is_active: boolean | null;
          };
        }
      >;

      const global: ClassSubject[] = [];
      const institute: ClassSubject[] = [];
      const seen = new Set<string>();

      for (const row of rows) {
        if (!row.universal_subjects || seen.has(row.subject_id)) continue;
        seen.add(row.subject_id);
        const subject: ClassSubject = {
          id: row.subject_id,
          name: row.universal_subjects.name,
          code: row.universal_subjects.code,
          source:
            row.universal_subjects.institution_id === null ? "global" : "institute",
          is_optional: row.is_optional ?? false,
        };
        if (subject.source === "global") global.push(subject);
        else institute.push(subject);
      }

      global.sort((a, b) => a.name.localeCompare(b.name));
      institute.sort((a, b) => a.name.localeCompare(b.name));

      return {
        global,
        institute,
        all: [...global, ...institute],
        mappings: rows.map(({ universal_subjects: _, ...rest }) => rest),
      };
    },
    enabled: !!classGroupId && !!institutionId,
  });
}

function invalidateSubjectCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  classGroupId: string,
  institutionId: string
) {
  queryClient.invalidateQueries({ queryKey: [LIST_KEY, classGroupId, institutionId] });
  queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
  queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
  queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
}

export function useAddSubjectToClassGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      institution_id: string;
      class_group_id: string;
      subject_id: string;
      is_optional?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("subject_class_group_mappings" as never)
        .upsert(
          {
            institution_id: input.institution_id,
            class_group_id: input.class_group_id,
            subject_id: input.subject_id,
            is_optional: input.is_optional ?? false,
          } as never,
          { onConflict: "institution_id,class_group_id,subject_id" }
        )
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as ClassGroupSubjectMapping;
    },
    onSuccess: (row) => {
      invalidateSubjectCaches(queryClient, row.class_group_id, row.institution_id);
      toast.success("Subject added to class");
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't add this subject to the class.",
        context: "addSubjectToClassGroup",
      }),
  });
}

export function useRemoveSubjectFromClassGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      institution_id: string;
      class_group_id: string;
      subject_id: string;
    }) => {
      const { error } = await supabase
        .from("subject_class_group_mappings" as never)
        .delete()
        .eq("institution_id", input.institution_id)
        .eq("class_group_id", input.class_group_id)
        .eq("subject_id", input.subject_id);
      if (error) throw error;

      return input;
    },
    onSuccess: ({ class_group_id, institution_id }) => {
      invalidateSubjectCaches(queryClient, class_group_id, institution_id);
      toast.success("Subject removed from class");
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't remove this subject from the class.",
        context: "removeSubjectFromClassGroup",
      }),
  });
}

/**
 * Flips an existing class-group subject mapping between compulsory and optional.
 * The fanout trigger propagates `is_optional` to every section row in place.
 * No auto-enroll: marking optional starts an EMPTY student roster.
 */
export function useToggleSubjectOptional() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      institution_id: string;
      class_group_id: string;
      subject_id: string;
      is_optional: boolean;
    }) => {
      const { error } = await supabase
        .from("subject_class_group_mappings" as never)
        .update({ is_optional: input.is_optional } as never)
        .eq("institution_id", input.institution_id)
        .eq("class_group_id", input.class_group_id)
        .eq("subject_id", input.subject_id);
      if (error) throw error;
      return input;
    },
    onSuccess: ({ class_group_id, institution_id, is_optional }) => {
      invalidateSubjectCaches(queryClient, class_group_id, institution_id);
      queryClient.invalidateQueries({ queryKey: ["student-subject-assignment"] });
      toast.success(is_optional ? "Subject marked optional" : "Subject marked compulsory");
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't change this subject's type.",
        context: "toggleSubjectOptional",
      }),
  });
}
