import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadBatchReport = {
  found: boolean;
  batch_label: string;
  scheduled_at: string;
  results_available: boolean;
  results_published: boolean;
  enrolled: number;
  appeared: number;
  absent: number;
  avg_percentage: number;
  max_percentage: number;
  avg_marks: number;
  subject_performance: { subject_name: string; pct_correct: number; correct: number; total: number }[];
  weak_topics: { topic_name: string; subject_name: string; pct_correct: number; questions: number }[];
  class_performance: { class_label: string; avg_percentage: number; appeared: number }[];
  score_distribution: { bucket: string; count: number }[];
  tier_distribution: {
    gold: number;
    silver: number;
    bronze: number;
    participation: number;
    absent: number;
  };
  toppers: { full_name: string; class_label: string; percentage: number }[];
};

/**
 * Batch-scoped analytics for the "Exam Analysis" view inside a batch's detail
 * sheet. Mirrors useOlympiadSchoolReport but restricted to one batch's
 * assigned students (RPC oly_batch_report, migration 20260613100000). Only
 * fetched while the analysis view is open (`enabled`).
 */
export function useOlympiadBatchReport(batchId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["olympiad", "batch-report", batchId],
    enabled: enabled && !!batchId,
    queryFn: async (): Promise<OlympiadBatchReport | null> => {
      if (!batchId) return null;
      const { data, error } = await supabase.rpc("oly_batch_report", { p_batch_id: batchId });
      if (error) throw error;
      return data as unknown as OlympiadBatchReport;
    },
    staleTime: 60_000,
  });
}
