import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StudyMaterial } from "@/hooks/olympiad/useOlympiadStudyMaterials";

/**
 * Study materials across ALL of the school's participating classes — the
 * school-staff view (RLS: "school staff read scoped materials" policy,
 * migration 20260611150000, already scopes rows to participating grades).
 * Includes storage_path so staff can open the PDF via
 * getStudyMaterialSignedUrl. The page filters client-side by class/subject.
 */
export function useOlympiadSchoolStudyMaterials(gradeLevelIds: string[] | undefined) {
  return useQuery({
    queryKey: ["olympiad", "school-study-materials", gradeLevelIds],
    queryFn: async (): Promise<StudyMaterial[]> => {
      if (!gradeLevelIds?.length) return [];
      const { data, error } = await supabase
        .from("oly_study_materials")
        .select(
          "id, subject_id, grade_level_id, title, description, storage_path, file_size_bytes, display_order, created_at",
        )
        .in("grade_level_id", gradeLevelIds)
        .order("display_order")
        .order("title");
      if (error) throw error;
      return (data ?? []) as StudyMaterial[];
    },
    enabled: !!gradeLevelIds?.length,
    staleTime: 5 * 60_000,
  });
}
