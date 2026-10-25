import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OlympiadSchoolOverview {
  derived_stage: "enrollment" | "exam_scheduled" | "exam_in_progress" | "exam_completed";
  total_students: number;
  attempted_count: number;
  cash_count: number;
  cash_rupees: number;
  online_count: number;
  online_rupees: number;
  results_published: boolean;
}

export function useOlympiadSchoolOverview(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "school-overview", olySchoolId],
    enabled: !!olySchoolId,
    queryFn: async (): Promise<OlympiadSchoolOverview> => {
      const { data, error } = await supabase.rpc("oly_school_overview", { p_oly_school_id: olySchoolId as string });
      if (error) throw error;
      return data as unknown as OlympiadSchoolOverview;
    },
    staleTime: 30_000,
  });
}
