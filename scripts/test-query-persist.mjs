/**
 * Regression test for src/lib/queryPersist.ts.
 *
 * WHY THIS FILE EXISTS. On 2026-09-18 /school/attendance died in the error
 * boundary on every reload for six hours ("x.has is not a function"). The query
 * cache had started persisting to localStorage, a `Set` serialises through
 * JSON.stringify as `{}`, and the next load hydrated that `{}` with status
 * "success", so `pinnedSet.has(...)` was called on a plain object. The same
 * latent crash sat behind every other Set/Map query in the app, and Dates were
 * silently coming back as strings.
 *
 * The repo has no test runner. Rather than add one, this bundles the REAL
 * module with the esbuild already in node_modules and exercises it against a
 * fake localStorage. No new dependencies, runs in about a second.
 *
 *   npm run test:cache
 *
 * It is deliberately narrow: it guards the one invariant whose violation is
 * invisible to typecheck, lint and build, because the data only changes shape
 * at runtime, on the way through storage.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

// fileURLToPath, not .pathname: the repo lives under "Salci Projects" and a
// raw pathname keeps the space percent-encoded, which esbuild cannot resolve.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ── a localStorage good enough for the module under test ────────────────────
// Stored keys must be OWN ENUMERABLE properties, exactly as the real thing
// exposes them: signedInUserId() finds the session by walking
// Object.keys(localStorage) looking for `sb-*-auth-token`. A Map-backed fake
// whose methods are enumerable makes that walk find the methods and no session,
// so nothing is ever persisted and every assertion fails for the wrong reason.
// defineProperties gives non-enumerable methods, leaving Object.keys to the data.
function makeStorage() {
  const store = {};
  Object.defineProperties(store, {
    getItem: {
      value: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    },
    setItem: {
      value: (k, v) => {
        store[k] = String(v);
      },
    },
    removeItem: {
      value: (k) => {
        delete store[k];
      },
    },
    clear: {
      value: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
    key: { value: (i) => Object.keys(store)[i] ?? null },
    length: { get: () => Object.keys(store).length },
  });
  return store;
}

function installGlobals(storage) {
  const noop = () => {};
  globalThis.localStorage = storage;
  globalThis.window = {
    localStorage: storage,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    addEventListener: noop,
    removeEventListener: noop,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
  };
  globalThis.document = {
    addEventListener: noop,
    removeEventListener: noop,
    visibilityState: "visible",
    querySelector: () => null,
    createElement: () => ({ style: {}, dataset: {}, appendChild: noop }),
    head: { appendChild: noop },
    body: { appendChild: noop, removeChild: noop },
  };
  // signedInUserId() reads the supabase session straight out of localStorage.
  storage.setItem(
    "sb-gyymkgohcijeksmrzuyw-auth-token",
    JSON.stringify({ user: { id: "11111111-1111-1111-1111-111111111111" } }),
  );
}

// ── build the real module (plus QueryClient from the SAME bundle, so there is
//    only ever one copy of react-query in play) ─────────────────────────────
async function loadModule(dir) {
  const out = join(dir, "bundle.mjs");

  // queryPersist imports onAppStateChange from the @/lib/native BARREL, which
  // re-exports download.ts -> @/lib/toast -> sonner, and sonner injects a
  // <style> element the moment it is imported. Stub the barrel: this test is
  // about what survives a trip through storage, not about the native adapter,
  // and pulling half the app in would make it fragile for no benefit.
  const shim = join(dir, "native-shim.js");
  writeFileSync(
    shim,
    [
      "export function onAppStateChange() { return () => {}; }",
      "export function isNativePlatform() { return false; }",
      "export function nativePlatform() { return null; }",
    ].join("\n"),
  );

  await esbuild.build({
    stdin: {
      contents: `
        export * from "@/lib/queryPersist";
        export { QueryClient } from "@tanstack/react-query";
      `,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    // "browser", not "neutral": neutral does not resolve node_modules, and this
    // module is browser code anyway.
    platform: "browser",
    alias: { "@/lib/native": shim, "@": join(ROOT, "src") },
    outfile: out,
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

// ── assertions ──────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
};

const settle = () => new Promise((r) => setTimeout(r, 1300)); // > WRITE_DEBOUNCE_MS

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "salci-persist-"));
  try {
    const storage = makeStorage();
    installGlobals(storage);
    const mod = await loadModule(dir);
    const { QueryClient, persistQueryCache, restoreQueryCache, clearPersistedQueryCache } = mod;

    // ---- seed a client with one query of each shape ----
    const client = new QueryClient();
    const seed = (key, data) =>
      client.setQueryData(Array.isArray(key) ? key : [key], data);

    // Subscribe FIRST, then populate. persistQueryCache only reacts to cache
    // events after it subscribes, which mirrors the app: App.tsx wires it up at
    // module load and queries fill in as the user navigates. Seeding first means
    // no event ever fires and nothing is written, which looks exactly like a
    // broken persister.
    const stop = persistQueryCache(client);

    seed("plain-array", [{ id: "a", n: 1 }, { id: "b", n: 2 }]);
    seed("plain-object", { total: 7, nested: { ok: true, list: [1, 2, 3] }, nothing: null });
    seed("a-set", new Set(["x", "y"]));              // the 2026-09-18 crash
    seed("a-map", new Map([["k", 1]]));              // was next in line
    seed("a-date", new Date("2026-09-18T10:56:00Z")); // came back as a string
    seed("exam-attempt", { answers: [1, 2] });       // NEVER_PERSIST root

    await settle();
    stop();

    const raw = storage.getItem("salci-query-cache-v1");
    ok("a snapshot was written at all", !!raw);
    const snap = raw ? JSON.parse(raw) : null;
    const persistedKeys = new Set(
      (snap?.state?.queries ?? []).map((q) => JSON.stringify(q.queryKey)),
    );
    const has = (k) => persistedKeys.has(JSON.stringify([k]));

    ok("plain array IS persisted", has("plain-array"));
    ok("plain object IS persisted", has("plain-object"));
    ok("Set is NOT persisted", !has("a-set"), "a Set stores as {} and restores with no .has()");
    ok("Map is NOT persisted", !has("a-map"), "a Map stores as {} and restores with no .get()");
    ok("Date is NOT persisted", !has("a-date"), "a Date restores as a string, not a Date");
    ok("NEVER_PERSIST root excluded", !has("exam-attempt"), "in-flight exam state must not be restored");

    // ---- restore into a fresh client ----
    const restored = new QueryClient();
    restoreQueryCache(restored);
    const arr = restored.getQueryData(["plain-array"]);
    const obj = restored.getQueryData(["plain-object"]);
    ok(
      "plain array round-trips intact",
      Array.isArray(arr) && arr.length === 2 && arr[1].id === "b",
      JSON.stringify(arr),
    );
    ok("plain object round-trips intact", obj?.nested?.list?.[2] === 3, JSON.stringify(obj));
    ok(
      "Set query restores as ABSENT, not as {}",
      restored.getQueryData(["a-set"]) === undefined,
      "must be undefined so the hook refetches a real Set",
    );

    // ---- a stale-version snapshot must be refused, not hydrated ----
    storage.setItem(
      "salci-query-cache-v1",
      JSON.stringify({
        v: 1, // the poisoned version shipped before the fix
        userId: "11111111-1111-1111-1111-111111111111",
        at: Date.now(),
        state: { queries: [{ queryKey: ["plain-array"], queryHash: '["plain-array"]', state: { data: [{ id: "zz" }], status: "success", dataUpdatedAt: Date.now() } }], mutations: [] },
      }),
    );
    const afterV1 = new QueryClient();
    restoreQueryCache(afterV1);
    ok(
      "a v1 snapshot is refused",
      afterV1.getQueryData(["plain-array"]) === undefined,
      "old poisoned snapshots must not outlive the deploy",
    );
    ok(
      "and the refused snapshot is cleared from storage",
      storage.getItem("salci-query-cache-v1") === null,
    );

    // ---- another user's snapshot must never be restored ----
    storage.setItem(
      "salci-query-cache-v1",
      JSON.stringify({
        v: 2,
        userId: "99999999-9999-9999-9999-999999999999",
        at: Date.now(),
        state: { queries: [{ queryKey: ["plain-array"], queryHash: '["plain-array"]', state: { data: [{ id: "someone-else" }], status: "success", dataUpdatedAt: Date.now() } }], mutations: [] },
      }),
    );
    const otherUser = new QueryClient();
    restoreQueryCache(otherUser);
    ok(
      "another user's snapshot is refused",
      otherUser.getQueryData(["plain-array"]) === undefined,
      "shared-device leak",
    );

    clearPersistedQueryCache();
    ok("clear wipes the snapshot", storage.getItem("salci-query-cache-v1") === null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
