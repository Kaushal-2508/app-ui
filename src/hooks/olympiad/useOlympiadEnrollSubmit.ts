import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type EnrollFormData = {
  full_name: string;
  date_of_birth: string; // yyyy-mm-dd
  class_label: string;
  section_label?: string | null;
  grade_level_id?: string | null;
  admission_number?: string | null;
  subject_ids: string[];
  parent_name: string;
  parent_phone: string;
  parent_email?: string | null;
};

export type EnrollSubmitResult = {
  pending_id: string;
  transaction_id: string;
  client_payload: unknown;
  total_rupees: number;
  blocked?: false;
};

export type EnrollBlockedResult = {
  blocked: true;
  message: string;
};

export function useOlympiadEnrollSubmit() {
  return useMutation({
    mutationFn: async ({
      school_short_code,
      form_data,
    }: {
      school_short_code: string;
      form_data: EnrollFormData;
    }): Promise<EnrollSubmitResult | EnrollBlockedResult> => {
      const { data, error } = await supabase.functions.invoke(
        "oly-payment-create-order",
        { body: { school_short_code, form_data } },
      );

      if (error) {
        // The edge function returns 409 with { blocked: true, message } for duplicates.
        // supabase.functions.invoke puts 4xx bodies on error.context (a Response).
        const ctx = (error as { context?: unknown }).context;
        if (ctx && typeof (ctx as Response).json === "function") {
          try {
            const body = await (ctx as Response).clone().json() as { blocked?: boolean; message?: string; error?: string };
            if (body.blocked) {
              return { blocked: true, message: body.message ?? "Student is already enrolled." };
            }
            if (body.error) throw new Error(body.error);
          } catch (parseErr) {
            if (parseErr instanceof Error && !parseErr.message.includes("JSON")) throw parseErr;
          }
        }
        const msg = (error as { message?: string }).message ?? "Request failed";
        if (msg.includes("already enrolled")) {
          return { blocked: true, message: msg };
        }
        throw new Error(msg);
      }

      if (data && typeof data === "object" && (data as { blocked?: boolean }).blocked) {
        return data as EnrollBlockedResult;
      }

      return data as EnrollSubmitResult;
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't start payment.", context: "useOlympiadEnrollSubmit" }),
  });
}
