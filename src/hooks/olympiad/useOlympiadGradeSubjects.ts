// src/hooks/olympiad/useOlympiadGradeSubjects.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadGradeSubject = { id: string; name: string };

// All active Olympiad subjects offered for a grade_level_id (via oly_subject_classes).
export function useOlympiadGradeSubjects(gradeLevelId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "grade-subjects", gradeLevelId],
    queryFn: async (): Promise<OlympiadGradeSubject[]> => {
      if (!gradeLevelId) return [];
      const { data: links, error: e1 } = await supabase
        .from("oly_subject_classes")
        .select("subject_id")
        .eq("grade_level_id", gradeLevelId);
      if (e1) throw e1;
      const ids = (links ?? []).map((l) => l.subject_id);
      if (ids.length === 0) return [];
      const { data: subjects, error: e2 } = await supabase
        .from("oly_subjects")
        .select("id, name")
        .in("id", ids)
        .eq("status", "active")
        .order("name");
      if (e2) throw e2;
      return (subjects ?? []).map((s) => ({ id: s.id, name: s.name }));
    },
    enabled: !!gradeLevelId,
    staleTime: 60_000,
  });
}
