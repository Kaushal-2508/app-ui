import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PaymentListRow {
  oly_student_id: string;
  full_name: string;
  roll_number: string;
  total_rupees: number;
  gst_rupees: number;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  paid_at: string;
  cursor_id: string;
}

type Cursor = { ts: string; id: string } | null;

const PAGE = 50;

export function useOlympiadSchoolPaymentList(
  olySchoolId: string | undefined, channel: "cash" | "online", enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["olympiad", "payment-list", olySchoolId, channel],
    enabled: enabled && !!olySchoolId,
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }): Promise<PaymentListRow[]> => {
      const { data, error } = await supabase.rpc("oly_school_payment_list", {
        p_oly_school_id: olySchoolId as string,
        p_channel: channel,
        p_limit: PAGE,
        p_cursor: pageParam?.ts ?? null,
        p_cursor_id: pageParam?.id ?? null,
      });
      if (error) throw error;
      return (data ?? []) as unknown as PaymentListRow[];
    },
    getNextPageParam: (last): Cursor | undefined =>
      last.length === PAGE
        ? { ts: last[last.length - 1].paid_at, id: last[last.length - 1].cursor_id }
        : undefined,
    staleTime: 30_000,
  });
}
