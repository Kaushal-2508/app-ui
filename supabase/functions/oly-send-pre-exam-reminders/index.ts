// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // @ts-expect-error Deno.env
    const cronSecret = Deno.env.get("OLY_CRON_SECRET");
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return new Response("RESEND_API_KEY not set", { status: 500 });
    const supabase = createClient(supabaseUrl, serviceKey);

    // Find batches scheduled exactly 3 days out (date-only comparison, Asia/Kolkata)
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + 3);
    const targetDate = target.toISOString().slice(0, 10);
    const nextDate = new Date(target);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    const { data: batches } = await supabase
      .from("oly_batches")
      .select("id, scheduled_at, batch_label, oly_school_id, oly_schools(institutions(name))")
      .eq("status", "locked")
      .gte("scheduled_at", `${targetDate}T00:00:00Z`)
      .lt("scheduled_at", `${nextDateStr}T00:00:00Z`);

    let sent = 0;
    for (const b of batches ?? []) {
      const school = Array.isArray(b.oly_schools) ? b.oly_schools[0] : b.oly_schools;
      const inst = (school as { institutions?: unknown } | null)?.institutions;
      const schoolName = (Array.isArray(inst) ? inst[0] : inst as { name?: string } | null)?.name ?? "your school";

      const { data: assignments } = await supabase
        .from("oly_batch_assignments")
        .select("oly_student_id, oly_students!oly_student_id(id, full_name, parent_email, roll_number)")
        .eq("oly_batch_id", b.id);

      for (const a of assignments ?? []) {
        const student = Array.isArray(a.oly_students) ? a.oly_students[0] : a.oly_students;
        if (!student) continue;
        const s = student as { id: string; full_name: string; parent_email: string | null; roll_number: string };
        if (!s.parent_email) continue;

        // Idempotency check
        const { data: existing } = await supabase
          .from("oly_reminder_log")
          .select("id")
          .eq("oly_batch_id", b.id)
          .eq("oly_student_id", s.id)
          .eq("reminder_type", "pre_exam_3d")
          .maybeSingle();
        if (existing) continue;

        const examDate = new Date(b.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "SALCI Olympiad <noreply@salci.org>",
            to: s.parent_email,
            subject: `SALCI Olympiad reminder for ${s.full_name} (3 days)`,
            html: `<p>Hello,</p>
<p>This is a reminder that <strong>${s.full_name}</strong> (Roll number: ${s.roll_number}) is scheduled to take the SALCI Olympiad at ${schoolName} on:</p>
<p><strong>${examDate}</strong></p>
<p>The exam will be conducted at the school's computer lab. Please ensure your child arrives 30 minutes before the scheduled time.</p>
<p>Best regards,<br/>Team SALCI</p>`,
          }),
        });

        if (res.ok) {
          await supabase.from("oly_reminder_log").insert({
            oly_batch_id: b.id,
            oly_student_id: s.id,
            reminder_type: "pre_exam_3d",
            sent_to_email: s.parent_email,
          });
          sent++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
});
