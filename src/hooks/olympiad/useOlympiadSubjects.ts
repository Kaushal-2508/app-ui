import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type OlympiadSubject = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  grade_level_ids: string[];
};

export function useOlympiadSubjects() {
  return useQuery({
    queryKey: ["olympiad", "subjects"],
    queryFn: async (): Promise<OlympiadSubject[]> => {
      const { data: subjects, error: e1 } = await supabase
        .from("oly_subjects")
        .select("id, name, description, status")
        .order("name");
      if (e1) throw e1;

      const ids = (subjects ?? []).map((s) => s.id);
      if (ids.length === 0) return [];

      const { data: links, error: e2 } = await supabase
        .from("oly_subject_classes")
        .select("subject_id, grade_level_id")
        .in("subject_id", ids);
      if (e2) throw e2;

      const byId = new Map<string, string[]>();
      for (const l of links ?? []) {
        const arr = byId.get(l.subject_id) ?? [];
        arr.push(l.grade_level_id);
        byId.set(l.subject_id, arr);
      }

      return (subjects ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status as OlympiadSubject["status"],
        grade_level_ids: byId.get(s.id) ?? [],
      }));
    },
    staleTime: 60_000,
  });
}

export type OlympiadSubjectInput = {
  id?: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  grade_level_ids: string[];
};

type UpsertResult = { id: string; attached: boolean };

export function useUpsertOlympiadSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OlympiadSubjectInput): Promise<UpsertResult> => {
      let subjectId = input.id ?? "";
      let existingGrades: string[] = [];
      // Only the explicit edit path may UNassign classes. When we attach an
      // existing subject (name collision on create), we union the new classes
      // and never strip the subject's other class mappings.
      let allowRemove = false;
      let attached = false;

      if (subjectId) {
        const { error } = await supabase
          .from("oly_subjects")
          .update({ name: input.name, description: input.description, status: input.status })
          .eq("id", subjectId);
        if (error) throw error;
        allowRemove = true;

        // Fetch current grade ids for diff
        const { data: links, error: e } = await supabase
          .from("oly_subject_classes")
          .select("grade_level_id")
          .eq("subject_id", subjectId);
        if (e) throw e;
        existingGrades = (links ?? []).map((l) => l.grade_level_id);
      } else {
        const { data, error } = await supabase
          .from("oly_subjects")
          .insert({ name: input.name, description: input.description, status: input.status })
          .select("id")
          .single();
        // Subjects are a global catalog with a UNIQUE name. Typing the name of a
        // subject that already exists (e.g. adding "GK" to a new class) must
        // attach to that subject instead of failing with a 23505 duplicate.
        if (error && error.code === "23505") {
          const { data: existing, error: e } = await supabase
            .from("oly_subjects")
            .select("id")
            .eq("name", input.name)
            .maybeSingle();
          if (e) throw e;
          if (!existing) throw error;
          subjectId = existing.id;
          attached = true;
          const { data: links, error: e2 } = await supabase
            .from("oly_subject_classes")
            .select("grade_level_id")
            .eq("subject_id", subjectId);
          if (e2) throw e2;
          existingGrades = (links ?? []).map((l) => l.grade_level_id);
        } else if (error) {
          throw error;
        } else {
          subjectId = data.id;
        }
      }

      const existingSet = new Set(existingGrades);
      const desiredSet = new Set(input.grade_level_ids);
      const toAdd = input.grade_level_ids.filter((g) => !existingSet.has(g));
      const toRemove = allowRemove ? existingGrades.filter((g) => !desiredSet.has(g)) : [];

      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("oly_subject_classes")
          .delete()
          .eq("subject_id", subjectId)
          .in("grade_level_id", toRemove);
        if (error) throw error;
      }

      if (toAdd.length > 0) {
        const rows = toAdd.map((gid) => ({ subject_id: subjectId, grade_level_id: gid }));
        const { error } = await supabase.from("oly_subject_classes").insert(rows);
        if (error) throw error;
      }

      return { id: subjectId, attached };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "subjects"] });
      toast.success(res.attached ? "Added the existing subject to this class" : "Subject saved");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't save subject.", context: "useUpsertOlympiadSubject" }),
  });
}
