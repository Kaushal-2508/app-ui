// Validate a hybrid pairing token from the phone upload page.
//
// Input  (JSON body): { token: string, device_fingerprint: string }
// Auth: NONE — the token IS the auth. The phone does not have a Supabase
// session of its own. The function runs under service role and returns only
// the public fields needed to render the upload UI.
//
// Behaviour:
//  - missing / unknown token  -> 404
//  - expired token            -> 410
//  - first valid call         -> bind device_fingerprint, set used_at
//  - subsequent call from the same device -> success (idempotent resume)
//  - call from a different device after binding -> 403
//  - attempt no longer in a state that accepts uploads -> 409
//
// Output: { attempt_id, exam_id, exam_title, student_name, max_pages,
//           expires_at, institution_id, attempt_status }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(500, { error: "Supabase env vars missing" });
    }

    const body = await req.json().catch(() => ({}));
    const token = body?.token as string | undefined;
    const deviceFingerprint = (body?.device_fingerprint as string | undefined) ?? "";

    if (!token) return jsonResponse(400, { error: "token is required" });
    if (!deviceFingerprint) {
      return jsonResponse(400, { error: "device_fingerprint is required" });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: tokenRow, error: tokenError } = await admin
      .from("hybrid_pairing_tokens")
      .select("token, attempt_id, institution_id, expires_at, used_at, device_fingerprint")
      .eq("token", token)
      .maybeSingle();

    if (tokenError) return jsonResponse(500, { error: tokenError.message });
    if (!tokenRow) return jsonResponse(404, { error: "Token not found" });

    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      return jsonResponse(410, { error: "Token has expired" });
    }

    // Device binding: first valid call binds; later calls must match.
    if (tokenRow.used_at) {
      if (tokenRow.device_fingerprint && tokenRow.device_fingerprint !== deviceFingerprint) {
        return jsonResponse(403, { error: "Token already paired with another device" });
      }
    } else {
      const { error: bindError } = await admin
        .from("hybrid_pairing_tokens")
        .update({ used_at: new Date().toISOString(), device_fingerprint: deviceFingerprint })
        .eq("token", token);
      if (bindError) return jsonResponse(500, { error: bindError.message });
    }

    // Pull the attempt + exam + student for the UI.
    const { data: attempt, error: attemptError } = await admin
      .from("hybrid_exam_attempts")
      .select(
        `id, status, exam_id, student_id, institution_id,
         exams ( id, title )`,
      )
      .eq("id", tokenRow.attempt_id)
      .single();

    if (attemptError || !attempt) {
      return jsonResponse(404, { error: "Attempt not found" });
    }

    if (
      attempt.status === "evaluated" ||
      attempt.status === "cancelled_no_upload" ||
      attempt.status === "pending_evaluation"
    ) {
      return jsonResponse(409, { error: "Upload window is closed" });
    }

    const { data: student } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", attempt.student_id)
      .maybeSingle();

    const examRow = Array.isArray(attempt.exams) ? attempt.exams[0] : attempt.exams;
    // hybrid_exam_settings has NO foreign key to hybrid_exam_attempts (both
    // reference exams independently), so PostgREST can't embed it directly off
    // the attempts query — fetch it on its own by exam_id.
    const { data: settingsRow } = await admin
      .from("hybrid_exam_settings")
      .select("max_pages")
      .eq("exam_id", attempt.exam_id)
      .maybeSingle();

    const studentName = student?.full_name || "Student";

    // Audit (fire-and-forget).
    admin
      .from("hybrid_exam_attempt_logs")
      .insert({
        attempt_id: attempt.id,
        institution_id: attempt.institution_id,
        event_type: "phone_paired",
        actor_id: attempt.student_id,
        event_payload: { device_fingerprint: deviceFingerprint },
      })
      .then(() => {})
      .catch(() => {});

    return jsonResponse(200, {
      attempt_id: attempt.id,
      attempt_status: attempt.status,
      exam_id: attempt.exam_id,
      exam_title: examRow?.title ?? "Hybrid exam",
      student_name: studentName,
      max_pages: settingsRow?.max_pages ?? 10,
      expires_at: tokenRow.expires_at,
      institution_id: attempt.institution_id,
    });
  } catch (err) {
    return jsonResponse(500, { error: (err as Error).message ?? "Unknown error" });
  }
});
