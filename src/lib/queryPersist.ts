import { dehydrate, hydrate, type Query, type QueryClient } from "@tanstack/react-query";

import { onAppStateChange } from "@/lib/native";

/**
 * Keeps the React Query cache across page loads and app launches.
 *
 * Why: in the phone app every screen change was a skeleton for as long as the
 * network took (2026-09-17). Within one session the in-memory cache already
 * covers a revisit, but the app is killed in the background, its WebView is
 * reloaded, and the cache starts empty; on a weak signal that is seconds of
 * placeholder on every return. With the last known data restored before the
 * first render, a revisited screen paints at once and refreshes underneath,
 * which is the stale-while-revalidate behaviour a native app is expected to
 * have. Each query's own `staleTime` still decides when it refetches, so
 * nothing gets fresher or staler than it was; it only gets shown sooner.
 *
 * Storage is localStorage, read synchronously so hydration finishes before
 * any component mounts and no skeleton can flash. The snapshot is bound to the
 * signed-in user: it is only restored for the same user id that wrote it, it
 * is dropped when nobody is signed in, and sign-out clears it explicitly. What
 * is never persisted: queries that failed, queries with `staleTime: 0` (live
 * timers and payment status), exam-time state named in NEVER_PERSIST, and any
 * query whose data is not plain JSON. The snapshot goes through
 * JSON.stringify, and a `Set` or `Map` comes back from it as `{}`, a `Date`
 * as a string: on 2026-09-18 the attendance pins (a Set) were restored as `{}`
 * and every reload of /school/attendance died in the error boundary with
 * "x.has is not a function". Such queries start empty and fetch, as they did
 * before persistence existed. A hook can also opt out with
 * `meta: { persist: false }`.
 */

const STORAGE_KEY = "salci-query-cache-v1";
// v2 (2026-09-18): v1 snapshots hold Set/Map data flattened to `{}`; refuse them.
// v3 (2026-10-05): the admin dashboard accuracy pass changed what many dash5_*
// payloads mean (published marks only, teachers-only roster, null bands, new
// keys); a cached v2 dashboard would show the old, wrong numbers until refetch.
// v4 (2026-10-07): the accuracy pass was undone on Tushar's instruction; the dash5_*
// payloads mean what they meant before v3 again, so v3 snapshots are refused.
const SNAPSHOT_VERSION = 4;
const MAX_AGE_MS = 24 * 60 * 60_000;
// localStorage gives about 5 MB per origin, shared with the auth token and
// every stored preference. A snapshot past this size is skipped and the last
// good one stays, rather than risking a quota error mid-write.
const MAX_SNAPSHOT_CHARS = 3_500_000;
const WRITE_DEBOUNCE_MS = 1_000;

// Query-key roots whose data must never come back from an earlier session: an
// exam in progress reads its clock, its answers and its pairing from these.
const NEVER_PERSIST = new Set([
  "exam-attempt",
  "hybrid-attempt",
  "hybrid-exam-data",
  "hybrid-pairing-token",
  "hybrid-uploaded-pages",
]);

interface Snapshot {
  v: number;
  userId: string;
  at: number;
  state: unknown;
}

/**
 * The signed-in user's id straight from supabase-js's persisted session, so
 * it is available synchronously before the client has been asked anything.
 * The key is `sb-<project ref>-auth-token` and the value is the Session JSON.
 */
function signedInUserId(): string | null {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const session = JSON.parse(raw) as { user?: { id?: unknown } } | null;
      const id = session?.user?.id;
      if (typeof id === "string" && id) return id;
    }
  } catch {
    /* storage unavailable or not JSON: treat as signed out */
  }
  return null;
}

/**
 * Can `value` survive JSON.stringify -> JSON.parse unchanged? Only null,
 * booleans, strings, finite numbers, plain arrays and plain objects can. A Set
 * or Map serialises to `{}`, a Date to a string, NaN/Infinity to null, and an
 * `undefined` array element to null; any of those restored into a hook that
 * expects the original type crashes the first component to read it. An
 * `undefined` object property is fine: JSON drops the key and a read sees the
 * same `undefined`.
 */
function isJsonSafeValue(value: unknown, inArray: boolean): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "undefined":
      return !inArray;
    case "object":
      break;
    default:
      return false; // function, symbol, bigint
  }
  const obj = value as object;
  if (Array.isArray(obj)) return obj.every((v) => isJsonSafeValue(v, true));
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(obj as Record<string, unknown>).every((v) => isJsonSafeValue(v, false));
}

// Verdict per data reference: a query's data object is replaced only when it
// refetches, so the debounced writes in between re-check nothing.
const jsonSafeByData = new WeakMap<object, boolean>();

function isJsonSafe(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return isJsonSafeValue(data, false);
  const known = jsonSafeByData.get(data);
  if (known !== undefined) return known;
  const ok = isJsonSafeValue(data, false);
  jsonSafeByData.set(data, ok);
  return ok;
}

function shouldPersist(query: Query): boolean {
  if (query.state.status !== "success") return false;
  if (query.meta?.persist === false) return false;
  // Query merges the observer's options in, so staleTime is present at
  // runtime even though the static type does not declare it.
  const { staleTime } = query.options as { staleTime?: unknown };
  if (staleTime === 0) return false;
  const root = query.queryKey[0];
  if (typeof root === "string" && NEVER_PERSIST.has(root)) return false;
  return isJsonSafe(query.state.data);
}

/** Removes the stored snapshot. Called on sign-out; safe to call any time. */
export function clearPersistedQueryCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Seeds `client` from the stored snapshot. Synchronous: call it right after
 * the QueryClient is created and before anything renders. A snapshot that is
 * too old, malformed, written by another user, or found while signed out is
 * discarded instead of restored.
 */
export function restoreQueryCache(client: QueryClient): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  const userId = signedInUserId();
  try {
    const snap = JSON.parse(raw) as Partial<Snapshot> | null;
    const usable =
      !!snap &&
      snap.v === SNAPSHOT_VERSION &&
      typeof snap.at === "number" &&
      Date.now() - snap.at < MAX_AGE_MS &&
      !!userId &&
      snap.userId === userId &&
      !!snap.state;
    if (!usable) {
      clearPersistedQueryCache();
      return;
    }
    hydrate(client, snap.state);
  } catch {
    clearPersistedQueryCache();
  }
}

/**
 * Writes the cache back whenever it changes, debounced, and flushes at once
 * when the app goes to the background (where a phone may kill it) or the page
 * is being unloaded. Returns the unsubscribe function.
 */
export function persistQueryCache(client: QueryClient): () => void {
  let timer: number | undefined;

  const write = () => {
    timer = undefined;
    const userId = signedInUserId();
    // Signed out: nothing may outlive the session on this device.
    if (!userId) {
      clearPersistedQueryCache();
      return;
    }
    try {
      const snap: Snapshot = {
        v: SNAPSHOT_VERSION,
        userId,
        at: Date.now(),
        state: dehydrate(client, { shouldDehydrateQuery: shouldPersist }),
      };
      const json = JSON.stringify(snap);
      if (json.length > MAX_SNAPSHOT_CHARS) return;
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // Quota exceeded or unserialisable data: better no snapshot than a
      // half-written one.
      clearPersistedQueryCache();
    }
  };

  const schedule = () => {
    if (timer === undefined) timer = window.setTimeout(write, WRITE_DEBOUNCE_MS);
  };

  const flush = () => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    write();
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    // Observer bookkeeping changes nothing worth storing; data does.
    if (event.type === "added" || event.type === "removed" || event.type === "updated") schedule();
  });
  const stopAppState = onAppStateChange((active) => {
    if (!active) flush();
  });
  window.addEventListener("pagehide", flush);

  return () => {
    unsubscribe();
    stopAppState();
    window.removeEventListener("pagehide", flush);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
