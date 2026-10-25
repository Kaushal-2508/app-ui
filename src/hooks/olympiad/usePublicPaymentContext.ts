import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PublicPaymentContext =
  | {
      found: true;
      school_name: string;
      school_short_code: string;
      is_existing_salci_school: boolean;
      price_rupees: number;
      gst_percent: number;
      classes: Array<{ id: string; name: string; number: number }>;
      subjects_per_class: Record<string, Array<{ id: string; name: string }>>;
    }
  | { found: false };

export function usePublicPaymentContext(schoolCode: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "public", "payment-context", schoolCode],
    queryFn: async (): Promise<PublicPaymentContext> => {
      if (!schoolCode) return { found: false };
      const { data, error } = await supabase.rpc("oly_get_public_school_payment_context", {
        p_school_code: schoolCode,
      });
      if (error) throw error;
      return data as PublicPaymentContext;
    },
    enabled: !!schoolCode,
    staleTime: 60_000,
  });
}
