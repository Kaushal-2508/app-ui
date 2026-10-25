// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // @ts-expect-error Deno.env
  const adapter = (Deno.env.get("OLY_PAYMENT_ADAPTER") ?? "stub").toLowerCase();
  if (adapter !== "stub") {
    return json({ error: "Stub completion is only available when OLY_PAYMENT_ADAPTER=stub" }, 403);
  }

  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { pendingId } = (await req.json()) as { pendingId: string };
    if (!pendingId) return json({ error: "pendingId required" }, 400);

    const fakePaymentId = `stub_pay_${crypto.randomUUID()}`;
    const { data: updated, error } = await supabase
      .from("oly_enrollment_pending")
      .update({
        status: "paid",
        gateway_payment_id: fakePaymentId,
        gateway_signature: "stub_sig",
      })
      .eq("id", pendingId)
      .select("promoted_student_id")
      .single();
    if (error) return json({ error: error.message }, 500);

    if (updated.promoted_student_id) {
      supabase.functions.invoke("oly-receipt-generate", {
        body: { oly_student_id: updated.promoted_student_id },
      }).catch(() => {});
    }

    return json({ ok: true, promoted_student_id: updated.promoted_student_id }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
