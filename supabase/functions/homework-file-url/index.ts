import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const BUCKET = "homework-files";
const TTL = 300;
function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

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
    const uid = userResult.user.id;

    const body = await req.json().catch(() => ({}));
    const admin = createClient(supabaseUrl, serviceKey);

    let path: string | null = null;

    if (body?.homework_assignment_id) {
      const hwId = body.homework_assignment_id as string;
      const { data: hw } = await admin.from("homework_assignments").select("attachment_path").eq("id", hwId).maybeSingle();
      if (!hw?.attachment_path) return jsonResponse(404, { error: "No attachment." });
      const { data: canManage, error: cmErr } = await admin.rpc("can_manage_homework", { _user_id: uid, _homework_id: hwId });
      const { data: visible, error: visErr } = await admin.rpc("homework_visible_to_student", { _user_id: uid, _homework_id: hwId });
      if (cmErr || visErr) return jsonResponse(500, { error: (cmErr ?? visErr)!.message });
      if (!canManage && !visible) return jsonResponse(403, { error: "Not allowed." });
      path = hw.attachment_path;
    } else if (body?.submission_file_id) {
      const fileId = body.submission_file_id as string;
      const { data: row } = await admin
        .from("homework_submission_files")
        .select("storage_path, submission:submission_id ( student_id, homework_assignment_id )")
        .eq("id", fileId).maybeSingle();
      const sub = Array.isArray(row?.submission) ? row?.submission[0] : row?.submission;
      if (!row || !sub) return jsonResponse(404, { error: "File not found." });
      const isOwner = sub.student_id === uid;
      const { data: canManage, error: cmErr } = await admin.rpc("can_manage_homework", { _user_id: uid, _homework_id: sub.homework_assignment_id });
      if (cmErr) return jsonResponse(500, { error: cmErr.message });
      if (!isOwner && !canManage) return jsonResponse(403, { error: "Not allowed." });
      path = row.storage_path;
    } else {
      return jsonResponse(400, { error: "Provide homework_assignment_id or submission_file_id." });
    }

    const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL);
    if (signErr || !signed?.signedUrl) return jsonResponse(500, { error: signErr?.message ?? "Could not sign URL." });
    return jsonResponse(200, { url: signed.signedUrl });
  } catch (e) {
    return jsonResponse(500, { error: e instanceof Error ? e.message : "Unexpected error" });
  }
});
