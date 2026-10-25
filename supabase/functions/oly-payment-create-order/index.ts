// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type FormData = {
  full_name: string;
  date_of_birth: string;
  class_label: string;
  section_label?: string | null;
  grade_level_id?: string | null;
  admission_number?: string | null;
  subject_ids: string[];
  parent_name: string;
  parent_phone: string;
  parent_email?: string | null;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const adapter = (Deno.env.get("OLY_PAYMENT_ADAPTER") ?? "stub").toLowerCase();
    const supabase = createClient(supabaseUrl, serviceKey);

    const { school_short_code, form_data } = (await req.json().catch(() => ({}))) as {
      school_short_code?: string;
      form_data?: FormData;
    };

    // Validate FIRST — this is a PUBLIC unauthenticated endpoint; reject
    // garbage before spending any RPC/DB work on it (§23.14). Previously the
    // payment-context RPC + two more queries ran before any field check.
    if (
      typeof school_short_code !== "string" ||
      !school_short_code.trim() ||
      school_short_code.length > 32 ||
      !form_data
    ) {
      return json({ error: "Invalid payload" }, 400);
    }
    if (!form_data.full_name || !form_data.date_of_birth || !form_data.class_label
        || !Array.isArray(form_data.subject_ids) || form_data.subject_ids.length !== 3
        || !form_data.parent_name || !form_data.parent_phone) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (!/^[6-9]\d{9}$/.test(form_data.parent_phone)) {
      return json({ error: "Invalid Indian mobile number" }, 400);
    }

    const { data: ctx, error: ctxErr } = await supabase.rpc("oly_get_public_school_payment_context", {
      p_school_code: school_short_code,
    });
    if (ctxErr) return json({ error: ctxErr.message }, 400);
    if (!(ctx as { found?: boolean })?.found) return json({ error: "School not found or enrollment closed" }, 404);

    const ctxData = ctx as { found: true; school_name: string; price_rupees: number; gst_percent: number; is_existing_salci_school: boolean };
    const priceRupees = ctxData.price_rupees;
    const gstRupees = Math.round(priceRupees * ctxData.gst_percent) / 100;
    const totalRupees = priceRupees + gstRupees;

    const { data: schoolRow, error: schoolErr } = await supabase
      .from("oly_schools")
      .select("id, campaign_id, is_existing_salci_school")
      .eq("school_short_code", school_short_code.toUpperCase())
      .single();
    if (schoolErr || !schoolRow) return json({ error: "School not found" }, 404);

    const { data: isOpen } = await supabase.rpc("oly_enrollment_is_open", { p_oly_school_id: schoolRow.id });
    if (!isOpen) {
      return json({ error: "Enrollment is closed for this school." }, 409);
    }

    if (ctxData.is_existing_salci_school && form_data.admission_number) {
      const { data: dup } = await supabase
        .from("oly_students")
        .select("roll_number")
        .eq("oly_school_id", schoolRow.id)
        .eq("admission_number", form_data.admission_number)
        .eq("campaign_id", schoolRow.campaign_id)
        .limit(1)
        .maybeSingle();
      if (dup) {
        return json({ blocked: true, message: `This student is already enrolled. Roll number: ${dup.roll_number}.` }, 409);
      }
    } else {
      const { data: dup } = await supabase
        .from("oly_students")
        .select("roll_number")
        .eq("oly_school_id", schoolRow.id)
        .ilike("full_name", form_data.full_name)
        .eq("date_of_birth", form_data.date_of_birth)
        .eq("class_label", form_data.class_label)
        .gt("enrolled_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
      if (dup) {
        return json({ blocked: true, message: `This student appears to be already enrolled. Roll number: ${dup.roll_number}. If this is a mistake, please contact your school.` }, 409);
      }
    }

    await supabase
      .from("oly_enrollment_pending")
      .delete()
      .eq("oly_school_id", schoolRow.id)
      .eq("status", "payment_pending")
      .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    const { data: pending, error: insErr } = await supabase
      .from("oly_enrollment_pending")
      .insert({
        oly_school_id: schoolRow.id,
        campaign_id: schoolRow.campaign_id,
        full_name: form_data.full_name,
        date_of_birth: form_data.date_of_birth,
        class_label: form_data.class_label,
        section_label: form_data.section_label ?? null,
        grade_level_id: form_data.grade_level_id ?? null,
        admission_number: form_data.admission_number ?? null,
        subject_ids: form_data.subject_ids,
        parent_name: form_data.parent_name,
        parent_phone: form_data.parent_phone,
        parent_email: form_data.parent_email ?? null,
        amount_rupees: priceRupees,
        gst_rupees: gstRupees,
        total_rupees: totalRupees,
      })
      .select("id")
      .single();
    if (insErr || !pending) return json({ error: insErr?.message ?? "Failed to create pending row" }, 500);

    let transactionId: string;
    let clientPayload: unknown;

    if (adapter === "razorpay") {
      // @ts-expect-error Deno.env
      const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
      // @ts-expect-error Deno.env
      const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
      const auth = btoa(`${keyId}:${keySecret}`);
      let res: Response;
      try {
        res = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            // Razorpay's Orders API requires paise (its API contract) — this is the gateway boundary.
            amount: Math.round(totalRupees * 100),
            currency: "INR",
            receipt: pending.id,
            notes: { orderRef: pending.id, school: ctxData.school_name },
          }),
          // Public endpoint: a hung Razorpay call must not pin an edge
          // connection open per enrolling parent (§23.14). The orphaned
          // pending row is reaped by the stale-delete above, same as the
          // existing non-2xx path.
          signal: AbortSignal.timeout(10_000),
        });
      } catch (_fetchErr) {
        return json({ error: "Payment gateway timed out. Please try again." }, 504);
      }
      if (!res.ok) {
        const errBody = await res.text();
        return json({ error: `Razorpay order failed: ${errBody}` }, 502);
      }
      const order = await res.json() as { id: string };
      transactionId = order.id;
      clientPayload = {
        key_id: keyId,
        order_id: order.id,
        // Razorpay Checkout widget also requires paise (gateway boundary).
        amount: Math.round(totalRupees * 100),
        school_name: ctxData.school_name,
      };
    } else {
      transactionId = `stub_${crypto.randomUUID()}`;
      clientPayload = { stub: true };
    }

    await supabase
      .from("oly_enrollment_pending")
      .update({ gateway_order_id: transactionId })
      .eq("id", pending.id);

    return json({ pending_id: pending.id, transaction_id: transactionId, client_payload: clientPayload, total_rupees: totalRupees }, 200);
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
