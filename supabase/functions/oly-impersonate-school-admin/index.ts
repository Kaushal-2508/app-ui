// Phase 5b — Super-admin impersonation magic link generator.
// POST { oly_school_id, reason } -> { ok, magic_link, target_email }
// Only super_admins can call. Reason is required. 5-minute TTL.
// Magic link gets ?impersonating=1 appended so the banner detects it.
// Every successful call inserts an audit row into oly_impersonation_log.

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
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // §23.1 — explicit JWT argument (never bare getUser())
    const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
    const superUid = userRes?.user?.id;
    if (userErr || !superUid) return json({ error: "Forbidden" }, 403);

    const { data: isSuper, error: roleErr } = await supabase.rpc("is_super_admin", {
      user_id: superUid,
    });
    if (roleErr) return json({ error: `Role check failed: ${roleErr.message}` }, 500);
    if (!isSuper) return json({ error: "Forbidden — super admin only" }, 403);

    let body: { oly_school_id?: string; reason?: string } = {};
    try {
      body = (await req.json()) as { oly_school_id?: string; reason?: string };
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const olySchoolId = body.oly_school_id?.trim();
    const reason = body.reason?.trim();
    if (!olySchoolId) return json({ error: "oly_school_id required" }, 400);
    if (!reason) return json({ error: "Reason required" }, 400);

    // Resolve the oly_school -> institution
    const { data: school, error: schoolErr } = await supabase
      .from("oly_schools")
      .select("id, institution_id")
      .eq("id", olySchoolId)
      .maybeSingle();
    if (schoolErr) return json({ error: `School lookup failed: ${schoolErr.message}` }, 500);
    if (!school) return json({ error: "School not found" }, 404);

    // Resolve the school_admin user_id for that institution
    const { data: targetRole, error: roleLookupErr } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("institution_id", school.institution_id)
      .eq("role", "school_admin")
      .limit(1)
      .maybeSingle();
    if (roleLookupErr) {
      return json({ error: `User role lookup failed: ${roleLookupErr.message}` }, 500);
    }
    if (!targetRole) return json({ error: "No school admin found for this institution" }, 404);

    // Resolve target's email
    const { data: targetProfile, error: profileErr } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", targetRole.user_id)
      .maybeSingle();
    if (profileErr) {
      return json({ error: `Profile lookup failed: ${profileErr.message}` }, 500);
    }
    if (!targetProfile?.email) {
      return json({ error: "Target admin has no email on profile" }, 400);
    }

    // Generate the magic link
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: targetProfile.email,
    });
    if (linkErr || !linkData?.properties?.action_link) {
      return json({
        error: `Magic link generation failed: ${linkErr?.message ?? "no action_link returned"}`,
      }, 500);
    }

    // Audit log
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { error: logErr } = await supabase.from("oly_impersonation_log").insert({
      super_admin_id: superUid,
      impersonated_user_id: targetRole.user_id,
      oly_school_id: olySchoolId,
      reason,
      expires_at: expiresAt,
    });
    if (logErr) {
      // Don't fail the whole call — log but proceed so the super admin still gets the link.
      console.error("[oly-impersonate-school-admin] audit log insert failed", logErr.message);
    }

    // Append ?impersonating=1 (or &) for the client-side banner detection
    const baseUrl = linkData.properties.action_link;
    const separator = baseUrl.includes("?") ? "&" : "?";
    const magicLink = `${baseUrl}${separator}impersonating=1`;

    return json({ ok: true, magic_link: magicLink, target_email: targetProfile.email }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oly-impersonate-school-admin] fatal", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
