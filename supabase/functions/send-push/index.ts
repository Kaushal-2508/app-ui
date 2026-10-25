// Native (Capacitor) push delivery over FCM HTTP v1.
//
// The counterpart to send-web-push: that one addresses browsers through Web
// Push/VAPID and reads `push_subscriptions`, this one addresses phones through
// FCM device tokens and reads `push_devices`. Same webhook contract, same
// Bearer WEBHOOK_SECRET guard, so one Database Webhook on `notifications`
// INSERT can call both.
//
// Secret: FCM_SERVICE_ACCOUNT_JSON, the Firebase admin service-account JSON for
// project salci-app-535ce. It is a PRIVATE KEY: never log it, never echo it in
// a response, and never let it reach the client bundle.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
}

function serviceAccount(): ServiceAccount {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FCM_SERVICE_ACCOUNT_JSON is not set.");
  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(raw);
  } catch {
    // Deliberately does not include the value in the message.
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is missing client_email, private_key or project_id.");
  }
  return {
    client_email: sa.client_email,
    // Secrets set through a UI often arrive with the newlines escaped.
    private_key: sa.private_key.replace(/\\n/g, "\n"),
    project_id: sa.project_id,
    token_uri: sa.token_uri ?? "https://oauth2.googleapis.com/token",
  };
}

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// One access token is good for an hour. Cached at module scope so a warm
// instance re-uses it instead of doing an RSA signature and a token exchange
// for every notification; a notification fan-out would otherwise pay that cost
// per row. Refreshed a minute early to avoid racing its own expiry.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: sa.token_uri,
        iat: now,
        exp: now + 3600,
      }),
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
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !payload.access_token) {
    throw new Error(
      `Google token exchange failed (${res.status}): ${payload.error_description ?? payload.error ?? "no access_token"}`,
    );
  }
  cachedToken = {
    value: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600),
  };
  return cachedToken.value;
}

/** FCM v1 requires every `data` value to be a string. */
function stringData(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

// FCM says the token is dead, so the row should go. Anything else (a 5xx, a
// quota error) is transient and the row stays.
const DEAD_TOKEN_CODES = new Set(["UNREGISTERED", "INVALID_ARGUMENT", "SENDER_ID_MISMATCH"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
    if (!webhookSecret || req.headers.get("Authorization") !== `Bearer ${webhookSecret}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();

    let userId: string | undefined;
    let title: string;
    let message: string;
    let data: Record<string, unknown>;

    if (body.record) {
      // Database Webhook: { type, table, record, schema, old_record }
      const r = body.record as {
        user_id?: string;
        title?: string;
        message?: string;
        link?: string | null;
        type?: string | null;
        id?: string;
      };
      userId = r.user_id;
      title = r.title || "SALCI";
      message = r.message || "";
      // `url` is the field the app reads (pushTargetUrl), and it only honours
      // same-app paths, so an absolute URL here would simply be ignored.
      data = { url: r.link || "/", notificationId: r.id, type: r.type };
    } else {
      userId = body.user_id;
      const p = (body.message_payload ?? {}) as {
        title?: string;
        body?: string;
        data?: Record<string, unknown>;
      };
      title = p.title || "SALCI";
      message = p.body || "";
      data = p.data ?? {};
    }

    if (!userId || (!title && !message)) {
      return json({ error: "user_id and a title or message are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: devices, error: dbError } = await supabase
      .from("push_devices")
      .select("token, platform")
      .eq("user_id", userId);

    if (dbError) {
      return json({ error: "Failed to fetch devices", details: dbError.message }, 500);
    }
    // Not an error: most users have no app installed. 200 so the webhook does
    // not retry, and so a fan-out is not held up by one deviceless recipient.
    if (!devices || devices.length === 0) {
      return json({ sent: 0, failed: 0, total: 0, cleaned: 0, message: "No devices for user" });
    }

    const sa = serviceAccount();
    const token = await accessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    const payloadData = stringData(data);

    const results = await Promise.allSettled(
      devices.map(async (d: { token: string; platform: string }) => {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: d.token,
              notification: { title, body: message },
              data: payloadData,
              android: {
                priority: "HIGH",
                notification: { default_sound: true },
              },
              apns: {
                headers: { "apns-priority": "10" },
                payload: { aps: { sound: "default" } },
              },
            },
          }),
        });
        if (res.ok) return { token: d.token, ok: true as const };
        const err = (await res.json().catch(() => ({}))) as {
          error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
        };
        const code =
          err.error?.details?.find((x) => x?.errorCode)?.errorCode ?? err.error?.status ?? String(res.status);
        return {
          token: d.token,
          ok: false as const,
          status: res.status,
          code,
          message: err.error?.message ?? `HTTP ${res.status}`,
        };
      }),
    );

    const dead: string[] = [];
    let sent = 0;
    const failures: { code: string; message: string; status?: number }[] = [];

    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.ok) {
          sent++;
          continue;
        }
        const v = r.value;
        // 404 is FCM's "this token is gone" even when it omits an errorCode.
        if (DEAD_TOKEN_CODES.has(v.code) || v.status === 404) dead.push(v.token);
        // The token itself is not included: it is a device credential.
        failures.push({ code: v.code, message: v.message, status: v.status });
      } else {
        failures.push({ code: "FETCH_FAILED", message: String(r.reason) });
      }
    }

    // Drop tokens FCM has invalidated, so a dead phone does not keep costing a
    // request on every notification forever. The app re-registers on next
    // launch, which is why this is safe to do eagerly.
    let cleaned = 0;
    if (dead.length > 0) {
      const { error: cleanupError, count } = await supabase
        .from("push_devices")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .in("token", dead);
      if (!cleanupError && typeof count === "number") cleaned = count;
    }

    return json({ sent, failed: failures.length, total: devices.length, cleaned, failures });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
