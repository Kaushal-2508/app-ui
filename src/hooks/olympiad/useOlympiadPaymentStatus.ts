import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PaymentStatus = {
  status: "payment_pending" | "paid" | "failed" | "abandoned";
  promoted_student_id: string | null;
  roll_number: string | null;
};

export function useOlympiadPaymentStatus(pendingId: string | null) {
  return useQuery({
    queryKey: ["olympiad", "payment-status", pendingId],
    queryFn: async (): Promise<PaymentStatus> => {
      if (!pendingId) {
        return { status: "payment_pending", promoted_student_id: null, roll_number: null };
      }
      const { data, error } = await supabase
        .from("oly_enrollment_pending")
        .select("status, promoted_student_id, oly_students(roll_number)")
        .eq("id", pendingId)
        .single();
      if (error) throw error;
      const student = Array.isArray(data.oly_students)
        ? data.oly_students[0]
        : data.oly_students;
      return {
        status: data.status as PaymentStatus["status"],
        promoted_student_id: data.promoted_student_id,
        roll_number: (student as { roll_number?: string } | null)?.roll_number ?? null,
      };
    },
    enabled: !!pendingId,
    staleTime: 0,
    // refetchInterval < 30s is justified here per CLAUDE.md §23.2:
    // "watching gateway confirmation, expected to terminate within seconds"
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "paid" || s === "failed" || s === "abandoned" ? false : 3000;
    },
    refetchIntervalInBackground: true,
  });
}
