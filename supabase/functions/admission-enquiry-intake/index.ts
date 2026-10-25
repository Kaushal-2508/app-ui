// admission-enquiry-intake: the public admission enquiry form at
// /enquire/:schoolCode (spec docs/superpowers/specs/2026-10-09-admissions-module-design.md,
// section 5.3). No login: the only unauthenticated write on the platform.
//
//   {action: "context", school_code}  -> the school's name, logo, whether the form
//                                        is open, its classes, three academic years
//                                        and the questions asked online (404 when
//                                        the code is unknown)
//   {action: "submit", school_code, student_name, class_group_id, applying_for,
//    academic_year, parent_name, parent_phone, parent_email, previous_school,
//    message, answers, website}       -> {reference_no}
//
// `website` is the honeypot: any value answers 200 and writes nothing. The rules
// live in the service-role RPCs admission_public_context / admission_public_submit
// (migration 20261012120000): the school's admissions feature and form switch, the
// rate limit (5 per connection per 10 minutes, 100 per school per hour, counted on
// a hash of the address, never the address), every answer checked against the
// school's online questions. Refusals map to 404 (form closed), 429 (rate limit)
// and 400 (a field), each with a message a parent can read.
//
// Deploy with --no-verify-jwt (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BODY = 20_000;
const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** A string field, trimmed and cut at `max`; anything else is null. */
function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientAddress(req: Request): string {
  const forwarded = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return forwarded || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  // 1. Validate before any IO.
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "That enquiry is too long." }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "That request is not readable." }, 400);
  }
  const action = body.action;
  const code = typeof body.school_code === "string" ? body.school_code.trim() : "";
  if (action !== "context" && action !== "submit") return json({ error: "Unknown action." }, 400);
  if (!CODE_RE.test(code)) return json({ error: "School not found." }, 404);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
  });

  if (action === "context") {
    const { data, error } = await db.rpc("admission_public_context", { _code: code });
    if (error) {
      console.error("admission_public_context failed:", error.message);
      return json({ error: "Couldn't load the form. Please try again." }, 500);
    }
    if (!data) return json({ error: "School not found." }, 404);
    return json(data);
  }

  // 2. The honeypot: humans never see the field, so any value is a bot.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    console.warn("admission intake: honeypot filled, nothing written");
    return json({ reference_no: "ENQ-RECEIVED" });
  }

  const answersIn = body.answers;
  const answers: Record<string, string> = {};
  if (answersIn && typeof answersIn === "object" && !Array.isArray(answersIn)) {
    for (const [k, v] of Object.entries(answersIn as Record<string, unknown>).slice(0, 60)) {
      const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;
      if (s !== null && k.length <= 60) answers[k] = s.slice(0, 600);
    }
  }
  const groupId = typeof body.class_group_id === "string" && UUID_RE.test(body.class_group_id) ? body.class_group_id : null;
  const fields = {
    student_name: str(body.student_name, 200),
    class_group_id: groupId,
    applying_for: str(body.applying_for, 120),
    academic_year: str(body.academic_year, 10),
    parent_name: str(body.parent_name, 200),
    parent_phone: str(body.parent_phone, 20),
    parent_email: str(body.parent_email, 250),
    previous_school: str(body.previous_school, 250),
    message: str(body.message, 1200),
    answers,
  };

  const ipHash = await sha256Hex(`admission-intake:${clientAddress(req)}`);
  const { data, error } = await db.rpc("admission_public_submit", { _code: code, _ip_hash: ipHash, _fields: fields });
  if (error) {
    const hint = (error as { hint?: string }).hint ?? "";
    if (hint === "admission_form_closed") return json({ error: error.message }, 404);
    if (hint === "admission_rate_limited") return json({ error: error.message }, 429);
    if (hint === "admission_invalid") return json({ error: error.message }, 400);
    console.error("admission_public_submit failed:", error.code, error.message);
    return json({ error: "Couldn't send your enquiry. Please try again or call the school." }, 500);
  }
  return json(data);
});
