import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type PinValidateResult =
  | { ok: true; batch_id: string; student_id: string; scheduled_at: string }
  | { ok: false; reason: "wrong_pin" | "expired_pin" | "wrong_batch" | "already_attempted" | "student_not_found" | "enrollment_closed" };

export function useOlympiadPinValidate() {
  return useMutation({
    mutationFn: async (pin: string): Promise<PinValidateResult> => {
      // §23.1: this is the hot exam-day path. RPC = sub-50ms.
      // Collect user-agent client-side for audit.
      const { data, error } = await supabase.rpc("oly_validate_pin", {
        p_pin: pin,
        p_ip: null,
        p_user_agent: navigator.userAgent ?? null,
      });
      if (error) throw error;
      return data as PinValidateResult;
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't validate PIN.", context: "useOlympiadPinValidate" }),
  });
}
