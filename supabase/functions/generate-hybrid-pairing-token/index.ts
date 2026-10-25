// Generate a single-use hybrid exam pairing token.
//
// Input  (JSON body): { attempt_id: string, app_url?: string }
// Auth: caller must be the student who owns the attempt.
// Action: insert a hybrid_pairing_tokens row with expires_at = now() + 15 min.
// Output: { token, short_code, qr_url, expires_at }
//
// Token: 32-char base32-ish random opaque string. Short code: 6 chars from
// alphabet excluding 0/O/1/I/L. Storage: plain text — the row is the truth,
// edge functions look it up by primary key.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOKEN_LENGTH = 32;
const SHORT_CODE_LENGTH = 6;
const SHORT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const TTL_MINUTES = 15;

function randomFromAlphabet(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function generateToken(): string {
  // Hex-style opaque token — 32 chars from [0-9a-f]. crypto.getRandomValues
  // gives us 16 bytes of entropy, expanded to 32 hex chars.
  const bytes = new Uint8Array(TOKEN_LENGTH / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateShortCode(): string {
  return randomFromAlphabet(SHORT_CODE_LENGTH, SHORT_CODE_ALPHABET);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Supabase env vars missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve the caller via the user's JWT (anon client + Authorization header).
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResult, error: userError } = await userClient.auth.getUser();
    if (userError || !userResult?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userResult.user.id;

    const body = await req.json().catch(() => ({}));
    const attemptId = body?.attempt_id as string | undefined;
    const appUrl = (body?.app_url as string | undefined) ?? "";
    if (!attemptId) {
      return new Response(
        JSON.stringify({ error: "attempt_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Service-role client so we can run the auth check + the insert with
    // the same SQL view of the world (and so RLS recursion never bites us).
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: the attempt must belong to this user.
    const { data: attempt, error: attemptError } = await admin
      .from("hybrid_exam_attempts")
      .select("id, student_id, institution_id, status, exam_id")
      .eq("id", attemptId)
      .single();

    if (attemptError || !attempt) {
      return new Response(
        JSON.stringify({ error: "Attempt not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (attempt.student_id !== userId) {
      return new Response(
        JSON.stringify({ error: "Not your attempt" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (attempt.status === "evaluated" || attempt.status === "cancelled_no_upload") {
      return new Response(
        JSON.stringify({ error: "Attempt is closed" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Generate a unique token + short code. PK collisions on TOKEN_LENGTH=32
    // are astronomically improbable but we retry on the off chance the short
    // code collides with an unused-and-unexpired row.
    let token = "";
    let shortCode = "";
    let inserted = false;
    let attempts = 0;
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();

    while (!inserted && attempts < 5) {
      attempts++;
      token = generateToken();
      shortCode = generateShortCode();

      const { error: insertError } = await admin
        .from("hybrid_pairing_tokens")
        .insert({
          token,
          short_code: shortCode,
          attempt_id: attempt.id,
          institution_id: attempt.institution_id,
          expires_at: expiresAt,
        });

      if (!insertError) {
        inserted = true;
        break;
      }
      // 23505 = unique_violation. Retry with a fresh token/code.
      // Any other error is fatal.
      const code = (insertError as { code?: string }).code;
      if (code !== "23505") {
        return new Response(
          JSON.stringify({ error: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (!inserted) {
      return new Response(
        JSON.stringify({ error: "Could not generate a unique pairing token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit log — non-blocking.
    admin
      .from("hybrid_exam_attempt_logs")
      .insert({
        attempt_id: attempt.id,
        institution_id: attempt.institution_id,
        event_type: "pairing_token_generated",
        actor_id: userId,
        event_payload: { short_code: shortCode, expires_at: expiresAt },
      })
      .then(() => {})
      .catch(() => {});

    const base = appUrl.replace(/\/+$/, "");
    const qrUrl = `${base}/student/hybrid-upload/${token}`;

    return new Response(
      JSON.stringify({
        token,
        short_code: shortCode,
        qr_url: qrUrl,
        expires_at: expiresAt,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
