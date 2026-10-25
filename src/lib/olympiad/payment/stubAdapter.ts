import type { FrontendPaymentAdapter } from "./types";
import { supabase } from "@/integrations/supabase/client";

export const stubAdapter: FrontendPaymentAdapter = {
  name: "stub",
  async openCheckout({ pendingId }) {
    await new Promise((r) => setTimeout(r, 500));
    const { error } = await supabase.functions.invoke("oly-stub-payment-complete", {
      body: { pendingId },
    });
    if (error) throw new Error(error.message);
  },
};
