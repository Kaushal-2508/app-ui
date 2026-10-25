import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HomeworkAnalytics {
  total_assignments: number;
  graded_count: number;
  avg_percentage: number | null;
  submission_count: number;
  expected_count: number;
  submission_rate: number | null;
  on_time_rate: number | null;
  computed_at: string;
}

export function useHomeworkAnalytics(institutionId: string | null) {
  return useQuery({
    queryKey: ["homework-analytics", institutionId],
    enabled: !!institutionId,
    staleTime: 60_000,
    queryFn: async (): Promise<HomeworkAnalytics | null> => {
      const { data, error } = await supabase.rpc("homework_analytics_rollup", {
        _institution_id: institutionId!,
      });
      if (error) throw error;
      return (data as unknown as HomeworkAnalytics | null) ?? null;
    },
  });
}
