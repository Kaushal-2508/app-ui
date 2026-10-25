// Phase 5b — Create a passport_olympiad_entries row for one SALCI student's published Olympiad result.
// Invoked from oly-publish-school-results (Step 4) per SALCI student, or manually by super-admin.
// Idempotent: skips if (student_id, oly_result_id) already exists.
// Non-SALCI students (no profile_id) return { ok: true, skipped: true }.
//
// Important schema note: writes to passport_olympiad_entries (added 20260527005529).
// The pre-existing passport_academic_records is aggregate-only and cannot store per-result rows.

// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Supabase typegen returns joined rows as T | T[] depending on the relation cardinality.
// Use a tiny helper to flatten safely (CLAUDE.md §5a — never `as any`).
function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type OlyStudentJoin = {
  id: string;
  profile_id: string | null;
};

type OlyCampaignJoin = {
  campaign_year: number;
};

type OlyResultRow = {
  id: string;
  total_marks_obtained: number;
  total_max_marks: number;
  percentage: number;
  certificate_tier: string;
  certificate_id: string;
  school_rank: number | null;
  class_rank: number | null;
  result_pdf_path: string | null;
  certificate_pdf_path: string | null;
  oly_school_id: string;
  oly_students: OlyStudentJoin | OlyStudentJoin[] | null;
  oly_campaigns: OlyCampaignJoin | OlyCampaignJoin[] | null;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const internalSecret = Deno.env.get("OLY_INTERNAL_SECRET");
    const supabase = createClient(supabaseUrl, serviceKey);

    // Internal invocation path: orchestrator (oly-publish-school-results Step 4) passes
    // x-internal-secret. When matched, skip user-JWT/role check — orchestrator already
    // verified the school admin's authority to publish.
    const isSystem =
      !!internalSecret && req.headers.get("x-internal-secret") === internalSecret;

    let callerId: string | null = null;
    let isSuper = false;
    let isAdmin = false;

    if (!isSystem) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace("Bearer ", "").trim();
      if (!token) return json({ error: "Missing auth" }, 401);

      // §23.1 — explicit JWT argument
      const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
      callerId = userRes?.user?.id ?? null;
      if (userErr || !callerId) return json({ error: "Forbidden" }, 403);
    }

    let body: { oly_result_id?: string } = {};
    try {
      body = (await req.json()) as { oly_result_id?: string };
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const olyResultId = body.oly_result_id?.trim();
    if (!olyResultId) return json({ error: "oly_result_id required" }, 400);

    // Load result + joined student + campaign in one round trip
    const { data: resultRaw, error: resultErr } = await supabase
      .from("oly_results")
      .select(`
        id, total_marks_obtained, total_max_marks, percentage,
        certificate_tier, certificate_id, school_rank, class_rank,
        result_pdf_path, certificate_pdf_path, oly_school_id,
        oly_students!oly_student_id ( id, profile_id ),
        oly_campaigns!campaign_id ( campaign_year )
      `)
      .eq("id", olyResultId)
      .maybeSingle();
    if (resultErr) return json({ error: `Result lookup failed: ${resultErr.message}` }, 500);
    if (!resultRaw) return json({ error: "Result not found" }, 404);

    const result = resultRaw as OlyResultRow;
    const student = pickOne(result.oly_students);
    const campaign = pickOne(result.oly_campaigns);

    if (!student?.profile_id) {
      return json({ ok: true, skipped: true, reason: "Not a SALCI student" }, 200);
    }
    const profileId = student.profile_id;
    const olyStudentId = student.id;
    const campaignYear = campaign?.campaign_year;
    if (typeof campaignYear !== "number") {
      return json({ error: "Campaign year not resolvable from result" }, 500);
    }

    // Authorization — system bypass already established above for orchestrator path.
    if (!isSystem) {
      const [{ data: superRes, error: superErr }, { data: adminRes, error: adminErr }] =
        await Promise.all([
          supabase.rpc("is_super_admin", { user_id: callerId }),
          supabase.rpc("oly_is_school_admin_for", {
            p_uid: callerId,
            p_oly_school_id: result.oly_school_id,
          }),
        ]);
      if (superErr) return json({ error: `Role check failed: ${superErr.message}` }, 500);
      if (adminErr) return json({ error: `Role check failed: ${adminErr.message}` }, 500);
      isSuper = !!superRes;
      isAdmin = !!adminRes;
      if (!isSuper && !isAdmin) return json({ error: "Forbidden" }, 403);
    }

    // Idempotency — (student_id, oly_result_id) is UNIQUE
    const { data: existing, error: existingErr } = await supabase
      .from("passport_olympiad_entries")
      .select("id")
      .eq("student_id", profileId)
      .eq("oly_result_id", result.id)
      .maybeSingle();
    if (existingErr) {
      return json({ error: `Existing lookup failed: ${existingErr.message}` }, 500);
    }
    if (existing) {
      return json({ ok: true, already_exists: true, id: existing.id }, 200);
    }

    // Insert — guard against null numerics from upstream
    const totalObtained = result.total_marks_obtained ?? 0;
    const totalMax = result.total_max_marks ?? 0;
    const percentage = result.percentage ?? 0;

    const { data: inserted, error: insErr } = await supabase
      .from("passport_olympiad_entries")
      .insert({
        student_id: profileId,
        oly_result_id: result.id,
        campaign_year: campaignYear,
        total_marks_obtained: totalObtained,
        total_max_marks: totalMax,
        percentage,
        certificate_tier: result.certificate_tier,
        certificate_id: result.certificate_id,
        school_rank: result.school_rank,
        class_rank: result.class_rank,
        result_pdf_path: result.result_pdf_path,
        certificate_pdf_path: result.certificate_pdf_path,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return json({ error: `Passport insert failed: ${insErr?.message ?? "no row"}` }, 500);
    }

    // Audit log only for user-driven calls (the orchestrator already audits 'results_published').
    if (!isSystem && callerId) {
      const { data: schoolRow } = await supabase
        .from("oly_schools")
        .select("campaign_id")
        .eq("id", result.oly_school_id)
        .maybeSingle();

      if (schoolRow?.campaign_id) {
        const { error: auditErr } = await supabase.from("oly_audit_log").insert({
          campaign_id: schoolRow.campaign_id,
          oly_school_id: result.oly_school_id,
          oly_student_id: olyStudentId,
          actor_id: callerId,
          actor_role: isSuper ? "super_admin" : "school_admin",
          action: "passport_entry_created",
          after_json: {
            passport_entry_id: inserted.id,
            profile_id: profileId,
            oly_result_id: result.id,
          },
        });
        if (auditErr) {
          console.error(
            "[oly-create-passport-entry] audit log insert failed",
            auditErr.message,
          );
        }
      } else {
        console.error(
          "[oly-create-passport-entry] could not resolve campaign_id for school",
          result.oly_school_id,
        );
      }
    }

    return json({ ok: true, id: inserted.id }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oly-create-passport-entry] fatal", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
