import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "homework-files";
const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  "image/jpeg","image/png","image/gif","image/webp","application/pdf",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain","application/rtf","text/rtf",
  "application/vnd.oasis.opendocument.text","application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface SubmitFile { path: string; name: string; mime: string; size: number }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Missing Authorization header" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return jsonResponse(500, { error: "Supabase env vars missing" });

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userResult, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userResult?.user) return jsonResponse(401, { error: "Unauthenticated" });
    const studentId = userResult.user.id;

    const body = await req.json().catch(() => ({}));
    const homeworkId = body?.homework_assignment_id as string | undefined;
    const files = (body?.files as SubmitFile[] | undefined) ?? [];
    if (!homeworkId) return jsonResponse(400, { error: "homework_assignment_id is required" });
    if (!Array.isArray(files) || files.length === 0) return jsonResponse(400, { error: "Attach at least one file." });
    if (files.length > MAX_FILES) return jsonResponse(400, { error: `You can attach at most ${MAX_FILES} files.` });
    for (const f of files) {
      if (!f?.path || !f?.name || !f?.mime || typeof f.size !== "number") return jsonResponse(400, { error: "Malformed file entry." });
      if (f.size > MAX_FILE_BYTES) return jsonResponse(413, { error: `"${f.name}" exceeds 10 MB.` });
      if (!ALLOWED_MIMES.has(f.mime)) return jsonResponse(400, { error: `"${f.name}" is not an allowed type.` });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Assignment must exist, be published (open), and currently visible to THIS student.
    const { data: hw, error: hwErr } = await admin
      .from("homework_assignments")
      .select("id, institution_id, status, due_at, visible_from, offline_marks")
      .eq("id", homeworkId).maybeSingle();
    if (hwErr) return jsonResponse(500, { error: hwErr.message });
    if (!hw) return jsonResponse(404, { error: "Assignment not found." });
    if (hw.status !== "published") return jsonResponse(410, { error: "This assignment is closed for submissions." });
    // Offline-marked assignments are graded by the teacher; no online submission.
    if (hw.offline_marks) {
      return jsonResponse(410, { error: "This assignment is marked offline by your teacher." });
    }
    // Hard close: the submission window ends at due_at. No late submissions.
    if (new Date() > new Date(hw.due_at)) {
      return jsonResponse(410, { error: "The submission window for this assignment has closed." });
    }

    const { data: visible, error: visErr } = await admin.rpc("homework_visible_to_student", { _user_id: studentId, _homework_id: homeworkId });
    if (visErr) return jsonResponse(500, { error: visErr.message });
    if (!visible) return jsonResponse(403, { error: "This assignment isn't available to you." });

    // Every file path must live under THIS student's submission folder for THIS assignment.
    const prefix = `${hw.institution_id}/submissions/${homeworkId}/${studentId}/`;
    for (const f of files) {
      if (!f.path.startsWith(prefix)) return jsonResponse(403, { error: "Invalid file path." });
    }
    // Confirm the objects actually exist in storage.
    const { data: listed, error: listErr } = await admin.storage.from(BUCKET).list(prefix.slice(0, -1), { limit: 1000 });
    if (listErr) return jsonResponse(500, { error: `Storage check failed: ${listErr.message}` });
    const present = new Set((listed ?? []).map((o) => `${prefix}${o.name}`));
    for (const f of files) {
      if (!present.has(f.path)) return jsonResponse(400, { error: `Upload incomplete for "${f.name}". Please retry.` });
    }

    // Window enforced above (must be on/before due_at), so a successful submission is never late.
    const isLate = false;

    // Insert the submission (UNIQUE(assignment,student) → one-shot).
    const { data: sub, error: subErr } = await admin
      .from("homework_submissions")
      .insert({ homework_assignment_id: homeworkId, student_id: studentId, is_late: isLate })
      .select("id").single();
    if (subErr) {
      if ((subErr as { code?: string }).code === "23505") return jsonResponse(409, { error: "You've already submitted this assignment." });
      return jsonResponse(500, { error: subErr.message });
    }

    const fileRows = files.map((f) => ({
      submission_id: sub.id, storage_path: f.path, file_name: f.name, file_mime: f.mime, file_size_bytes: f.size,
    }));
    const { error: filesErr } = await admin.from("homework_submission_files").insert(fileRows);
    if (filesErr) {
      // Compensating cleanup so we never leave a submission with no files.
      const { error: cleanupErr } = await admin.from("homework_submissions").delete().eq("id", sub.id);
      if (cleanupErr) {
        return jsonResponse(500, { error: "Submission could not be completed and automatic cleanup failed. Please contact your teacher before retrying." });
      }
      return jsonResponse(500, { error: filesErr.message });
    }

    return jsonResponse(200, { submission_id: sub.id, is_late: isLate, file_count: files.length });
  } catch (e) {
    return jsonResponse(500, { error: e instanceof Error ? e.message : "Unexpected error" });
  }
});
