import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useFeeAnalytics(institutionId: string | undefined) {
  const analyticsQuery = useQuery({
    queryKey: ["fee-analytics", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_institution_fee_analytics", {
        _institution_id: institutionId!,
      });
      if (error) throw error;
      // RPC returns array with single row
      return Array.isArray(data) ? data[0] : data;
    },
    enabled: !!institutionId,
  });

  // Category breakdown
  const categoryBreakdownQuery = useQuery({
    queryKey: ["fee-category-breakdown", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_installments")
        .select("amount, paid_amount, status, student_fee_assignments!inner(fee_structures!inner(fee_categories!inner(name)))")
        .eq("institution_id", institutionId!);
      if (error) throw error;

      const breakdown: Record<string, { name: string; collected: number; pending: number }> = {};
      for (const row of data || []) {
        const catName = (row as any).student_fee_assignments?.fee_structures?.fee_categories?.name || "Other";
        if (!breakdown[catName]) breakdown[catName] = { name: catName, collected: 0, pending: 0 };
        breakdown[catName].collected += Number(row.paid_amount);
        breakdown[catName].pending += Number(row.amount) - Number(row.paid_amount);
      }
      return Object.values(breakdown);
    },
    enabled: !!institutionId,
  });

  return {
    analytics: analyticsQuery.data,
    categoryBreakdown: categoryBreakdownQuery.data ?? [],
    isLoading: analyticsQuery.isLoading,
  };
}
