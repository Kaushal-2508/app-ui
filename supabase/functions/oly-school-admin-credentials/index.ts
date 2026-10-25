// Super-admin: (re)set a readable temporary password for a school's admin and
// return the login credentials, so the SALCI super-admin can hand "email + password"
// to a school whenever needed (the one-time onboarding reset link expires).
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Password = school short code + numerics (e.g. "OPS0MF4821"). Distinct per school.
function passwordFromCode(code: string): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  return `${code}${digits}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userRes } = await supabase.auth.getUser(token);
    const callerId = userRes?.user?.id;
    if (!callerId) return json({ error: "Forbidden" }, 403);
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: callerId });
    if (!isSuper) return json({ error: "Forbidden — super admin only" }, 403);

    const { oly_school_id } = (await req.json()) as { oly_school_id: string };
    if (!oly_school_id) return json({ error: "oly_school_id required" }, 400);

    const { data: school } = await supabase
      .from("oly_schools")
      .select("institution_id, primary_contact_email, school_short_code")
      .eq("id", oly_school_id)
      .single();
    if (!school?.institution_id) return json({ error: "School has no linked institution" }, 404);

    const { data: inst } = await supabase
      .from("institutions")
      .select("code")
      .eq("id", school.institution_id)
      .single();

    // Find a school_admin for this institution; prefer the one matching the contact email.
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("institution_id", school.institution_id)
      .eq("role", "school_admin");
    if (!roles || roles.length === 0) {
      return json({ error: "No school admin found for this institution" }, 404);
    }

    const userIds = (roles as { user_id: string }[]).map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    const rows = (profiles ?? []) as { id: string; email: string | null }[];
    const contact = school.primary_contact_email?.toLowerCase() ?? "";
    const target = rows.find((p) => (p.email ?? "").toLowerCase() === contact) ?? rows[0];
    if (!target) return json({ error: "School admin profile not found" }, 404);

    const tempPassword = passwordFromCode(school.school_short_code);
    const { error: updErr } = await supabase.auth.admin.updateUserById(target.id, { password: tempPassword });
    if (updErr) return json({ error: `Password reset failed: ${updErr.message}` }, 500);

    // @ts-expect-error Deno.env
    const base = (Deno.env.get("SALCI_APP_URL") ?? "https://app.salci.ai").replace(/\/$/, "");

    return json({
      ok: true,
      admin_email: target.email ?? school.primary_contact_email,
      temp_password: tempPassword,
      institute_code: inst?.code ?? "",
      login_url: `${base}/login`,
    }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
