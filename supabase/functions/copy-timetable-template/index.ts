import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// -------------------------------------------------------------
// copy-timetable-template
//
// Copies every timetable_slots row from a source academic year
// into a target year for the same institution. Teacher/resource
// assignments carry over. lesson_plans are NEVER copied — each
// year gets a clean slate for lesson planning.
//
// Auth:     JWT-gated; caller must be super_admin, super_school_admin,
//           or school_admin of the institution.
// Payload:  { institution_id, source_academic_year, target_academic_year }
// Returns:  { copied: number, skipped: number, total_source: number }
// -------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Payload {
  institution_id?: string;
  source_academic_year?: string;
  target_academic_year?: string;
}

interface SourceSlot {
  class_id: string;
  day: string;
  period_slot_id: string;
  slot_type: string;
  subject_id: string | null;
  teacher_id: string | null;
  resource_id: string | null;
  custom_label: string | null;
  // Optional-group cells carry across years — groups are class_group-
  // scoped (not AY-scoped), so the FK stays valid in the target year.
  optional_group_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // === AUTH CHECK ===
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
    const userId = claimsData.claims.sub as string;

    // === SERVICE CLIENT ===
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const {
      institution_id,
      source_academic_year,
      target_academic_year,
    }: Payload = await req.json();

    if (!institution_id || !source_academic_year || !target_academic_year) {
      return json(
        {
          error:
            "institution_id, source_academic_year, and target_academic_year are required",
        },
        400,
      );
    }

    if (source_academic_year === target_academic_year) {
      return json(
        { error: "Source and target academic years must differ" },
        400,
      );
    }

    // === ROLE CHECK ===
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["super_admin", "super_school_admin", "school_admin"])
      .limit(1)
      .maybeSingle();

    if (!roleData) {
      // Per-user timetable-manager grant (tt_manager_overrides): a named
      // non-admin user with full timetable management rights for their own
      // institution. Mirrors the RLS override added in migration
      // 20260710120000_tt_manager_overrides.sql.
      const { data: override } = await supabase
        .from("tt_manager_overrides")
        .select("institution_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!override || override.institution_id !== institution_id) {
        return json({ error: "Forbidden: admin role required" }, 403);
      }
    }

    // Everyone below super_admin (school admins AND override holders)
    // must belong to the target institution.
    if (!roleData || roleData.role !== "super_admin") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", userId)
        .single();

      if (profile?.institution_id !== institution_id) {
        return json({ error: "Forbidden: institution mismatch" }, 403);
      }
    }

    // === LOAD SOURCE SLOTS ===
    const { data: sourceRows, error: srcErr } = await supabase
      .from("tt_slots")
      .select(
        "class_id, day, period_slot_id, slot_type, subject_id, teacher_id, resource_id, custom_label, optional_group_id",
      )
      .eq("institution_id", institution_id)
      .eq("academic_year", source_academic_year);

    if (srcErr) throw srcErr;

    const rows = (sourceRows ?? []) as SourceSlot[];
    if (rows.length === 0) {
      return json({
        copied: 0,
        skipped: 0,
        total_source: 0,
        message: `No slots found in ${source_academic_year} to copy.`,
      });
    }

    // === BATCH UPSERT INTO TARGET YEAR ===
    const payload = rows.map((r) => ({
      institution_id,
      academic_year: target_academic_year,
      class_id: r.class_id,
      day: r.day,
      period_slot_id: r.period_slot_id,
      slot_type: r.slot_type,
      subject_id: r.subject_id,
      teacher_id: r.teacher_id,
      resource_id: r.resource_id,
      custom_label: r.custom_label,
      optional_group_id: r.optional_group_id,
      created_by: userId,
    }));

    // Existing count in target so we can compute skipped vs copied.
    const { count: preExisting, error: countErr } = await supabase
      .from("tt_slots")
      .select("*", { count: "exact", head: true })
      .eq("institution_id", institution_id)
      .eq("academic_year", target_academic_year);
    if (countErr) throw countErr;

    const { error: insErr } = await supabase
      .from("tt_slots")
      .upsert(payload, {
        onConflict: "class_id,academic_year,day,period_slot_id",
        ignoreDuplicates: true,
      });
    if (insErr) throw insErr;

    const { count: postCount, error: postCountErr } = await supabase
      .from("tt_slots")
      .select("*", { count: "exact", head: true })
      .eq("institution_id", institution_id)
      .eq("academic_year", target_academic_year);
    if (postCountErr) throw postCountErr;

    const copied = (postCount ?? 0) - (preExisting ?? 0);
    const skipped = rows.length - copied;

    return json({
      copied,
      skipped,
      total_source: rows.length,
    });
  } catch (error) {
    console.error("copy-timetable-template error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
