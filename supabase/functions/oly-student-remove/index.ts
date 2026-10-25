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

    const { oly_student_id, reason } = (await req.json()) as { oly_student_id: string; reason: string };
    if (!reason?.trim()) return json({ error: "Reason required" }, 400);

    const { data: current } = await supabase
      .from("oly_students")
      .select("id, oly_school_id, campaign_id, grade_level_id, enrollment_channel, status")
      .eq("id", oly_student_id)
      .single();
    if (!current) return json({ error: "Student not found" }, 404);
    if (current.status === "removed") return json({ error: "Already removed" }, 409);

    const { data: isTeacher } = await supabase.rpc("oly_is_teacher_for_class", {
      p_uid: userId, p_oly_school_id: current.oly_school_id, p_grade_level_id: current.grade_level_id,
    });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: current.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isTeacher && !isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Update first — abort on failure before touching financials
    const { error: updErr } = await supabase
      .from("oly_students")
      .update({
        status: "removed",
        removed_at: new Date().toISOString(),
        removed_by: userId,
        removed_reason: reason,
      })
      .eq("id", oly_student_id);
    if (updErr) return json({ error: updErr.message }, 500);

    await supabase.from("oly_audit_log").insert({
      campaign_id: current.campaign_id,
      oly_school_id: current.oly_school_id,
      oly_student_id,
      actor_id: userId,
      actor_role: isTeacher ? "teacher" : (isAdmin ? "school_admin" : "super_admin"),
      action: "student_removed",
      before_json: { status: current.status, enrollment_channel: current.enrollment_channel },
      after_json: { status: "removed" },
      reason,
    });

    // Refund after successful update (fire-and-forget for online; awaited for cash marker)
    if (current.enrollment_channel === "parent_online") {
      supabase.functions.invoke("oly-refund-issue", {
        body: { scope: "per_student", oly_student_id, reason: `Removed by school: ${reason}` },
      }).catch(() => {});
    } else {
      // Cash — insert offline refund marker
      await supabase.from("oly_refunds").insert({
        oly_student_id,
        initiated_by: userId,
        reason: `Removed by school: ${reason}`,
        scope: "per_student",
        amount_rupees: 0,
        status: "offline",
      });
    }

    return json({ ok: true, enrollment_channel: current.enrollment_channel }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
