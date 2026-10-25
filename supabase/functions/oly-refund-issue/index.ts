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

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const adapter = (Deno.env.get("OLY_PAYMENT_ADAPTER") ?? "stub").toLowerCase();
    const supabase = createClient(supabaseUrl, serviceKey);

    const userRes = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.data.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isSuper) return json({ error: "Forbidden" }, 403);

    const { scope, oly_student_id, oly_school_id, reason } = (await req.json()) as {
      scope: "per_student" | "school_wide";
      oly_student_id?: string;
      oly_school_id?: string;
      reason: string;
    };
    if (!reason?.trim()) return json({ error: "Reason required" }, 400);

    // Resolve target students
    let studentIds: string[];
    if (scope === "per_student") {
      if (!oly_student_id) return json({ error: "oly_student_id required" }, 400);
      studentIds = [oly_student_id];
    } else {
      if (!oly_school_id) return json({ error: "oly_school_id required" }, 400);
      const { data: list } = await supabase
        .from("oly_students")
        .select("id")
        .eq("oly_school_id", oly_school_id)
        .eq("status", "active");
      studentIds = (list ?? []).map((r: { id: string }) => r.id);
    }

    const results: Array<{ student_id: string; status: string; refundId?: string; error?: string }> = [];

    for (const sid of studentIds) {
      const { data: pending } = await supabase
        .from("oly_enrollment_pending")
        .select("gateway_payment_id, gateway_order_id, total_rupees")
        .eq("promoted_student_id", sid)
        .maybeSingle();

      const isCash = !pending?.gateway_payment_id;
      const amountRupees = pending?.total_rupees ?? 0;

      let gatewayRefundId: string | null = null;
      let refundStatus: "pending" | "completed" | "failed" | "offline" = "pending";

      if (isCash) {
        refundStatus = "offline";
      } else if (adapter === "razorpay" && pending?.gateway_payment_id) {
        // @ts-expect-error Deno.env
        const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
        // @ts-expect-error Deno.env
        const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
        const auth = btoa(`${keyId}:${keySecret}`);
        const res = await fetch(`https://api.razorpay.com/v1/payments/${pending.gateway_payment_id}/refund`, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify({ amount: Math.round(amountRupees * 100), notes: { reason } }),
        });
        if (res.ok) {
          const body = await res.json() as { id: string; status: string };
          gatewayRefundId = body.id;
          refundStatus = body.status === "processed" ? "completed" : "pending";
        } else {
          refundStatus = "failed";
        }
      } else {
        // stub: always succeeds
        gatewayRefundId = `stub_refund_${crypto.randomUUID()}`;
        refundStatus = "completed";
      }

      const { data: refundRow } = await supabase
        .from("oly_refunds")
        .insert({
          oly_student_id: sid,
          initiated_by: userId,
          reason,
          scope,
          amount_rupees: amountRupees,
          gateway_refund_id: gatewayRefundId,
          status: refundStatus,
          completed_at: refundStatus === "completed" ? new Date().toISOString() : null,
        })
        .select("id")
        .single();

      await supabase.from("oly_students").update({ status: "refunded" }).eq("id", sid);

      results.push({ student_id: sid, status: refundStatus, refundId: refundRow?.id });
    }

    return json({ ok: true, processed: results.length, results }, 200);
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
