/**
 * Retry policy for the dashboard queries (useDash5, useCoord, and the admin
 * hooks the v5 dashboard reads from useAdminDashboardData).
 *
 * WHY NOT THE APP DEFAULT. App.tsx sets `retry: 1` with a 1s delay for every
 * query. On these hooks that is actively harmful: the `authenticated` role has
 * an 8s statement_timeout, so an aggregate that times out (57014) spins 8s,
 * waits 1s and runs the identical 8s query again. The card shows its error
 * after about 17s instead of 8s, and the rerun doubles the database work at
 * exactly the moment the database is already struggling. Deterministic
 * failures (a RAISE, a permission refusal, a missing function) fail the same
 * way twice. So: at most one retry, and only for a failure that never reached
 * Postgres, or a gateway in front of it that failed transiently.
 *
 * THE SHAPES THIS READS. Every hook here does `if (error) throw error` on a
 * supabase-js (postgrest-js 2.x) result, so what reaches React Query is the
 * PostgREST error object, never a wrapped Error:
 *  - A Postgres or PostgREST failure carries its SQLSTATE or PGRST code
 *    ("57014", "P0001", "42501", "42883", "PGRST202"...). Never retried, with
 *    one exception: PGRST000, PGRST001 and PGRST002 are PostgREST's 503s for
 *    "cannot reach Postgres" and "schema cache not loaded yet". Those are a
 *    connection blip, not an answer, so they get the one retry.
 *  - Any failure of the fetch itself is caught by postgrest-js (2.89) and
 *    returned with an EMPTY code and the fetch error's name in the message:
 *    `{ message: "TypeError: Failed to fetch", code: "" }`. That includes the
 *    Supabase client's bounded fetch aborting a REST call after 20s on a dead
 *    keep-alive socket, which reads "TimeoutError: ...", or "AbortError: ..."
 *    on engines that ignore the abort reason. None of these queryFns pass a
 *    signal of their own, so an abort can only be that timeout. These ARE
 *    retried: the retry opens a fresh connection, which the client relies on.
 *  - A 502/503/504 from the gateway with a non-JSON body arrives as
 *    `{ message: <body> }` with no code and no status, so it is recognised by
 *    its text. An error that does carry a numeric `status` is judged by it.
 */

/** A Postgres SQLSTATE (five characters) or a PostgREST PGRST code. */
const DB_CODE = /^(PGRST\w*|[0-9A-Z]{5})$/;

/** PostgREST's 503s: it could not reach Postgres, or its schema cache is still loading. */
const DB_UNREACHABLE = new Set(["PGRST000", "PGRST001", "PGRST002"]);

/** What a fetch that never got an answer says, across browsers and runtimes. */
const NETWORK_FAILURE =
  /Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|TimeoutError|timed out after|AbortError/i;

/** A gateway page in front of PostgREST: Kong, Cloudflare, the load balancer. */
const GATEWAY_FAILURE =
  /\b50[234]\b|Bad Gateway|Service (Temporarily )?Unavailable|Gateway Time-?out|invalid response was received from the upstream/i;

const TRANSIENT_STATUS = new Set([502, 503, 504]);

export function dashRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (typeof error !== "object" || error === null) return false;

  const e = error as { code?: unknown; status?: unknown; message?: unknown };

  if (typeof e.code === "string" && DB_UNREACHABLE.has(e.code)) return true;
  if (typeof e.code === "string" && DB_CODE.test(e.code)) return false;

  if (typeof e.status === "number" && e.status > 0) return TRANSIENT_STATUS.has(e.status);

  const message = typeof e.message === "string" ? e.message : "";
  return NETWORK_FAILURE.test(message) || GATEWAY_FAILURE.test(message);
}
