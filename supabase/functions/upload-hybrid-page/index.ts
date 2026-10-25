// Upload a single answer-sheet page from the student's phone.
//
// Input  (JSON body): {
//   token: string,
//   device_fingerprint: string,
//   page_number: number,
//   file_base64: string,            // raw base64, no "data:" prefix
//   file_size_bytes: number,
//   content_type?: string,          // default "image/jpeg"
// }
//
// Auth: NONE — the pairing token IS the auth. The function checks:
//   - token exists, not expired
//   - device_fingerprint matches the one bound at validate-time
//   - attempt is in a state that still accepts uploads
//   - page_number is within the exam's max_pages setting
//   - file size is within the bucket cap (512 KB hard ceiling)
//
// On success:
//   - Upload to hybrid-answer-sheets at
//     hybrid-sheets/{institution_id}/{exam_id}/{attempt_id}/page_{n}.jpg
//   - Upsert row in hybrid_answer_sheet_pages (unique on attempt_id, page_number)
//   - Flip attempt status from awaiting_upload -> upload_in_progress on first page
//   - Log 'page_uploaded'
//
// Output: { page_id, storage_path, page_number, attempt_status }

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
  // atob returns binary string; convert to Uint8Array byte-by-byte.
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(500, { error: "Supabase env vars missing" });
    }

    const body = await req.json().catch(() => ({}));
    const token = body?.token as string | undefined;
    const deviceFingerprint = (body?.device_fingerprint as string | undefined) ?? "";
    const pageNumber = Number(body?.page_number);
    const fileBase64 = body?.file_base64 as string | undefined;
    const fileSizeBytes = Number(body?.file_size_bytes);
    const contentType = (body?.content_type as string | undefined) ?? "image/jpeg";

    if (!token) return jsonResponse(400, { error: "token is required" });
    if (!deviceFingerprint) {
      return jsonResponse(400, { error: "device_fingerprint is required" });
    }
    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      return jsonResponse(400, { error: "page_number must be a positive integer" });
    }
    if (!fileBase64) return jsonResponse(400, { error: "file_base64 is required" });
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      return jsonResponse(400, { error: "file_size_bytes must be > 0" });
    }
    if (fileSizeBytes > FILE_SIZE_CAP) {
      return jsonResponse(413, {
        error: `File too large after compression. Try a sharper photo with less background.`,
      });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Token + device check.
    const { data: tokenRow, error: tokenError } = await admin
      .from("hybrid_pairing_tokens")
      .select("token, attempt_id, institution_id, expires_at, device_fingerprint, used_at")
      .eq("token", token)
      .maybeSingle();

    if (tokenError) return jsonResponse(500, { error: tokenError.message });
    if (!tokenRow) return jsonResponse(404, { error: "Token not found" });
    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      return jsonResponse(410, { error: "Pairing expired — ask your teacher for a new code" });
    }
    if (!tokenRow.used_at) {
      return jsonResponse(403, {
        error: "Pair the phone first by scanning the QR before uploading",
      });
    }
    if (tokenRow.device_fingerprint && tokenRow.device_fingerprint !== deviceFingerprint) {
      return jsonResponse(403, { error: "Token bound to another device" });
    }

    const { data: attempt, error: attemptError } = await admin
      .from("hybrid_exam_attempts")
      .select("id, exam_id, student_id, institution_id, status, submitted_at")
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

    // hybrid_exam_settings has NO foreign key to hybrid_exam_attempts (both
    // reference exams independently), so PostgREST can't embed it directly off
    // the attempts query — fetch it on its own by exam_id.
    const { data: settingsRow } = await admin
      .from("hybrid_exam_settings")
      .select("max_pages, grace_window_minutes")
      .eq("exam_id", attempt.exam_id)
      .maybeSingle();
    const maxPages = settingsRow?.max_pages ?? 10;

    // Server-side upload-window enforcement: reject uploads after
    // submitted_at + grace_window_minutes. The pairing-token TTL alone is not
    // the window (a teacher may set a shorter window than the 15-min TTL).
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

    // Decode + upload.
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
      .upload(storagePath, bytes, {
        contentType,
        upsert: true,
      });
    if (uploadError) {
      return jsonResponse(500, { error: `Upload failed: ${uploadError.message}` });
    }

    // Upsert page row (unique on attempt_id + page_number).
    const { data: pageRow, error: rowError } = await admin
      .from("hybrid_answer_sheet_pages")
      .upsert(
        {
          attempt_id: attempt.id,
          institution_id: attempt.institution_id,
          page_number: pageNumber,
          storage_path: storagePath,
          file_size_bytes: bytes.length,
          device_fingerprint: deviceFingerprint,
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

    // Flip awaiting_upload -> upload_in_progress on first successful upload.
    let nextStatus = attempt.status;
    if (attempt.status === "awaiting_upload") {
      const { error: statusError } = await admin
        .from("hybrid_exam_attempts")
        .update({ status: "upload_in_progress" })
        .eq("id", attempt.id);
      if (!statusError) nextStatus = "upload_in_progress";
    }

    // Audit (fire-and-forget).
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
          device_fingerprint: deviceFingerprint,
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
