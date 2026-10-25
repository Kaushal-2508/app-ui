import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StudyMaterialRow = {
  id: string;
  subject_id: string;
  grade_level_id: string;
  title: string;
  description: string | null;
  file_size_bytes: number;
  display_order: number;
};

export function useOlympiadStudentStudyMaterials(
  subjectIds: string[] | undefined,
  gradeLevelId: string | undefined,
) {
  return useQuery({
    queryKey: ["olympiad", "student-study-materials", subjectIds, gradeLevelId],
    queryFn: async (): Promise<StudyMaterialRow[]> => {
      if (!subjectIds?.length || !gradeLevelId) return [];
      // §23.1: explicit columns; no select(*)
      // RLS allows student SELECT — Phase 3a + 4a policies cover it
      const { data, error } = await supabase
        .from("oly_study_materials")
        .select("id, subject_id, grade_level_id, title, description, file_size_bytes, display_order")
        .in("subject_id", subjectIds)
        .eq("grade_level_id", gradeLevelId)
        .order("display_order")
        .order("title");
      if (error) throw error;
      return (data ?? []) as StudyMaterialRow[];
    },
    enabled: !!(subjectIds?.length && gradeLevelId),
    staleTime: 5 * 60_000,
  });
}
