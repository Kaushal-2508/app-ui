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
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);

    const { oly_school_id, mode = "now", closes_at } = (await req.json()) as {
      oly_school_id: string;
      mode?: "schedule" | "now" | "cancel";
      closes_at?: string;
    };

    const { data: school } = await supabase
      .from("oly_schools")
      .select("id, campaign_id, status")
      .eq("id", oly_school_id)
      .single();
    if (!school) return json({ error: "School not found" }, 404);

    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Precondition: scheduling / cancelling / closing only makes sense while enrollment is open.
    if (school.status !== "enrollment_open") {
      return json({ error: `Cannot change enrollment closure from status '${school.status}'` }, 409);
    }

    const actorRole = isSuper ? "super_admin" : "school_admin";

    if (mode === "schedule") {
      if (!closes_at || new Date(closes_at).getTime() <= Date.now()) {
        return json({ error: "closes_at must be a future timestamp" }, 400);
      }
      const { error } = await supabase
        .from("oly_schools")
        .update({ enrollment_closes_at: closes_at })
        .eq("id", oly_school_id);
      if (error) return json({ error: error.message }, 500);
      await supabase.from("oly_audit_log").insert({
        campaign_id: school.campaign_id,
        oly_school_id,
        actor_id: userId,
        actor_role: actorRole,
        action: "enrollment_close_scheduled",
        after_json: { enrollment_closes_at: closes_at },
      });
      return json({ ok: true }, 200);
    }

    if (mode === "cancel") {
      const { error } = await supabase
        .from("oly_schools")
        .update({ enrollment_closes_at: null })
        .eq("id", oly_school_id);
      if (error) return json({ error: error.message }, 500);
      await supabase.from("oly_audit_log").insert({
        campaign_id: school.campaign_id,
        oly_school_id,
        actor_id: userId,
        actor_role: actorRole,
        action: "enrollment_close_cancelled",
      });
      return json({ ok: true }, 200);
    }

    // mode === "now" — existing behavior; also clear any scheduled date.
    const { error: updErr } = await supabase
      .from("oly_schools")
      .update({ status: "enrollment_closed", enrollment_closes_at: null })
      .eq("id", oly_school_id);
    if (updErr) return json({ error: updErr.message }, 500);

    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id,
      actor_id: userId,
      actor_role: actorRole,
      action: "enrollment_closed",
      before_json: { status: "enrollment_open" },
      after_json: { status: "enrollment_closed" },
    });

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
