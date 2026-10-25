import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ScoreBucket = { bucket: string; count: number };

/**
 * Class-filtered Score distribution for the Analytics tab's per-card filter
 * (RPC oly_school_score_distribution, migration 20260612140000). Only enabled
 * when a class is selected — the all-classes numbers already arrive with
 * oly_school_report.
 */
export function useOlympiadScoreDistribution(
  olySchoolId: string | undefined,
  gradeLevelId: string | null,
) {
  return useQuery({
    queryKey: ["olympiad", "score-distribution", olySchoolId, gradeLevelId],
    enabled: !!olySchoolId && !!gradeLevelId,
    queryFn: async (): Promise<ScoreBucket[]> => {
      const { data, error } = await supabase.rpc("oly_school_score_distribution", {
        p_oly_school_id: olySchoolId as string,
        p_grade_level_id: gradeLevelId as string,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ScoreBucket[];
    },
    staleTime: 60_000,
  });
}
