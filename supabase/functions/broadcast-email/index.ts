import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_ADDRESS = Deno.env.get("LMS_RESEND_FROM_EMAIL") ?? "SALCI Team <team@salci.in>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Recipient = { id: string; email: string; full_name: string | null; role: string };

interface BroadcastRequest {
  institution_name_pattern?: string;
  roles?: string[];
  subject: string;
  html_body: string;
  text_body?: string;
  preview_only_email?: string;
  actor_id?: string;
  entity_name?: string;
  from_address?: string;
  cc?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Service-role guard: only operators (CLI / Management API callers) may trigger broadcasts.
    // verify_jwt accepts any logged-in user's JWT, so we additionally require the role claim
    // to be "service_role" — keeps students/teachers from hitting this endpoint with their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    try {
      const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
      if (payload?.role !== "service_role") return json(403, { error: "service_role required" });
    } catch {
      return json(401, { error: "missing or malformed bearer token" });
    }

    const body = (await req.json()) as BroadcastRequest;
    if (!body.subject || !body.html_body) return json(400, { error: "subject and html_body are required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const pattern = body.institution_name_pattern ?? "%alliance%international%";
    const roles = body.roles ?? ["teacher", "coordinator", "school_admin", "super_school_admin"];

    const { data: institutions, error: instErr } = await supabase
      .from("institutions")
      .select("id, name")
      .ilike("name", pattern)
      .limit(5);
    if (instErr) return json(500, { error: `institution lookup: ${instErr.message}` });
    if (!institutions || institutions.length === 0) return json(404, { error: `no institution matches ${pattern}` });
    if (institutions.length > 1) return json(400, { error: `pattern matches multiple institutions`, institutions });

    const institution = institutions[0];

    const { data: roleRows, error: roleErr } = await supabase
      .from("user_roles")
      .select("role, user_id")
      .in("role", roles);
    if (roleErr) return json(500, { error: `role query: ${roleErr.message}` });
    if (!roleRows || roleRows.length === 0) return json(200, { batch_id: crypto.randomUUID(), institution, total: 0, sent: 0, failed: 0, results: [] });

    const userIds = Array.from(new Set(roleRows.map((r) => r.user_id)));
    const userRoleMap = new Map<string, string>();
    for (const r of roleRows) {
      const existing = userRoleMap.get(r.user_id);
      const priority = (role: string) =>
        role === "super_school_admin" ? 4 : role === "school_admin" ? 3 : role === "coordinator" ? 2 : 1;
      if (!existing || priority(r.role) > priority(existing)) userRoleMap.set(r.user_id, r.role);
    }

    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .eq("institution_id", institution.id)
      .in("id", userIds);
    if (profErr) return json(500, { error: `profile query: ${profErr.message}` });

    const seen = new Set<string>();
    const allRecipients: Recipient[] = [];
    for (const p of profiles ?? []) {
      if (!p.email) continue;
      const key = p.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      allRecipients.push({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        role: userRoleMap.get(p.id) ?? "unknown",
      });
    }

    const recipients = body.preview_only_email
      ? allRecipients.filter((r) => r.email.toLowerCase() === body.preview_only_email!.toLowerCase())
      : allRecipients;

    if (body.preview_only_email && recipients.length === 0) {
      const adminFallback: Recipient = {
        id: "00000000-0000-0000-0000-000000000000",
        email: body.preview_only_email,
        full_name: "Preview Recipient",
        role: "preview",
      };
      recipients.push(adminFallback);
    }

    const batchId = crypto.randomUUID();
    const results: Array<{ email: string; role: string; status: "sent" | "failed"; resend_id?: string; error?: string }> = [];

    for (const r of recipients) {
      const personalizedHtml = body.html_body.replace(/{{\s*name\s*}}/gi, r.full_name?.split(" ")[0] ?? "there");
      const personalizedText = body.text_body?.replace(/{{\s*name\s*}}/gi, r.full_name?.split(" ")[0] ?? "there");

      try {
        const { data, error } = await resend.emails.send({
          from: body.from_address ?? FROM_ADDRESS,
          to: [r.email],
          cc: body.cc && body.cc.length > 0 ? body.cc : undefined,
          subject: body.subject,
          html: personalizedHtml,
          text: personalizedText,
        });
        if (error) throw new Error(typeof error === "string" ? error : JSON.stringify(error));

        results.push({ email: r.email, role: r.role, status: "sent", resend_id: data?.id });

        await supabase.from("system_audit_logs").insert({
          actor_id: body.actor_id ?? null,
          action: "broadcast_email_sent",
          entity_type: "broadcast_email",
          entity_id: batchId,
          entity_name: body.entity_name ?? `Broadcast to ${institution.name}`,
          new_values: { recipient_email: r.email, recipient_id: r.id, role: r.role, resend_id: data?.id },
          metadata: { institution_id: institution.id, institution_name: institution.name, subject: body.subject, preview: Boolean(body.preview_only_email) },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ email: r.email, role: r.role, status: "failed", error: msg });

        await supabase.from("system_audit_logs").insert({
          actor_id: body.actor_id ?? null,
          action: "broadcast_email_failed",
          entity_type: "broadcast_email",
          entity_id: batchId,
          entity_name: body.entity_name ?? `Broadcast to ${institution.name}`,
          new_values: { recipient_email: r.email, recipient_id: r.id, role: r.role, error: msg },
          metadata: { institution_id: institution.id, institution_name: institution.name, subject: body.subject, preview: Boolean(body.preview_only_email) },
        });
      }

      await new Promise((res) => setTimeout(res, 150));
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return json(200, {
      batch_id: batchId,
      institution: { id: institution.id, name: institution.name },
      preview: Boolean(body.preview_only_email),
      total: recipients.length,
      sent,
      failed,
      results,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
