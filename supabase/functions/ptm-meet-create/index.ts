// Online PTM Meet rooms: one Google Meet space per booked online slot, locked
// after the slot.
//
// Driven by pg_cron: ptm-meet-rooms-1min runs ptm_meet_create_kick(), which
// posts here (Bearer = the Vault webhook_secret, which equals WEBHOOK_SECRET)
// only when a room is due to be made or locked. All bookkeeping is in the
// database (migration 20261006140100); this function only talks to Google.
//
// Google: the service account in GOOGLE_MEET_SERVICE_ACCOUNT_JSON impersonates
// the Workspace user GOOGLE_MEET_IMPERSONATE_USER through domain-wide
// delegation (scopes meetings.space.created + meetings.space.settings), so
// every room is owned by that user. Teachers and families join as guests,
// which is why rooms are OPEN while they are in use and RESTRICTED after.
// Only { accessType, entryPointAccess, moderation } are sent on create: on our
// Workspace edition artifactConfig, presentRestriction and
// defaultJoinAsViewerType answer FEATURE_UNAVAILABLE_TO_USER and fail the
// whole create, and the defaults already have recording, transcription and
// smart notes off.
//
// Secrets: WEBHOOK_SECRET, GOOGLE_MEET_SERVICE_ACCOUNT_JSON (a PRIVATE KEY:
// never log it, never echo it), GOOGLE_MEET_IMPERSONATE_USER, optional
// GOOGLE_MEET_ACCESS_TYPE (OPEN, the default, or TRUSTED).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MEET = "https://meet.googleapis.com/v2";
const SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.settings",
].join(" ");
const BATCH = 20;
const IN_FLIGHT = 4;
// Stop starting new Google calls after this; pg_net waits 20 s for the reply.
const BUDGET_MS = 12_000;
const FETCH_TIMEOUT_MS = 8_000;
const MEET_URI = /^https:\/\/meet\.google\.com\/[A-Za-z0-9_-]+$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Compares in time that does not depend on where the strings differ. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---- Google auth (as send-push, plus the impersonated user) ---------------

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function serviceAccount(): ServiceAccount {
  const raw = Deno.env.get("GOOGLE_MEET_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GOOGLE_MEET_SERVICE_ACCOUNT_JSON is not set.");
  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(raw);
  } catch {
    // Deliberately does not include the value in the message.
    throw new Error("GOOGLE_MEET_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_MEET_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  return {
    client_email: sa.client_email,
    // Secrets set through a UI often arrive with the newlines escaped.
    private_key: sa.private_key.replace(/\\n/g, "\n"),
    token_uri: sa.token_uri ?? "https://oauth2.googleapis.com/token",
  };
}

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buf;
}

// Good for an hour; cached at module scope so a warm instance re-uses it.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const sub = (Deno.env.get("GOOGLE_MEET_IMPERSONATE_USER") ?? "").trim();
  if (!sub) throw new Error("GOOGLE_MEET_IMPERSONATE_USER is not set.");
  const sa = serviceAccount();
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({ iss: sa.client_email, sub, scope: SCOPES, aud: sa.token_uri, iat: now, exp: now + 3600 }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(new Uint8Array(sig))}`,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !payload.access_token) {
    throw new Error(
      `Google token exchange failed (${res.status}): ${payload.error_description ?? payload.error ?? "no access_token"}`,
    );
  }
  cachedToken = { value: payload.access_token, expiresAt: now + (payload.expires_in ?? 3600) };
  return cachedToken.value;
}

// ---- Meet API -------------------------------------------------------------

async function createSpace(token: string): Promise<{ name: string; meetingUri: string }> {
  const accessType = (Deno.env.get("GOOGLE_MEET_ACCESS_TYPE") ?? "OPEN").trim().toUpperCase() === "TRUSTED"
    ? "TRUSTED"
    : "OPEN";
  const res = await fetch(`${MEET}/spaces`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ config: { accessType, entryPointAccess: "ALL", moderation: "ON" } }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`spaces.create ${res.status}: ${text.slice(0, 300)}`);
  const space = JSON.parse(text) as { name?: string; meetingUri?: string };
  if (!space.name?.startsWith("spaces/") || !space.meetingUri || !MEET_URI.test(space.meetingUri)) {
    throw new Error(`spaces.create returned an unexpected space: ${text.slice(0, 200)}`);
  }
  return { name: space.name, meetingUri: space.meetingUri };
}

/** RESTRICTED: nobody gets in with the link alone any more; anyone still in
 *  the call stays. A space that no longer exists counts as locked. */
async function lockSpace(token: string, name: string): Promise<void> {
  const res = await fetch(`${MEET}/${name}?updateMask=config.accessType`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ config: { accessType: "RESTRICTED" } }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.ok || res.status === 404) {
    await res.body?.cancel();
    return;
  }
  throw new Error(`spaces.patch ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// ---- the pass -------------------------------------------------------------

type Due = { booking_id: string; attempt: number };
type Closing = { booking_id: string; space_id: string };

/** Runs `fn` over `items`, IN_FLIGHT at a time, starting nothing after the
 *  budget. Returns the items that were never started. */
async function runPool<T>(items: T[], started: number, fn: (item: T) => Promise<void>): Promise<T[]> {
  const queue = [...items];
  const skipped: T[] = [];
  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (Date.now() - started > BUDGET_MS) {
        skipped.push(item);
        continue;
      }
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, items.length) }, worker));
  return skipped;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || !sameSecret(req.headers.get("Authorization") ?? "", `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const started = Date.now();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let tokenPromise: Promise<string> | null = null;
  const token = () => (tokenPromise ??= accessToken());
  const out = { claimed: 0, created: 0, failed: 0, spare: 0, deferred: 0, to_lock: 0, locked: 0, lock_failed: 0 };

  // 1. Make the rooms that are due.
  const { data: due, error: claimError } = await db.rpc("ptm_meet_claim_due", { _limit: BATCH });
  if (claimError) {
    console.error("ptm_meet_claim_due failed:", claimError.message);
    return json({ error: "claim failed" }, 500);
  }
  const rows = (due ?? []) as Due[];
  out.claimed = rows.length;

  const fail = async (bookingId: string, message: string) => {
    const { error } = await db.rpc("ptm_meet_fail", { _booking_id: bookingId, _error: message });
    if (error) console.error("ptm_meet_fail failed:", bookingId, error.message);
  };

  const notStarted = await runPool(rows, started, async (row) => {
    try {
      const t = await token();
      const space = await createSpace(t);
      const { data: saved, error } = await db.rpc("ptm_meet_record", {
        _booking_id: row.booking_id,
        _space_id: space.name,
        _meet_uri: space.meetingUri,
        _cohost_set: false,
      });
      if (error) throw new Error(`ptm_meet_record: ${error.message}`);
      if (saved) {
        out.created += 1;
      } else {
        // Nothing to hang it on (already has a room, or the row is gone):
        // lock the spare so its link lets nobody in.
        out.spare += 1;
        await lockSpace(t, space.name).catch((e) => console.error("spare room not locked:", space.name, errorText(e)));
      }
    } catch (e) {
      out.failed += 1;
      console.error("room not made:", row.booking_id, `attempt ${row.attempt}:`, errorText(e));
      await fail(row.booking_id, errorText(e));
    }
  });
  // Out of time: hand them back now so the next pass retries them.
  out.deferred = notStarted.length;
  await Promise.all(notStarted.map((row) => fail(row.booking_id, "deferred: the pass ran out of time")));

  // 2. Lock the rooms whose slot is over (or whose booking was cancelled).
  if (Date.now() - started < BUDGET_MS) {
    const { data: closing, error: closeError } = await db.rpc("ptm_meet_close_due", { _limit: BATCH });
    if (closeError) {
      console.error("ptm_meet_close_due failed:", closeError.message);
    } else {
      const toLock = (closing ?? []) as Closing[];
      out.to_lock = toLock.length;
      // A room not reached keeps its claim and is retried after 10 minutes.
      await runPool(toLock, started, async (row) => {
        let ok = false;
        try {
          await lockSpace(await token(), row.space_id);
          ok = true;
          out.locked += 1;
        } catch (e) {
          out.lock_failed += 1;
          console.error("room not locked:", row.booking_id, errorText(e));
        }
        const { error } = await db.rpc("ptm_meet_closed", { _booking_id: row.booking_id, _ok: ok });
        if (error) console.error("ptm_meet_closed failed:", row.booking_id, error.message);
      });
    }
  }

  const summary = { ...out, ms: Date.now() - started };
  console.log("ptm-meet-create", JSON.stringify(summary));
  return json(summary);
});
