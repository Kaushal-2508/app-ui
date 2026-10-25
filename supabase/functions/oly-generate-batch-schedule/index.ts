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
  pc_count: number;
  date_from: string;       // YYYY-MM-DD
  date_to: string;
  day_start_hh_mm: string; // "09:00"
  day_end_hh_mm: string;   // "16:00"
  buffer_minutes: number;  // min 15
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
    if (input.buffer_minutes < 15) return json({ error: "buffer_minutes must be >= 15" }, 400);

    // Verify caller is school_admin
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: input.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Load school + campaign
    const { data: school } = await supabase
      .from("oly_schools").select("status, campaign_id").eq("id", input.oly_school_id).single();
    if (!school || school.status !== "enrollment_closed") {
      return json({ error: "Schedule can only be generated when enrollment is closed" }, 409);
    }
    const { data: campaign } = await supabase
      .from("oly_campaigns").select("exam_duration_minutes").eq("id", school.campaign_id).single();
    const slotMinutes = (campaign?.exam_duration_minutes ?? 90) + input.buffer_minutes;

    // Load active students grouped by grade_level_id
    const { data: students } = await supabase
      .from("oly_students")
      .select("id, grade_level_id, class_label")
      .eq("oly_school_id", input.oly_school_id)
      .eq("status", "active");

    const byGrade = new Map<string, Array<{ id: string; class_label: string }>>();
    for (const s of students ?? []) {
      if (!s.grade_level_id) continue;
      const arr = byGrade.get(s.grade_level_id) ?? [];
      arr.push({ id: s.id, class_label: s.class_label });
      byGrade.set(s.grade_level_id, arr);
    }

    // Greedy: per-class batches of pc_count, sequentially placed
    const batches: Array<{
      scheduled_at: string;
      grade_level_id: string;
      student_ids: string[];
      pc_count: number;
      batch_label: string;
      mergeable: boolean;
    }> = [];

    // India is UTC+5:30 (no DST). All scheduled_at values are stored in UTC but
    // represent IST wall-clock times provided by the admin.
    const IST_OFFSET = "+05:30";
    let cursor = new Date(`${input.date_from}T${input.day_start_hh_mm}:00${IST_OFFSET}`);
    const dayEndTime = input.day_end_hh_mm;
    const dateTo = new Date(`${input.date_to}T${dayEndTime}:00${IST_OFFSET}`);

    function rollForwardToValidSlot(d: Date): Date {
      // Extract IST calendar date from d (which is a UTC timestamp).
      // IST is UTC+5:30. We want: what day is it in IST when the UTC timestamp is d?
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const istMs = d.getTime() + IST_OFFSET_MS;
      const istDate = new Date(istMs);
      const y = istDate.getUTCFullYear();
      const m = istDate.getUTCMonth();
      const dayNum = istDate.getUTCDate();

      // Build dayEnd in IST for the current IST date.
      // Use Date.UTC (unambiguous UTC by definition) then subtract the IST offset.
      const [eh, em] = dayEndTime.split(":").map(Number);
      const dayEndUtcMs = Date.UTC(y, m, dayNum, eh, em, 0) - IST_OFFSET_MS;
      const dayEnd = new Date(dayEndUtcMs);

      if (d > dayEnd) {
        // Roll to next IST day's start time
        const [sh, sm] = input.day_start_hh_mm.split(":").map(Number);
        const nextStartUtcMs = Date.UTC(y, m, dayNum + 1, sh, sm, 0) - IST_OFFSET_MS;
        return new Date(nextStartUtcMs);
      }
      return d;
    }

    const gradeEntries = Array.from(byGrade.entries());
    for (const [gradeId, gradeStudents] of gradeEntries) {
      let batchIdx = 1;
      for (let i = 0; i < gradeStudents.length; i += input.pc_count) {
        cursor = rollForwardToValidSlot(cursor);
        if (cursor > dateTo) {
          // Out of date range
          return json({ error: "Not enough time slots in date range to fit all batches", unscheduled_count: gradeStudents.length - i }, 409);
        }
        const chunk = gradeStudents.slice(i, i + input.pc_count);
        const isUnderUsed = chunk.length < input.pc_count * 0.5;
        batches.push({
          scheduled_at: cursor.toISOString(),
          grade_level_id: gradeId,
          student_ids: chunk.map((s) => s.id),
          pc_count: input.pc_count,
          batch_label: `${chunk[0].class_label} - Batch ${batchIdx}`,
          mergeable: isUnderUsed,
        });
        batchIdx++;
        cursor = new Date(cursor.getTime() + slotMinutes * 60 * 1000);
      }
    }

    // Audit (action: batch_draft_generated)
    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id: input.oly_school_id,
      actor_id: userId,
      actor_role: isSuper ? "super_admin" : "school_admin",
      action: "batch_draft_generated",
      after_json: { batch_count: batches.length, total_students: (students ?? []).length },
    });

    return json({ batches, unscheduled_count: 0 }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
