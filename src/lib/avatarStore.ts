import { supabase } from "@/integrations/supabase/client";

const BUCKET = "user-avatars";

/**
 * MUST NOT start with "salci-": src/main.tsx:72 deletes every Cache Storage key
 * with that prefix on dev boot, which would wipe the photo cache constantly.
 */
const CACHE_NAME = "user-avatars-v1";

/**
 * Photo fetches must never compete with the page's own data queries. Object
 * paths are immutable, so a cached entry is never stale and a cache hit costs
 * no slot at all.
 */
const MAX_IN_FLIGHT = 6;

const objectUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let active = 0;

const generation = new Map<string, number>();

/**
 * Bumped by purgeAvatarCache(). A per-path generation cannot carry a purge on
 * its own: purging clears the map, so `generation.get(path) ?? 0` falls back to
 * 0, which is the SAME value a load that started before the purge captured. That
 * load would compare equal, decide it is still current, and repopulate both
 * layers after the purge returned, silently undoing a sign-out on a shared
 * device. The epoch is monotonic and never cleared, so it invalidates every
 * in-flight load whether or not its path was ever individually forgotten.
 */
let epoch = 0;

/**
 * Bump a path's generation, invalidating any load() currently in flight for it.
 * This exists for the photo REMOVAL case: without it, forgetAvatar() could purge
 * the cache and objectUrls entries for a path while an already-running load() for
 * that same path later finishes and re-populates both, resurrecting bytes that
 * were just deleted from the device.
 */
function bump(path: string): number {
  const next = (generation.get(path) ?? 0) + 1;
  generation.set(path, next);
  return next;
}

function acquire(): Promise<void> {
  if (active < MAX_IN_FLIGHT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => { waiting.push(resolve); });
}

function release(): void {
  const next = waiting.shift();
  // Hand the slot straight on rather than decrementing and re-incrementing.
  if (next) { next(); return; }
  active -= 1;
}

function cacheKeyFor(path: string): string {
  // Encode: the Cache API resolves this key against the document base URL, and an
  // unencoded path containing ?, # or .. would silently truncate, normalize, or
  // collide. The stored path shape is a client-side convention, not a DB-enforced
  // invariant, so this removes the dependency entirely.
  return `/__avatar/${encodeURIComponent(path)}`;
}

async function readFromCache(path: string): Promise<Blob | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKeyFor(path));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function writeToCache(path: string, blob: Blob): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKeyFor(path), new Response(blob));
  } catch {
    // Quota exceeded or private mode. The in-memory map still serves this session.
  }
}

async function load(path: string): Promise<string | null> {
  const gen = generation.get(path) ?? 0;
  const startedAt = epoch;
  // Stale once EITHER this path was individually forgotten or the whole cache
  // was purged underneath us.
  const stale = () => (generation.get(path) ?? 0) !== gen || epoch !== startedAt;

  let blob = await readFromCache(path);

  if (!blob) {
    await acquire();
    try {
      // The authenticated endpoint: RLS is evaluated on every single fetch and
      // no shareable URL is ever produced.
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) return null;
      blob = data;
      // Abandon quietly if forgetAvatar() or purgeAvatarCache() ran while this
      // fetch was in flight - otherwise this write would resurrect bytes that
      // were just purged.
      if (stale()) return null;
      void writeToCache(path, blob);
    } finally {
      release();
    }
  }

  // Same check as above: an invalidation may have landed while we were reading
  // the on-device cache or waiting on the download.
  if (stale()) return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(path, url);
  return url;
}

/**
 * Resolve a photo to a tab-local blob: URL. A blob: URL cannot be shared: paste
 * it anywhere else and it resolves to nothing, and it dies on reload.
 *
 * Returns null on any failure so the caller falls back to initials. Never throws.
 */
export function getAvatarObjectUrl(path: string): Promise<string | null> {
  const existing = objectUrls.get(path);
  if (existing) return Promise.resolve(existing);

  const pending = inflight.get(path);
  if (pending) return pending;

  const promise = load(path)
    .catch(() => null)
    .finally(() => { inflight.delete(path); });

  inflight.set(path, promise);
  return promise;
}

/** Drop a photo from every layer. Call after replacing or removing one. */
export async function forgetAvatar(path: string): Promise<void> {
  // Invalidate any load() already in flight for this path so it cannot
  // repopulate objectUrls or the cache after this purge (see bump() above).
  bump(path);
  const url = objectUrls.get(path);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(path);
  }
  inflight.delete(path);
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(cacheKeyFor(path));
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Drop every cached photo. Call on sign-out: Cache Storage is origin-scoped, not
 * user-scoped, so on a shared device one user's photos would otherwise outlive their
 * session.
 */
export async function purgeAvatarCache(): Promise<void> {
  // FIRST, and never after: any load already in flight compares against the
  // epoch it started with, so bumping here is what stops it repopulating the
  // maps and Cache Storage once this function has returned.
  epoch += 1;
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  inflight.clear();
  generation.clear();
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Nothing to clean up.
  }
}
