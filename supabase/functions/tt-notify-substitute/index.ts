import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// -------------------------------------------------------------
// tt-notify-substitute
//
// Fires from the client right after a cover is assigned, from either
// the class workspace (useUpsertSubstitution) or the Attendance >
// Substitutions tab (useAssignSubstitute, via tt_assign_substitute).
// Sends two in-app notifications:
//   1. The substitute teacher ("You're covering a class")
//   2. The original teacher ("Your period is covered")
//
// Auth:    JWT-gated, and the caller must be able to arrange cover
//          for the class (tt_user_can_edit_slot: admin, coordinator
//          of the wing, timetable manager). Being able to READ the
//          row is not enough: every staff member of the school can,
//          so that check alone let any teacher send these to anyone.
// Payload: { substitution_id }
// Returns: { ok: true, notified: 2 | 1 }
// -------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Payload {
  substitution_id?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { substitution_id }: Payload = await req.json().catch(() => ({}));
    if (!substitution_id || typeof substitution_id !== "string") {
      return json({ error: "substitution_id required" }, 400);
    }

    // RLS-scoped read: if the caller can't SELECT this substitution
    // they had no business notifying for it. This also bounds tenant
    // leakage.
    const { data: subRow, error: subErr } = await anonClient
      .from("tt_substitutions")
      .select("id, slot_id, date, status, substitute_teacher_id, original_teacher_id, reason")
      .eq("id", substitution_id)
      .maybeSingle();
    if (subErr || !subRow) {
      return json({ error: "Substitution not accessible" }, 403);
    }

    // Reading is open to all staff; sending is for whoever arranges cover.
    const { data: canArrange, error: canErr } = await anonClient.rpc(
      "tt_user_can_edit_slot",
      { p_user: claimsData.claims.sub, p_slot_id: subRow.slot_id },
    );
    if (canErr || canArrange !== true) {
      return json({ error: "Not allowed to notify for this class" }, 403);
    }

    // A pending row has nobody to notify yet.
    if (
      !subRow.substitute_teacher_id ||
      !["assigned", "completed"].includes(subRow.status as string)
    ) {
      return json({ error: "This period has no substitute assigned yet" }, 400);
    }

    // Service client for the notification inserts — writing to
    // notifications rows belonging to OTHER users requires
    // elevated privileges.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load the slot + class + period context for nice-looking
    // notification text.
    const { data: slotRow, error: slotErr } = await supabase
      .from("tt_slots")
      .select(
        "id, teacher_id, class:classes(name, section), period:tt_period_slots(label, start_time, end_time)",
      )
      .eq("id", subRow.slot_id)
      .maybeSingle();
    if (slotErr || !slotRow) {
      return json({ error: "Slot not found" }, 404);
    }

    const classLabel = slotRow.class
      ? slotRow.class.section
        ? `${slotRow.class.name} - ${slotRow.class.section}`
        : slotRow.class.name
      : "class";
    const periodLabel = slotRow.period
      ? `${slotRow.period.label} (${(slotRow.period.start_time as string).slice(0, 5)}-${(slotRow.period.end_time as string).slice(0, 5)})`
      : "this period";
    const link = `/teacher/my-week`;
    // "28 Sep 2026", read as a calendar date (no timezone shift).
    const dateLabel = new Date(`${subRow.date}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });

    // Basket periods carry no teacher on the slot; the row's
    // original_teacher_id is the teacher who was actually out.
    const originalTeacherId =
      (subRow.original_teacher_id as string | null) ?? (slotRow.teacher_id as string | null);

    const nameIds = [subRow.substitute_teacher_id, originalTeacherId].filter(
      (id): id is string => !!id,
    );
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", nameIds);
    const nameOf = (id: string | null) =>
      (people ?? []).find((p) => p.id === id)?.full_name as string | undefined;
    const substituteName = nameOf(subRow.substitute_teacher_id as string);
    const originalName = nameOf(originalTeacherId);

    const rowsToInsert = [
      {
        user_id: subRow.substitute_teacher_id,
        type: "tt_substitute_assigned",
        title: "You're covering a class",
        message: `${classLabel} · ${periodLabel} on ${dateLabel}${
          originalName ? ` · for ${originalName}` : ""
        }${subRow.reason ? ` · ${subRow.reason}` : ""}`,
        link,
        is_read: false,
        metadata: {
          substitution_id: subRow.id,
          slot_id: subRow.slot_id,
          date: subRow.date,
        },
      },
    ] as Record<string, unknown>[];

    if (originalTeacherId && originalTeacherId !== subRow.substitute_teacher_id) {
      rowsToInsert.push({
        user_id: originalTeacherId,
        type: "tt_marked_absent",
        title: "Your period is covered",
        message: `${classLabel} · ${periodLabel} on ${dateLabel} is covered by ${
          substituteName ?? "a colleague"
        }.`,
        link,
        is_read: false,
        metadata: {
          substitution_id: subRow.id,
          slot_id: subRow.slot_id,
          date: subRow.date,
          substitute_teacher_id: subRow.substitute_teacher_id,
        },
      });
    }

    const { error: insertErr } = await supabase
      .from("notifications")
      .insert(rowsToInsert);
    if (insertErr) {
      return json({ error: insertErr.message }, 500);
    }

    return json({ ok: true, notified: rowsToInsert.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
