import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadSchoolReport = {
  found: boolean;
  results_available: boolean;
  results_published: boolean;
  enrolled: number;
  appeared: number;
  absent: number;
  avg_percentage: number;
  max_percentage: number;
  avg_marks: number;
  revenue_rupees: number;
  channel: { online: number; cash: number };
  enrollment_by_class: { class_label: string; count: number }[];
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

/** School-admin analytics for the Olympiad Report tab. One server-aggregated RPC. */
export function useOlympiadSchoolReport(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "school-report", olySchoolId],
    enabled: !!olySchoolId,
    queryFn: async (): Promise<OlympiadSchoolReport | null> => {
      if (!olySchoolId) return null;
      const { data, error } = await supabase.rpc("oly_school_report", {
        p_oly_school_id: olySchoolId,
      });
      if (error) throw error;
      return data as unknown as OlympiadSchoolReport;
    },
    staleTime: 60_000,
  });
}
