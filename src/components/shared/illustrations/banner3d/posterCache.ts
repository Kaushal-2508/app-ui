// A JPEG of the banner's composed still, per time of day and banner shape, so a return
// visit paints the 3D look at once, before three has loaded (design spec 3.2).
//
// IndexedDB, not localStorage: localStorage already holds the persisted query cache
// (src/lib/queryPersist.ts), and 30 to 120 kB posters there would compete for its 5 MB.
// At most MAX_ENTRIES posters are kept; the oldest is evicted. Every call is wrapped:
// a blocked, full or missing IndexedDB resolves to "no poster", never throws.
import type { SceneTod } from "./engine/types";

/** Bump when the scene's look changes, so old posters stop matching (and age out). */
// v2 (2026-09-29): posters are captured at device resolution; v1 ones were CSS-size and blurry.
export const POSTER_VERSION = "v2";

export type PosterBucket = "wide" | "phone";

const DB_NAME = "salci-banner";
const STORE = "posters";
// Every key a device can use: five moments x two shapes. A light-theme day alone cycles
// four moments, so a smaller cap evicts exactly the poster the next window needs.
const MAX_ENTRIES = 10;
// Safari has been seen to leave indexedDB.open pending forever; never wait on it.
const OPEN_TIMEOUT_MS = 2000;

interface PosterRow {
  dataUrl: string;
  at: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let liveDb: IDBDatabase | null = null;

// Drops a connection that can no longer be used, so the next call opens a fresh one: the
// browser closed it (site data cleared, or WebKit's "connection to Indexed Database server
// lost" after a long background), or another tab is upgrading the schema.
function forget(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // already closed
  }
  if (liveDb !== db) return;
  liveDb = null;
  dbPromise = null;
}

// transaction() on a closed or closing connection throws InvalidStateError.
function isClosedError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "InvalidStateError";
}

/** Phone-shaped banners (about 3:1) and laptop-shaped ones (about 8:1) keep separate posters. */
export function posterBucket(cssW: number, cssH: number): PosterBucket {
  return cssH > 0 && cssW / cssH < 5 ? "phone" : "wide";
}

function keyFor(tod: SceneTod, bucket: PosterBucket): string {
  return `${POSTER_VERSION}:${tod}:${bucket}`;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(db);
    };
    const timer = window.setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    try {
      if (typeof indexedDB === "undefined") {
        finish(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        } catch {
          // the open fails below and resolves null
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (settled) {
          db.close(); // the timeout already answered null
          return;
        }
        // another tab upgrading the schema: step aside instead of blocking it
        db.onversionchange = () => forget(db);
        // closed by the browser, not by us: reopen on the next call
        db.onclose = () => forget(db);
        liveDb = db;
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  }).then((db) => {
    if (!db) dbPromise = null; // try again on a later call
    return db;
  });
  return dbPromise;
}

function isRow(v: unknown): v is PosterRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { dataUrl?: unknown; at?: unknown };
  return typeof r.dataUrl === "string" && r.dataUrl.startsWith("data:image/") && typeof r.at === "number";
}

/**
 * The cached poster (a data URL) for this time of day and shape, or null. With
 * `maxAgeMs`, a poster written longer ago than that also reads as null: the frame holds
 * the tower clock at the minute it was captured.
 */
export async function getPoster(tod: SceneTod, bucket: PosterBucket, maxAgeMs = Infinity): Promise<string | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<string | null>((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(keyFor(tod, bucket));
        req.onsuccess = () => {
          const row: unknown = req.result;
          if (!isRow(row)) return resolve(null);
          const age = Date.now() - row.at;
          resolve(age >= 0 && age <= maxAgeMs ? row.dataUrl : null);
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        if (isClosedError(err)) forget(db);
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/** Stores a poster and evicts the oldest beyond MAX_ENTRIES. Fire and forget. */
export async function putPoster(tod: SceneTod, bucket: PosterBucket, dataUrl: string): Promise<void> {
  if (!dataUrl.startsWith("data:image/")) return;
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const row: PosterRow = { dataUrl, at: Date.now() };
        store.put(row, keyFor(tod, bucket));
        // one cursor pass over at most MAX_ENTRIES + 1 rows: keep the newest MAX_ENTRIES
        const seen: Array<{ key: IDBValidKey; at: number }> = [];
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const value: unknown = cursor.value;
            seen.push({ key: cursor.key, at: isRow(value) ? value.at : 0 });
            cursor.continue();
            return;
          }
          seen.sort((a, b) => b.at - a.at);
          for (const old of seen.slice(MAX_ENTRIES)) store.delete(old.key);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve(); // quota exceeded lands here
      } catch (err) {
        if (isClosedError(err)) forget(db);
        resolve();
      }
    });
  } catch {
    // no poster this time; the banner still works
  }
}
