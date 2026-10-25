// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_FIELDS = new Set([
  "full_name", "section_label", "parent_name", "parent_phone", "parent_email"
]);

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

    const { oly_student_id, updates } = (await req.json()) as {
      oly_student_id: string;
      updates: Record<string, unknown>;
    };

    // Reject locked fields
    for (const k of Object.keys(updates)) {
      if (!ALLOWED_FIELDS.has(k)) {
        return json({ error: `Field '${k}' is locked and cannot be edited` }, 400);
      }
    }
    if (updates.parent_phone && !/^[6-9]\d{9}$/.test(String(updates.parent_phone))) {
      return json({ error: "Invalid Indian mobile number" }, 400);
    }

    // Fetch current student
    const { data: current, error: fetchErr } = await supabase
      .from("oly_students")
      .select("id, oly_school_id, campaign_id, grade_level_id, full_name, section_label, parent_name, parent_phone, parent_email")
      .eq("id", oly_student_id)
      .single();
    if (fetchErr || !current) return json({ error: "Student not found" }, 404);

    // Authorize
    const { data: isTeacher } = await supabase.rpc("oly_is_teacher_for_class", {
      p_uid: userId, p_oly_school_id: current.oly_school_id, p_grade_level_id: current.grade_level_id,
    });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: current.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isTeacher && !isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    const beforeSnapshot = {
      full_name: current.full_name,
      section_label: current.section_label,
      parent_name: current.parent_name,
      parent_phone: current.parent_phone,
      parent_email: current.parent_email,
    };

    const { error: updErr } = await supabase
      .from("oly_students")
      .update(updates)
      .eq("id", oly_student_id);
    if (updErr) return json({ error: updErr.message }, 500);

    await supabase.from("oly_audit_log").insert({
      campaign_id: current.campaign_id,
      oly_school_id: current.oly_school_id,
      oly_student_id,
      actor_id: userId,
      actor_role: isTeacher ? "teacher" : (isAdmin ? "school_admin" : "super_admin"),
      action: "student_edited",
      before_json: beforeSnapshot,
      after_json: updates,
    });

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
