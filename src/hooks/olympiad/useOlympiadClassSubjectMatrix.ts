import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClassSubjectCell {
  grade_level_id: string;
  class_label: string;
  subject_id: string;
  subject_name: string;
  students: number;
  pct_correct: number;
}

/** Class × subject cross-analysis for the Analytics tab (RPC
 *  oly_school_class_subject_matrix, migration 20260612100000). */
export function useOlympiadClassSubjectMatrix(olySchoolId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["olympiad", "class-subject-matrix", olySchoolId],
    enabled: enabled && !!olySchoolId,
    queryFn: async (): Promise<ClassSubjectCell[]> => {
      const { data, error } = await supabase.rpc("oly_school_class_subject_matrix", {
        p_oly_school_id: olySchoolId as string,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        students: Number(r.students),
        pct_correct: Number(r.pct_correct),
      }));
    },
    staleTime: 60_000,
  });
}
