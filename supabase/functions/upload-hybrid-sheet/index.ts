// Upload a single answer-sheet page from the student's OWN logged-in device
// (the phone they wrote on, or a laptop uploading from local storage).
//
// Input (JSON body): {
//   attempt_id: string,
//   page_number: number,
//   file_base64: string,        // raw base64, no "data:" prefix
//   file_size_bytes: number,
//   content_type?: string,      // default "image/jpeg"
// }
//
// Auth: student JWT in Authorization. The caller MUST be the attempt's
// student (auth.uid() === attempt.student_id). This is the authenticated
// counterpart to upload-hybrid-page (which is token-only for a *separate*
// paired phone). Same hybrid_* plane — never touches final_results.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "hybrid-answer-sheets";
const FILE_SIZE_CAP = 1536 * 1024; // 1.5 MB — matches bucket file_size_limit

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Missing Authorization header" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse(500, { error: "Supabase env vars missing" });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResult, error: userError } = await userClient.auth.getUser();
    if (userError || !userResult?.user) {
      return jsonResponse(401, { error: "Unauthenticated" });
    }
    const userId = userResult.user.id;

    const body = await req.json().catch(() => ({}));
    const attemptId = body?.attempt_id as string | undefined;
    const pageNumber = Number(body?.page_number);
    const fileBase64 = body?.file_base64 as string | undefined;
    const fileSizeBytes = Number(body?.file_size_bytes);
    const contentType = (body?.content_type as string | undefined) ?? "image/jpeg";

    if (!attemptId) return jsonResponse(400, { error: "attempt_id is required" });
    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      return jsonResponse(400, { error: "page_number must be a positive integer" });
    }
    if (!fileBase64) return jsonResponse(400, { error: "file_base64 is required" });
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      return jsonResponse(400, { error: "file_size_bytes must be > 0" });
    }
    if (fileSizeBytes > FILE_SIZE_CAP) {
      return jsonResponse(413, {
        error: "File too large after compression. Try a sharper photo with less background.",
      });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: attempt, error: attemptError } = await admin
      .from("hybrid_exam_attempts")
      .select("id, exam_id, student_id, institution_id, status, submitted_at")
      .eq("id", attemptId)
      .single();

    if (attemptError || !attempt) {
      return jsonResponse(404, { error: "Attempt not found" });
    }
    if (attempt.student_id !== userId) {
      return jsonResponse(403, { error: "Not your attempt" });
    }
    if (
      attempt.status === "evaluated" ||
      attempt.status === "cancelled_no_upload" ||
      attempt.status === "pending_evaluation"
    ) {
      return jsonResponse(409, { error: "Upload window is closed" });
    }

    // hybrid_exam_settings has NO foreign key to hybrid_exam_attempts (both
    // reference exams independently), so PostgREST can't embed it directly off
    // the attempts query — fetch it on its own by exam_id.
    const { data: settingsRow } = await admin
      .from("hybrid_exam_settings")
      .select("max_pages, grace_window_minutes")
      .eq("exam_id", attempt.exam_id)
      .maybeSingle();
    const maxPages = settingsRow?.max_pages ?? 10;
    const graceWindowMinutes = settingsRow?.grace_window_minutes ?? 5;

    if (attempt.submitted_at) {
      const windowEndMs =
        new Date(attempt.submitted_at).getTime() + graceWindowMinutes * 60 * 1000;
      if (Date.now() > windowEndMs) {
        return jsonResponse(410, {
          error: "Upload window has closed — ask your teacher if you need more time.",
        });
      }
    }
    if (pageNumber > maxPages) {
      return jsonResponse(400, { error: `Page number exceeds max of ${maxPages}` });
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(fileBase64);
    } catch {
      return jsonResponse(400, { error: "file_base64 is not valid base64" });
    }
    if (bytes.length > FILE_SIZE_CAP) {
      return jsonResponse(413, {
        error: "File too large after compression. Try a sharper photo with less background.",
      });
    }

    const storagePath = `hybrid-sheets/${attempt.institution_id}/${attempt.exam_id}/${attempt.id}/page_${pageNumber}.jpg`;

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: true });
    if (uploadError) {
      return jsonResponse(500, { error: `Upload failed: ${uploadError.message}` });
    }

    const { data: pageRow, error: rowError } = await admin
      .from("hybrid_answer_sheet_pages")
      .upsert(
        {
          attempt_id: attempt.id,
          institution_id: attempt.institution_id,
          page_number: pageNumber,
          storage_path: storagePath,
          file_size_bytes: bytes.length,
          device_fingerprint: "own-device",
          rotation_degrees: 0,
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: "attempt_id,page_number" },
      )
      .select("id")
      .single();
    if (rowError) {
      return jsonResponse(500, { error: `Row insert failed: ${rowError.message}` });
    }

    let nextStatus = attempt.status;
    if (attempt.status === "awaiting_upload") {
      const { error: statusError } = await admin
        .from("hybrid_exam_attempts")
        .update({ status: "upload_in_progress" })
        .eq("id", attempt.id);
      if (!statusError) nextStatus = "upload_in_progress";
    }

    admin
      .from("hybrid_exam_attempt_logs")
      .insert({
        attempt_id: attempt.id,
        institution_id: attempt.institution_id,
        event_type: "page_uploaded",
        actor_id: attempt.student_id,
        event_payload: {
          page_number: pageNumber,
          file_size_bytes: bytes.length,
          source: "authenticated_device",
        },
      })
      .then(() => {})
      .catch(() => {});

    return jsonResponse(200, {
      page_id: pageRow.id,
      storage_path: storagePath,
      page_number: pageNumber,
      attempt_status: nextStatus,
    });
  } catch (err) {
    return jsonResponse(500, { error: (err as Error).message ?? "Unknown error" });
  }
});