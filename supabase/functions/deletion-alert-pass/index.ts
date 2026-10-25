// Bulk deletion alerts: email pass.
// Design: docs/superpowers/specs/2026-09-19-bulk-deletion-alerts-design.md
//
// Driven by pg_cron every 5 minutes. Calls sec_scan_deletion_alerts(), which does
// all detection and incident bookkeeping, then emails whatever it hands back.
//
// This function never decides WHAT is an incident. It only delivers.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Incident = {
  id: string;
  rule: "burst" | "roster" | "sensitive";
  actor_name: string | null;
  institution_name: string | null;
  entity_types: string[];
  sample_names: string[];
  event_count: number;
  first_event_at: string;
  last_event_at: string;
  actor_id: string | null;
};

const IST = "Asia/Kolkata";

function ist(iso: string): string {
  // Institution-local time is the only time anyone here reasons in (CLAUDE.md §24).
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

function headline(inc: Incident): string {
  const who = inc.actor_name ?? "Someone";
  const what = inc.entity_types.join(", ") || "records";
  if (inc.rule === "sensitive") {
    return `${who} deleted something critical: ${what}`;
  }
  if (inc.rule === "roster") {
    return `${who} removed ${inc.event_count} teacher class assignments`;
  }
  return `${who} deleted ${inc.event_count} records: ${what}`;
}

function buildEmail(inc: Incident, appOrigin: string): { subject: string; html: string } {
  const sev = inc.rule === "sensitive" ? "CRITICAL" : "ALERT";
  const school = inc.institution_name ?? "unknown school";
  const subject = `[SALCI ${sev}] ${headline(inc)} · ${school}`;

  // /admin/activity is the super-admin view of system_audit_logs.
  const link = `${appOrigin}/admin/activity`;
  const samples = inc.sample_names.slice(0, 10);

  const rows: Array<[string, string]> = [
    ["Who", inc.actor_name ?? "System or cron (no signed-in user)"],
    ["School", school],
    ["What", inc.entity_types.join(", ") || "unknown"],
    ["How many", String(inc.event_count)],
    ["Started", `${ist(inc.first_event_at)} IST`],
    ["Last seen", `${ist(inc.last_event_at)} IST`],
    ["Rule", inc.rule],
  ];

  const rowHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#64748b;white-space:nowrap">${escapeHtml(k)}</td>` +
        `<td style="padding:6px 0;color:#0f172a;font-weight:600">${escapeHtml(v)}</td></tr>`
    )
    .join("");

  const sampleHtml = samples.length
    ? `<p style="margin:20px 0 6px;color:#64748b;font-size:13px">Examples of what was removed:</p>
       <ul style="margin:0;padding-left:20px;color:#0f172a;font-size:13px">
         ${samples.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
       </ul>
       ${inc.event_count > samples.length ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px">and ${inc.event_count - samples.length} more</p>` : ""}`
    : "";

  const accent = inc.rule === "sensitive" ? "#b91c1c" : "#c2410c";

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#ffffff;border-radius:12px;padding:24px;border-top:4px solid ${accent}">
      <p style="margin:0 0 4px;color:${accent};font-size:12px;font-weight:700;letter-spacing:.08em">${sev}</p>
      <h1 style="margin:0 0 16px;font-size:18px;line-height:1.35;color:#0f172a">${escapeHtml(headline(inc))}</h1>
      <table style="border-collapse:collapse;font-size:14px">${rowHtml}</table>
      ${sampleHtml}
      <p style="margin:24px 0 0">
        <a href="${link}" style="display:inline-block;background:#249ca2;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Open the activity log</a>
      </p>
      <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">
        You get this because deletions crossed a threshold. Nothing has been blocked or reversed.
        If this was expected, no action is needed.
      </p>
    </div>
  </div></body></html>`;

  return { subject, html };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: "Supabase env vars missing" });
    }

    // Comma separated, so adding a recipient never needs a redeploy.
    const recipients = (Deno.env.get("ALERT_EMAIL_TO") ?? "tushar@salci.in")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const from = Deno.env.get("ALERT_EMAIL_FROM") ?? "SALCI Alerts <team@salci.in>";
    const appOrigin = Deno.env.get("ALERT_APP_ORIGIN") ?? "https://app.salci.ai";

    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin.rpc("sec_scan_deletion_alerts");
    if (error) {
      console.error("scan failed:", error.message);
      return jsonResponse(500, { error: `scan failed: ${error.message}` });
    }

    const incidents = (data ?? []) as Incident[];
    if (incidents.length === 0) {
      return jsonResponse(200, { scanned: true, incidents: 0, sent: 0 });
    }

    let sent = 0;
    let failed = 0;

    for (const inc of incidents) {
      // One bad email must not strand the rest of the batch.
      try {
        if (!resendKey) throw new Error("RESEND_API_KEY not set");

        const { subject, html } = buildEmail(inc, appOrigin);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to: recipients, subject, html }),
        });

        if (!res.ok) {
          throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }

        await admin.rpc("sec_mark_deletion_alert_sent", { _incident_id: inc.id });
        sent += 1;
      } catch (e) {
        // Leave notified_at NULL so the next pass retries; record why it failed.
        failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        console.error(`alert ${inc.id} failed:`, message);
        await admin.rpc("sec_mark_deletion_alert_sent", {
          _incident_id: inc.id,
          _error: message.slice(0, 500),
        });
      }
    }

    return jsonResponse(200, { scanned: true, incidents: incidents.length, sent, failed });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("deletion-alert-pass crashed:", message);
    return jsonResponse(500, { error: message });
  }
});
