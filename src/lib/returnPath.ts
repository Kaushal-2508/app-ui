/**
 * Where to send someone after they sign in. ProtectedRoute records the page a
 * signed-out visitor asked for in router state; the login page reads it back.
 * Built for the PTM feedback QR (a parent scans it while signed out and must
 * land on the form, not the dashboard), and it helps every other deep link.
 *
 * Only a same-origin path is honoured: it must start with a single "/", and
 * the auth pages themselves are refused so a return path can never loop.
 */

export const DEFAULT_AFTER_LOGIN = "/dashboard";

const AUTH_PATHS = new Set(["/", "/login", "/forgot-password", "/reset-password", "/password-reset-required"]);

/** The validated path to go to after login, or the dashboard. `state` is the
 *  router state ProtectedRoute sends: `{ from: pathname + search + hash }`. */
export function readReturnPath(state: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof state !== "object" || state === null || !("from" in state)) return fallback;
  const from = (state as { from?: unknown }).from;
  if (typeof from !== "string" || from.length === 0 || from.length > 2048) return fallback;
  // Control characters first: the URL parser drops tab/CR/LF, so "/\t/evil"
  // would pass the "//" test below and still resolve protocol-relative.
  for (let i = 0; i < from.length; i += 1) {
    const code = from.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  // "/x" only: not "//evil.com" (protocol-relative), not "https://…", no backslashes.
  if (!from.startsWith("/") || from.startsWith("//") || from.includes("\\")) return fallback;
  const pathname = from.split(/[?#]/)[0];
  if (AUTH_PATHS.has(pathname)) return fallback;
  return from;
}
