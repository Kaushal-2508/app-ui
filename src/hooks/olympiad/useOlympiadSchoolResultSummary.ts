import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TopScorer { full_name: string; roll_number: string; percentage: number; school_rank: number }
export interface ResultSummary {
  published: boolean;
  gold_count?: number; silver_count?: number; bronze_count?: number;
  participation_count?: number; absent_count?: number;
  attempted_count?: number;
  avg_percentage: number;
  top_scorers: TopScorer[];
}

export function useOlympiadSchoolResultSummary(olySchoolId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["olympiad", "result-summary", olySchoolId],
    enabled: enabled && !!olySchoolId,
    queryFn: async (): Promise<ResultSummary> => {
      const { data, error } = await supabase.rpc("oly_school_result_summary", { p_oly_school_id: olySchoolId as string });
      if (error) throw error;
      return data as unknown as ResultSummary;
    },
    staleTime: 60_000,
  });
}
