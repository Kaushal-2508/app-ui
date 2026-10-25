# `ptm-meet-create` edge function: reference draft for Tushar

**Status:** a DRAFT written on `naman-erp` (2026-10-05) as a starting point. Not deployed, not run.
Edge functions live under `supabase/functions/`, which this branch does not touch (CLAUDE.md
section 28), so the code sits here for Tushar to drop into `supabase/functions/ptm-meet-create/index.ts`,
check against the live Meet API reference, and own. The database half it talks to is in
[2026-10-03-ptm-online-residential-design.md](2026-10-03-ptm-online-residential-design.md), section 5.5.

What it does, every 5 minutes (pg_cron `ptm-meet-create-5min` calls `ptm_meet_create_kick()`, which
posts here with the Vault-backed `WEBHOOK_SECRET`):

1. `ptm_meet_claim_due(20)` claims up to 20 online bookings whose slot starts within the next hour,
   have no room yet and fewer than 5 attempts (`FOR UPDATE SKIP LOCKED`, so overlapping passes never
   double-create). Room state lives in `ptm_booking_meet` (one row per booking, no browser access),
   as built on 2026-10-05, not on `ptm_bookings` as the first contract said; the three RPCs below
   hide that from the function.
2. For each, creates a Meet space as the impersonated Workspace user, lobby on, recording off, and
   tries to add the teacher's Google account as co-host (best effort: the members API is v2beta and
   Workspace-edition gated).
3. `ptm_meet_record` on success, `ptm_meet_fail` on failure (the row retries after 10 minutes until
   the fifth attempt).

Token code follows `supabase/functions/send-push/index.ts` (service-account JSON from a secret,
RS256 through `crypto.subtle`, one-hour cache), with one addition: the `sub` claim, because the Meet
API refuses to create spaces as a bare service account. **Prerequisite, DONE 2026-10-06 and proven
from Naman's Mac with a probe script:** the Workspace user is **`team@salci.in`** (an existing
account; it is not a Workspace admin and need not be), the service account is
`salci-ptm-meet@salci-meet.iam.gserviceaccount.com` in Cloud project `salci-meet` (client id
`105886186548955941046`, key file held by Naman, to be handed to Tushar privately for the
`GOOGLE_MEET_SERVICE_ACCOUNT_JSON` secret; `GOOGLE_MEET_IMPERSONATE_USER = team@salci.in`), and
domain-wide delegation is granted for BOTH scopes below. The organisation's default policy
`iam.disableServiceAccountKeyCreation` (legacy and managed) had to be overridden to not-enforced
for that project before a key could be made. The Workspace setting that lets people outside the
organisation (and signed-out people) join meetings is Naman's to confirm in the Admin console.

Secrets: `GOOGLE_MEET_SERVICE_ACCOUNT_JSON`, `GOOGLE_MEET_IMPERSONATE_USER`, `WEBHOOK_SECRET`
(existing), optional `GOOGLE_MEET_ACCESS_TYPE` (`OPEN` default; `TRUSTED` only once co-host is proven,
never `RESTRICTED`), `GOOGLE_MEET_TRY_COHOST` (`false`; the members API answered 404 on our
edition, see below). `config.toml`: `[functions.ptm-meet-create] verify_jwt = false`, as
`send-push`.

**Verified live on 2026-10-06 (probe, two test rooms created as team@salci.in):**
- The token request with both scopes and `sub = team@salci.in` works; use both scopes.
- `POST https://meet.googleapis.com/v2/spaces` works with the config
  `{ accessType: "OPEN", entryPointAccess: "ALL", moderation: "ON" }`. **Do not send
  `artifactConfig`, `moderationRestrictions.presentRestriction` or `defaultJoinAsViewerType`:** on
  this Workspace edition each answers `403 PERMISSION_DENIED / FEATURE_UNAVAILABLE_TO_USER`
  (`updateAutoRecordingGeneration`, `updateDefaultJoinAsViewerType`) and the whole create fails.
  The server's own defaults are already what we want: recording, transcription and smart notes
  OFF, `attendanceReportGenerationType: DO_NOT_GENERATE`. The v2beta fallback was not needed.
- The response carries `name` (`spaces/...`), `meetingUri` (`https://meet.google.com/xxx-xxxx-xxx`)
  and `meetingCode`.
- Members / co-host: **not available.** `POST https://meet.googleapis.com/v2beta/{space}/members`
  with `{ email: "naman@salci.in", role: "COHOST" }` answered `404 Method not found` on
  2026-10-06 (the members API is a developer-preview, edition-gated feature). So the teacher joins
  as a guest, which Naman accepted the same day ("ok we will go with this"); `GOOGLE_MEET_TRY_COHOST`
  defaults to `false` and the co-host code stays as an opt-in for a later edition. Rooms therefore
  stay `OPEN` (a `TRUSTED` room would have no host to admit anyone).

```ts
// supabase/functions/ptm-meet-create/index.ts  (DRAFT, untested)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- secrets --------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const IMPERSONATE = Deno.env.get("GOOGLE_MEET_IMPERSONATE_USER") ?? "";
const ACCESS_TYPE = (Deno.env.get("GOOGLE_MEET_ACCESS_TYPE") ?? "OPEN").toUpperCase();
// Off by default: the members API is 404 on our Workspace edition (2026-10-06).
const TRY_COHOST = (Deno.env.get("GOOGLE_MEET_TRY_COHOST") ?? "false") === "true";

// Both scopes: proven on 2026-10-06 (delegation is granted for exactly these two).
const SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.settings",
].join(" ");
const BATCH = 20;
const IN_FLIGHT = 4;
const BUDGET_MS = 8_000;
const FETCH_TIMEOUT_MS = 10_000;

type ServiceAccount = { client_email: string; private_key: string; project_id: string; token_uri?: string };

function serviceAccount(): ServiceAccount {
  const raw = Deno.env.get("GOOGLE_MEET_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GOOGLE_MEET_SERVICE_ACCOUNT_JSON is not set");
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error("service account JSON is missing fields");
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  sa.token_uri ??= "https://oauth2.googleapis.com/token";
  return sa;
}

// ---- RS256 JWT -> access token, cached one hour ----------------------------
const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

let tokenCache: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.value;
  const sa = serviceAccount();
  if (!IMPERSONATE) throw new Error("GOOGLE_MEET_IMPERSONATE_USER is not set (Meet needs a Workspace user)");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, sub: IMPERSONATE, scope: SCOPES, aud: sa.token_uri, iat: now, exp: now + 3600 }),
  );
  const key = await importKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(sig)}`;
  const res = await fetch(sa.token_uri!, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

// ---- Meet API -------------------------------------------------------------
type Space = { name: string; meetingUri: string; meetingCode?: string };

async function createSpace(token: string): Promise<Space> {
  // Proven 2026-10-06: exactly this and nothing more. artifactConfig,
  // presentRestriction and defaultJoinAsViewerType are FEATURE_UNAVAILABLE_TO_USER
  // on our edition and fail the whole create; the defaults already have
  // recording / transcription / smart notes OFF.
  const config = {
    accessType: ACCESS_TYPE === "TRUSTED" ? "TRUSTED" : "OPEN",
    entryPointAccess: "ALL",
    moderation: "ON",
  };
  for (const version of ["v2", "v2beta"]) {
    const res = await fetch(`https://meet.googleapis.com/${version}/spaces`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) return (await res.json()) as Space;
    const text = await res.text();
    // A 400 on v2 usually means a config field is still beta-only: try v2beta once.
    if (res.status === 400 && version === "v2") continue;
    throw new Error(`spaces.create ${version} ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error("spaces.create failed on v2 and v2beta");
}

async function addCohost(token: string, spaceName: string, email: string): Promise<boolean> {
  // VERIFY: spaces.members is v2beta, Developer Preview, Workspace-edition gated.
  try {
    const res = await fetch(`https://meet.googleapis.com/v2beta/${spaceName}/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ email, role: "COHOST" }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("cohost failed", res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("cohost threw", e instanceof Error ? e.message : String(e));
    return false;
  }
}

// ---- the pass --------------------------------------------------------------
type Due = {
  booking_id: string;
  ptm_id: string;
  ptm_title: string;
  slot_starts_at: string;
  teacher_id: string;
  teacher_name: string;
  // The effective account: COALESCE(user_google_accounts.google_email, the teacher's login
  // email). Since 2026-10-05 a Google account is never required to schedule, so the claim RPC
  // must fall back to the login email here or co-host is skipped for most teachers.
  teacher_google_email: string | null;
  student_name: string;
  attempt: number;
};

Deno.serve(async (req) => {
  // 1. Validate first (CLAUDE.md 23 / skill 14).
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get("authorization") !== `Bearer ${WEBHOOK_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const started = Date.now();
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 2. Claim the due rows (idempotent across overlapping passes).
  const { data: due, error } = await db.rpc("ptm_meet_claim_due", { _limit: BATCH });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = (due ?? []) as Due[];
  if (rows.length === 0) return Response.json({ claimed: 0, created: 0, failed: 0 });

  let token: string;
  try {
    token = await accessToken();
  } catch (e) {
    // No token: release every claim by recording the failure (they retry in 10 minutes).
    const msg = e instanceof Error ? e.message : String(e);
    await Promise.all(rows.map((r) => db.rpc("ptm_meet_fail", { _booking_id: r.booking_id, _error: msg })));
    return Response.json({ claimed: rows.length, created: 0, failed: rows.length, error: msg }, { status: 502 });
  }

  let created = 0;
  let failed = 0;
  let stopped = 0;
  const queue = [...rows];

  async function worker() {
    while (queue.length > 0) {
      if (Date.now() - started > BUDGET_MS) {
        // Out of time: leave the rest claimed; they retry next pass after 10 minutes.
        stopped += queue.length;
        queue.length = 0;
        return;
      }
      const row = queue.shift()!;
      try {
        const space = await createSpace(token);
        const cohost = TRY_COHOST && row.teacher_google_email ? await addCohost(token, space.name, row.teacher_google_email) : false;
        const { error: recErr } = await db.rpc("ptm_meet_record", {
          _booking_id: row.booking_id,
          _space_id: space.name,
          _meet_uri: space.meetingUri,
          _cohost_set: cohost,
        });
        if (recErr) throw new Error(`record: ${recErr.message}`);
        created += 1;
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        await db.rpc("ptm_meet_fail", { _booking_id: row.booking_id, _error: msg });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, rows.length) }, worker));
  return Response.json({ claimed: rows.length, created, failed, deferred: stopped, ms: Date.now() - started });
});
```

Smoke test once deployed (Tushar): set one online booking's slot to now + 30 minutes in a test
school, run `SELECT public.ptm_meet_create_kick();`, then check `ptm_bookings.meet_uri` is a
`https://meet.google.com/...` link, `meet_cohost_set` says whether co-host worked, and open the
link from a signed-out browser and from the Android WebView. A second kick must create nothing
(`ptm_meet_claim_due` returns no rows).
