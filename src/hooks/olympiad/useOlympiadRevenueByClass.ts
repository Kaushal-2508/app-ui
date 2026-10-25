import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RevenueChannelFilter = "all" | "online" | "cash";

export interface RevenueByClassRow {
  grade_level_id: string;
  grade_name: string;
  students: number;
  revenue_rupees: number;
}

/** Class-wise paid-revenue distribution for the school Revenue tab.
 *  Server-side aggregate RPC (guarded by oly_is_school_admin_for). */
export function useOlympiadRevenueByClass(
  olySchoolId: string | undefined,
  channel: RevenueChannelFilter,
) {
  return useQuery({
    queryKey: ["olympiad", "revenue-by-class", olySchoolId, channel],
    enabled: !!olySchoolId,
    queryFn: async (): Promise<RevenueByClassRow[]> => {
      const { data, error } = await supabase.rpc("oly_school_revenue_by_class", {
        p_oly_school_id: olySchoolId as string,
        p_channel: channel,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        grade_level_id: r.grade_level_id,
        grade_name: r.grade_name,
        students: Number(r.students),
        revenue_rupees: Number(r.revenue_rupees),
      }));
    },
    staleTime: 60_000,
  });
}
