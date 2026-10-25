import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type InvokeOptions = {
  action: string;
  data?: unknown;
};

/**
 * Call a Supabase Edge Function with the signed-in user's access token.
 *
 * We do NOT use `supabase.functions.invoke` here: in this client setup it failed
 * to propagate the session token to the function (the function received
 * `Authorization: Bearer ` with no token and `auth.getUser()` returned
 * "Auth session missing!", causing spurious 403s for fully-authorized users).
 * PostgREST and Realtime auto-attach the token fine; functions.invoke did not.
 *
 * A plain authenticated fetch removes that variable entirely: we read the token
 * from the cached session (getSession is local, no network) and send it — plus
 * the publishable `apikey` the Functions gateway requires — ourselves. The error
 * contract is unchanged: a `{ error: string }` body (any status) is thrown as a
 * real Error so `toastError` can translate it.
 */
/** Seconds of validity we require before reusing the cached access token. */
const EXPIRY_MARGIN_S = 30;

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

/**
 * Access token that is actually valid. getSession() hands back the CACHED
 * session even when its access token has expired — PostgREST/Realtime refresh
 * transparently, but this direct-fetch path must do it itself, otherwise a
 * long-lived tab starts getting 401s from the Functions gateway (bulk upload
 * surfaced this: every row failed "session expired" while the rest of the
 * page worked fine).
 */
async function getFreshAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const nowS = Math.floor(Date.now() / 1000);
  if (session?.access_token && (session.expires_at ?? 0) > nowS + EXPIRY_MARGIN_S) {
    return session.access_token;
  }
  const { data: refreshed, error } = await supabase.auth.refreshSession();
  const token = refreshed.session?.access_token;
  if (error || !token) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  return token;
}

/**
 * Hard client-side deadline per edge-function call. A hung function (or a
 * saturated gateway) must not hold a browser connection open indefinitely —
 * stalled requests pile up and amplify exactly when the backend is already
 * struggling (§23.14). 30s covers the slowest legitimate admin operations.
 */
const EDGE_FN_TIMEOUT_MS = 30_000;

async function postToFunction(name: string, body: unknown, token: string): Promise<Response> {
  try {
    return await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(EDGE_FN_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error("The server took too long to respond. Please try again.");
    }
    throw e;
  }
}

async function callEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const token = await getFreshAccessToken();
  let res = await postToFunction(name, body, token);

  // One retry on 401, whether the gateway rejected the JWT before the function
  // ran (token expired between the margin check and the request, clock skew)
  // or the function's own `auth.getUser()` refused it. Re-posting after a
  // forced refresh is safe and idempotent.
  //
  // If the refresh FAILS the session is dead server-side. GoTrue answers
  // `session_not_found` once the session row has been revoked (a global
  // sign-out on another device, a password reset, an admin revoke) while the
  // JWT itself stays valid for up to an hour, and PostgREST keeps serving that
  // token, so the page looks signed in but every edge function refuses it
  // (2026-09-11: a super_school_admin got a dead-end "Unauthorized" on every
  // teacher delete). By the time refreshSession() resolves with a
  // non-retryable error supabase-js has already purged the local session and
  // emitted SIGNED_OUT, so ProtectedRoute is bouncing the user to /login; the
  // thrown message is what the toast shows on the way out. A retryable error
  // is a network failure, not a dead session, and must not read as one.
  if (res.status === 401) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    const retryToken = refreshed.session?.access_token;
    if (error || !retryToken) {
      throw new Error(error && isAuthRetryableFetchError(error) ? OFFLINE_MESSAGE : SESSION_EXPIRED_MESSAGE);
    }
    res = await postToFunction(name, body, retryToken);
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Non-JSON body (rare) — fall through to status-based error / null result.
  }

  const bodyError =
    parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
      ? (parsed as { error: string }).error
      : null;

  if (!res.ok) {
    throw new Error(bodyError ?? `Request failed (${res.status})`);
  }
  if (bodyError) {
    throw new Error(bodyError);
  }
  return parsed as T;
}

/**
 * Generic edge-function invoker.
 *
 *   const result = await invokeEdgeFunction<{ processed: number }>(
 *     "snapshot-student-passport",
 *     { institution_id, academic_year },
 *   );
 */
export async function invokeEdgeFunction<T = unknown>(
  name: string,
  body?: unknown,
): Promise<T> {
  return callEdgeFunction<T>(name, body);
}

/**
 * admin-operations helper — same auth + error contract, fixed `{ action, data }`
 * payload shape. See CLAUDE.md §21.
 */
export async function invokeAdminOperation<T = unknown>(opts: InvokeOptions): Promise<T> {
  return callEdgeFunction<T>("admin-operations", {
    action: opts.action,
    data: opts.data ?? {},
  });
}
