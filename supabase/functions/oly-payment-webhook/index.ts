// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AdminSupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{ data: { roll_number: string; date_of_birth: string; profile_id: string | null; auth_user_id: string | null } | null }>;
      };
    };
    update: (patch: { auth_user_id: string }) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
  };
  auth: {
    admin: {
      createUser: (input: { email: string; password: string; email_confirm: boolean }) => Promise<{
        data: { user: { id: string } | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

async function createOlympiadAuthUser(supabase: AdminSupabase, oly_student_id: string): Promise<string | null> {
  const { data: student } = await supabase
    .from("oly_students")
    .select("roll_number, date_of_birth, profile_id, auth_user_id")
    .eq("id", oly_student_id)
    .single();
  if (!student || student.auth_user_id || student.profile_id) {
    return student?.auth_user_id ?? null;
  }

  const [year, month, day] = student.date_of_birth.split("-").map(Number);
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const yy = String(year).slice(-2);
  const password = `${dd}${mm}${yy}`;
  const email = `${student.roll_number.toLowerCase()}@olympiad.salci.org`;

  const { data: newUser, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error || !newUser?.user) {
    console.error("Failed to create Olympiad auth user", error?.message ?? "no user returned");
    return null;
  }

  await supabase.from("oly_students").update({ auth_user_id: newUser.user.id }).eq("id", oly_student_id);
  return newUser.user.id;
}

serve(async (req: Request) => {
  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const rawBody = await req.text();
    const signature = req.headers.get("X-Razorpay-Signature") ?? "";

    const ok = await verifyHmac(rawBody, signature, webhookSecret);
    if (!ok) return new Response("Invalid signature", { status: 401 });

    const payload = JSON.parse(rawBody) as {
      event: string;
      payload: {
        payment: { entity: { id: string; order_id: string; amount: number; status: string } };
      };
    };

    if (payload.event !== "payment.captured" && payload.event !== "payment.authorized") {
      return new Response("Ignored event", { status: 200 });
    }

    const payment = payload.payload.payment.entity;

    const { data: pending, error: pErr } = await supabase
      .from("oly_enrollment_pending")
      .select("id, status, total_rupees, parent_email")
      .eq("gateway_order_id", payment.order_id)
      .maybeSingle();
    if (pErr || !pending) return new Response("Pending not found", { status: 404 });

    if (pending.status === "paid") {
      return new Response("Already processed", { status: 200 });
    }

    const { data: updated, error: uErr } = await supabase
      .from("oly_enrollment_pending")
      .update({
        status: "paid",
        gateway_payment_id: payment.id,
        gateway_signature: signature,
      })
      .eq("id", pending.id)
      .select("promoted_student_id, parent_email")
      .single();
    if (uErr) return new Response(uErr.message, { status: 500 });

    if (updated.promoted_student_id) {
      await createOlympiadAuthUser(supabase, updated.promoted_student_id);
      supabase.functions.invoke("oly-receipt-generate", {
        body: { oly_student_id: updated.promoted_student_id },
      }).catch(() => {});
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
});

async function verifyHmac(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, signature);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
