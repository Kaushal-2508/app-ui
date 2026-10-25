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

    const { oly_school_id, assignments } = (await req.json()) as {
      oly_school_id: string;
      assignments: Array<{ teacher_profile_id: string; grade_level_ids: string[] }>;
    };

    const { data: school } = await supabase
      .from("oly_schools")
      .select("id, institution_id, campaign_id, is_existing_salci_school")
      .eq("id", oly_school_id)
      .single();
    if (!school) return json({ error: "School not found" }, 404);
    if (!school.is_existing_salci_school) return json({ error: "Use oly-create-teacher for new schools" }, 400);

    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    for (const a of assignments) {
      // Verify teacher belongs to this institution and has teacher role
      const { data: role } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("user_id", a.teacher_profile_id)
        .eq("role", "teacher")
        .eq("institution_id", school.institution_id)
        .maybeSingle();
      if (!role) {
        return json({ error: `Teacher ${a.teacher_profile_id} not found at this institution` }, 400);
      }

      // Delete existing assignments for (teacher, school, campaign), then insert new set
      await supabase
        .from("oly_teacher_class_assignments")
        .delete()
        .eq("oly_school_id", oly_school_id)
        .eq("campaign_id", school.campaign_id)
        .eq("teacher_profile_id", a.teacher_profile_id);

      if (a.grade_level_ids.length > 0) {
        const rows = a.grade_level_ids.map((gid) => ({
          campaign_id: school.campaign_id,
          oly_school_id,
          teacher_profile_id: a.teacher_profile_id,
          grade_level_id: gid,
          assigned_by: userId,
        }));
        const { error: insErr } = await supabase
          .from("oly_teacher_class_assignments")
          .insert(rows);
        if (insErr) return json({ error: insErr.message }, 500);
      }

      await supabase.from("oly_audit_log").insert({
        campaign_id: school.campaign_id,
        oly_school_id,
        actor_id: userId,
        actor_role: isSuper ? "super_admin" : "school_admin",
        action: "teacher_assigned",
        after_json: { teacher_profile_id: a.teacher_profile_id, grade_level_ids: a.grade_level_ids },
      });
    }

    return json({ ok: true, processed: assignments.length }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
