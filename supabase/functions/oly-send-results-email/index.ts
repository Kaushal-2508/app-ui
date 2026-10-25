// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "olympiad-receipts";
const SIGNED_URL_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    // @ts-expect-error Deno.env
    const portalBase = (Deno.env.get("OLY_PORTAL_URL") ?? "https://app.salci.ai").replace(/\/$/, "");
    const LOGIN_URL = `${portalBase}/olympiad/login`;

    // @ts-expect-error Deno.env
    const internalSecret = Deno.env.get("OLY_INTERNAL_SECRET");
    const isSystem =
      !!internalSecret && req.headers.get("x-internal-secret") === internalSecret;

    const { oly_result_id } = (await req.json()) as { oly_result_id: string };
    if (!oly_result_id) return json({ error: "Missing oly_result_id" }, 400);

    if (!isSystem) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace("Bearer ", "");
      if (!token) return json({ error: "Missing auth" }, 401);

      const { data: userRes } = await supabase.auth.getUser(token);
      const userId = userRes.user?.id;
      if (!userId) return json({ error: "Forbidden" }, 403);

      const { data: roleCheckRow } = await supabase
        .from("oly_results")
        .select("oly_school_id")
        .eq("id", oly_result_id)
        .maybeSingle();
      if (!roleCheckRow) return json({ error: "Result not found" }, 404);

      const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
      const { data: isSchoolAdmin } = await supabase.rpc("oly_is_school_admin_for", {
        p_uid: userId, p_oly_school_id: roleCheckRow.oly_school_id,
      });
      if (!isSuper && !isSchoolAdmin) return json({ error: "Forbidden" }, 403);
    }

    // ── Load result row ────────────────────────────────────────────────────────
    const { data: result, error: rErr } = await supabase
      .from("oly_results")
      .select(
        "id, oly_student_id, campaign_id, oly_school_id, " +
        "total_marks_obtained, total_max_marks, percentage, " +
        "school_rank, school_total, class_rank, class_total, " +
        "certificate_tier, certificate_id, " +
        "result_pdf_path, certificate_pdf_path, " +
        "emailed_at"
      )
      .eq("id", oly_result_id)
      .single();
    if (rErr || !result) return json({ error: "Result not found" }, 404);

    // Idempotency: skip if already emailed
    if (result.emailed_at) {
      return json({ ok: true, skipped: true, reason: "already_emailed" }, 200);
    }

    // ── Load student ───────────────────────────────────────────────────────────
    const { data: student, error: sErr } = await supabase
      .from("oly_students")
      .select("full_name, roll_number, class_label, section_label, parent_email")
      .eq("id", result.oly_student_id)
      .single();
    if (sErr || !student) return json({ error: "Student not found" }, 404);

    // Skip if no parent email
    if (!student.parent_email) {
      return json({ ok: true, skipped: true, reason: "no_parent_email" }, 200);
    }

    // Skip if Resend not configured
    if (!resendKey) {
      return json({ ok: true, skipped: true, reason: "resend_not_configured" }, 200);
    }

    // ── Load campaign year ─────────────────────────────────────────────────────
    const { data: campaign } = await supabase
      .from("oly_campaigns")
      .select("campaign_year")
      .eq("id", result.campaign_id)
      .single();
    const campaignYear = (campaign as { campaign_year?: number } | null)?.campaign_year ?? new Date().getFullYear();

    // ── Generate signed URLs for PDFs ─────────────────────────────────────────
    let resultPdfUrl: string | null = null;
    let certificatePdfUrl: string | null = null;

    if (result.result_pdf_path) {
      const { data: signedResult } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(result.result_pdf_path, SIGNED_URL_TTL);
      resultPdfUrl = signedResult?.signedUrl ?? null;
    }

    if (result.certificate_pdf_path && result.certificate_tier !== "absent") {
      const { data: signedCert } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(result.certificate_pdf_path, SIGNED_URL_TTL);
      certificatePdfUrl = signedCert?.signedUrl ?? null;
    }

    // ── Build email body ──────────────────────────────────────────────────────
    const tierLabel = (tier: string): string => {
      const map: Record<string, string> = {
        gold: "Gold",
        silver: "Silver",
        bronze: "Bronze",
        participation: "Participation",
        absent: "Absent",
      };
      return map[tier] ?? tier;
    };

    const pct = Number(result.percentage).toFixed(2);
    const score = `${Number(result.total_marks_obtained).toFixed(0)} / ${Number(result.total_max_marks).toFixed(0)}`;
    const tier = tierLabel(result.certificate_tier);
    const classLabel = student.class_label + (student.section_label ? ` ${student.section_label}` : "");
    const isAbsent = result.certificate_tier === "absent";

    const rankHtml =
      !isAbsent && result.school_rank
        ? `<strong>Rank in School:</strong> ${result.school_rank} of ${result.school_total ?? "?"}<br>
           <strong>Rank in Class:</strong> ${result.class_rank ?? "?"} of ${result.class_total ?? "?"}<br>`
        : "";

    const resultLinkHtml = resultPdfUrl
      ? `<p><a href="${resultPdfUrl}" style="background:#249ca2;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">Download Detailed Report</a></p>`
      : "";

    const certLinkHtml = certificatePdfUrl
      ? `<p><a href="${certificatePdfUrl}" style="background:#fa920e;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">Download Certificate</a></p>`
      : "";

    const scoreSection = !isAbsent
      ? `<p>
           <strong>Combined Score:</strong> ${score} (${pct}%)<br>
           <strong>Certificate:</strong> ${tier}<br>
           ${rankHtml}
         </p>
         ${resultLinkHtml}
         ${certLinkHtml}`
      : `<p><em>This student did not attempt the examination. Please contact your school if this is an error.</em></p>`;

    const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1f">
  <div style="background:#249ca2;padding:28px 32px;">
    <h1 style="color:#fff;margin:0;font-size:22px;">SALCI Olympiad ${campaignYear}</h1>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Results Published</p>
  </div>
  <div style="padding:28px 32px;">
    <p>Dear Parent / Guardian,</p>
    <p>Results for the <strong>SALCI Olympiad ${campaignYear}</strong> have been published.</p>
    <div style="background:#f5fafa;border-left:4px solid #249ca2;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0;">
      <p style="margin:0 0 8px">
        <strong>Student:</strong> ${student.full_name}<br>
        <strong>Roll Number:</strong> ${student.roll_number}<br>
        <strong>Class:</strong> ${classLabel}<br>
      </p>
    </div>
    ${scoreSection}
    <p>
      Login to view your full report and review your answers:<br>
      <a href="${LOGIN_URL}" style="color:#249ca2;">SALCI Olympiad Portal</a>
    </p>
    <p style="font-size:12px;color:#666;">
      Use your roll number and date of birth (ddmmyy format) to log in.
    </p>
    <hr style="border:none;border-top:1px solid #e8eaed;margin:24px 0;">
    <p style="font-size:12px;color:#888;">
      Best regards,<br>
      <strong>Team SALCI</strong><br>
      <a href="https://app.salci.ai" style="color:#249ca2;">app.salci.ai</a>
    </p>
    <p style="font-size:10px;color:#aaa;">
      PDF links are valid for 7 days. Certificate ID: ${result.certificate_id}
    </p>
  </div>
</body>
</html>`;

    // ── Send via Resend ────────────────────────────────────────────────────────
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "SALCI Olympiad <noreply@salci.org>",
        to: student.parent_email,
        subject: `SALCI Olympiad ${campaignYear} Results — ${student.full_name}`,
        html: htmlBody,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      return json({ error: `Email send failed: ${errBody}` }, 500);
    }

    // ── Update result row ──────────────────────────────────────────────────────
    const { error: updErr } = await supabase
      .from("oly_results")
      .update({
        emailed_to: student.parent_email,
        emailed_at: new Date().toISOString(),
      })
      .eq("id", oly_result_id);
    if (updErr) return json({ error: `Result update failed: ${updErr.message}` }, 500);

    // ── Audit log ─────────────────────────────────────────────────────────────
    await supabase.from("oly_audit_log").insert({
      campaign_id: result.campaign_id,
      oly_school_id: result.oly_school_id,
      actor_id: null,
      actor_role: "super_admin",
      action: "results_email_sent",
      after_json: {
        result_id: oly_result_id,
        emailed_to: student.parent_email,
        has_result_pdf: !!resultPdfUrl,
        has_certificate_pdf: !!certificatePdfUrl,
      },
    });

    return json({ ok: true, emailed_to: student.parent_email }, 200);
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
