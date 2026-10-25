import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Deleted Users archive: a 300 s signed URL for one file listed in one archive
 * entry's manifest (spec 2026-10-06-deleted-users-page-design §10).
 * Authorisation is public.dua_file_check, called WITH the caller's JWT: it
 * requires a super admin in dua.viewers and that (archive_id, file_id) is in
 * dua.files, and it logs the view. Only then does the service role sign.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const TTL = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const archiveId = typeof body?.archive_id === "string" ? body.archive_id : "";
    const fileId = Number(body?.file_id);
    if (!UUID_RE.test(archiveId) || !Number.isSafeInteger(fileId) || fileId <= 0) {
      return jsonResponse(400, { error: "Provide archive_id and file_id." });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Please sign in again." });
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return jsonResponse(500, { error: "Supabase env vars missing" });

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: file, error: checkError } = await userClient.rpc("dua_file_check", {
      _archive_id: archiveId,
      _file_id: fileId,
    });
    if (checkError) {
      const status = checkError.code === "42501" ? 403 : checkError.code === "P0002" ? 404 : 500;
      return jsonResponse(status, { error: checkError.message });
    }
    const target = file as { bucket?: string; path?: string } | null;
    if (!target?.bucket || !target?.path) return jsonResponse(404, { error: "This file is not part of this archive entry." });

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: signed, error: signError } = await admin.storage.from(target.bucket).createSignedUrl(target.path, TTL);
    if (signError || !signed?.signedUrl) {
      return jsonResponse(410, { error: "File removed after deletion." });
    }
    return jsonResponse(200, { url: signed.signedUrl, expires_in: TTL });
  } catch (err) {
    console.error("dua-file-url failed:", err);
    return jsonResponse(500, { error: "Couldn't open this file." });
  }
});
