// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Input = {
  oly_school_id: string;
  batches: Array<{
    scheduled_at: string;
    grade_level_id: string | null;
    student_ids: string[];
    pc_count: number;
    batch_label: string;
    pin_expiry_minutes?: number;
    is_absentees?: boolean;
  }>;
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

    const input = (await req.json()) as Input;

    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: input.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    const { data: school } = await supabase
      .from("oly_schools").select("status, campaign_id").eq("id", input.oly_school_id).single();
    if (!school) return json({ error: "School not found" }, 404);
    const isAbsenteesOnly = input.batches.every((b) => b.is_absentees === true);
    if (!isAbsenteesOnly && school.status !== "enrollment_closed") {
      return json({ error: "Lock requires enrollment_closed status" }, 409);
    }

    const batchIds: string[] = [];
    for (const b of input.batches) {
      const { data: pinData } = await supabase.rpc("oly_generate_batch_pin");
      const pin = pinData as string;
      const { data: row, error: insErr } = await supabase
        .from("oly_batches")
        .insert({
          campaign_id: school.campaign_id,
          oly_school_id: input.oly_school_id,
          grade_level_id: b.grade_level_id,
          batch_label: b.batch_label,
          scheduled_at: b.scheduled_at,
          pc_count: b.pc_count,
          pin,
          pin_expiry_minutes: b.pin_expiry_minutes ?? 120,
          is_absentees: b.is_absentees ?? false,
          status: "locked",
          locked_at: new Date().toISOString(),
          created_by: userId,
        })
        .select("id")
        .single();
      if (insErr || !row) return json({ error: insErr?.message ?? "Batch insert failed" }, 500);
      batchIds.push(row.id);

      // Assignments (delete any existing first, then insert).
      // Scope the delete to this school's batches only — deleting by student_id alone
      // would accidentally remove assignments from other schools if a student somehow
      // appears in multiple schools (defensive guard).
      // TODO(follow-up): wrap the entire lock loop in a SECURITY DEFINER RPC for
      // true atomicity — a mid-loop failure leaves some batches locked and some not.
      if (b.student_ids.length > 0) {
        const { data: schoolBatches } = await supabase
          .from("oly_batches")
          .select("id")
          .eq("oly_school_id", input.oly_school_id);
        const schoolBatchIds = (schoolBatches ?? []).map((sb: { id: string }) => sb.id);

        const { error: delErr } = schoolBatchIds.length > 0
          ? await supabase
              .from("oly_batch_assignments")
              .delete()
              .in("oly_student_id", b.student_ids)
              .in("oly_batch_id", schoolBatchIds)
          : { error: null };
        if (delErr) return json({ error: `Failed to clear previous assignments: ${(delErr as { message: string }).message}`, partialBatchIds: batchIds }, 500);
        const assignRows = b.student_ids.map((sid) => ({ oly_batch_id: row.id, oly_student_id: sid }));
        const { error: assignInsErr } = await supabase.from("oly_batch_assignments").insert(assignRows);
        if (assignInsErr) return json({ error: `Failed to assign students: ${assignInsErr.message}`, partialBatchIds: batchIds }, 500);
      }
    }

    // Promote the school into the exam-able state ('batches_scheduled') for a
    // main lock. Also promote for an absentees-only lock when no main batch ever
    // ran (status still 'enrollment_closed') — an absentees batch is still a
    // real scheduled exam batch, and without this its students hit "exam not yet
    // scheduled" in oly_validate_pin. Never downgrade a school that is already
    // 'batches_scheduled' / 'exam_in_progress'.
    if (!isAbsenteesOnly || school.status === "enrollment_closed") {
      await supabase.from("oly_schools").update({ status: "batches_scheduled" }).eq("id", input.oly_school_id);
    }

    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id: input.oly_school_id,
      actor_id: userId,
      actor_role: isSuper ? "super_admin" : "school_admin",
      action: isAbsenteesOnly ? "absentees_batch_created" : "batches_locked",
      after_json: { batch_ids: batchIds, count: batchIds.length },
    });

    return json({ batch_ids: batchIds }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
