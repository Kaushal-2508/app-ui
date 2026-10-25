import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type SubmitReason = "manual" | "timer_zero" | "violations_exceeded" | "disconnect_exceeded";

export type SubmitResult = {
  ok: true;
  total_marks?: number;
  total_max?: number;
  percentage?: number;
  already_submitted?: boolean;
};

export function useOlympiadSubmitAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ attempt_id, reason }: { attempt_id: string; reason: SubmitReason }): Promise<SubmitResult> => {
      const { data, error } = await supabase.rpc("oly_submit_attempt", {
        p_attempt_id: attempt_id,
        p_reason: reason,
      });
      if (error) throw error;
      return data as SubmitResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't submit exam. Please contact your school.", context: "useOlympiadSubmitAttempt" }),
    retry: 1,  // submit must succeed; one retry for transient errors
  });
}
