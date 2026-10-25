/**
 * Regression test for src/hooks/useUserRole.ts under a dropped connection.
 *
 * WHY THIS FILE EXISTS. On 2026-09-30 the Play test build was taken offline for
 * 10 to 15 seconds and brought back: every screen then showed empty "no data"
 * lists, reopening the app did not help, and only sign-out plus sign-in did.
 * useUserRole ignored the `error` of both of its reads, so a failed request
 * resolved as a SUCCESSFUL "no roles, no institution". Every institution-scoped
 * query keys off that, so every list went empty; the result counted as fresh
 * for staleTime, so the reconnect did not refetch it; and queryPersist saved it
 * like any other success, so a relaunch restored it. Sign-out was the only thing
 * that cleared the snapshot.
 *
 * Same harness as test-query-persist.mjs: bundle the REAL modules with the
 * esbuild already in node_modules, no test runner, no new dependencies.
 *
 *   npm run test:role-offline
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const USER_ID = "11111111-1111-1111-1111-111111111111";
const INSTITUTION_ID = "22222222-2222-2222-2222-222222222222";

// ── a localStorage with own-enumerable keys (see test-query-persist.mjs) ─────
function makeStorage() {
  const store = {};
  Object.defineProperties(store, {
    getItem: { value: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null) },
    setItem: { value: (k, v) => { store[k] = String(v); } },
    removeItem: { value: (k) => { delete store[k]; } },
    clear: { value: () => { for (const k of Object.keys(store)) delete store[k]; } },
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
  };
  storage.setItem("sb-gyymkgohcijeksmrzuyw-auth-token", JSON.stringify({ user: { id: USER_ID } }));
}

// ── build: the real useUserRole + queryPersist, with three seams stubbed ─────
//  * @/integrations/supabase/client -> a fake whose reads answer like
//    postgrest-js does: `{ data, error }`, never a throw, online or not.
//  * @tanstack/react-query -> the real query-core plus a `useQuery` that hands
//    back its options, so the hook's own queryFn and staleTime run inside a real
//    QueryClient without rendering React.
//  * @/lib/native -> no-ops (queryPersist only needs onAppStateChange).
async function loadModules(dir) {
  const supabaseShim = join(dir, "supabase-shim.js");
  writeFileSync(
    supabaseShim,
    `
    // online: whether requests reach the server. sessionDue: the access token is
    // inside auth-js's refresh margin, so getSession() must refresh it first and,
    // offline, answers { session: null, error } (GoTrueClient __loadSession).
    // signedIn: false models a real sign-out (no session, no error).
    export const net = { online: true, sessionDue: false, signedIn: true };
    const ROWS = {
      user_roles: [{ role: "school_admin", institution_id: "${INSTITUTION_ID}", employee_level_id: null }],
      profiles: { institution_id: "${INSTITUTION_ID}" },
    };
    const OFFLINE = { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" };
    function answer(table, single) {
      if (!net.online) return Promise.resolve({ data: null, error: OFFLINE });
      return Promise.resolve({ data: ROWS[table], error: null });
    }
    function builder(table) {
      const b = {
        select: () => b,
        eq: () => b,
        single: () => answer(table, true),
        maybeSingle: () => answer(table, true),
        then: (res, rej) => answer(table, false).then(res, rej),
      };
      return b;
    }
    export const supabase = {
      from: (table) => builder(table),
      auth: {
        getSession: async () => {
          if (!net.signedIn) return { data: { session: null }, error: null };
          if (net.sessionDue && !net.online) {
            return { data: { session: null }, error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 } };
          }
          return { data: { session: { user: { id: "${USER_ID}" } } }, error: null };
        },
      },
    };
    `,
  );

  const reactQueryShim = join(dir, "react-query-shim.js");
  writeFileSync(
    reactQueryShim,
    `export * from "@tanstack/query-core";\nexport const useQuery = (options) => options;\n`,
  );

  const nativeShim = join(dir, "native-shim.js");
  writeFileSync(
    nativeShim,
    [
      "export function onAppStateChange() { return () => {}; }",
      "export function isNativePlatform() { return false; }",
    ].join("\n"),
  );

  const out = join(dir, "bundle.mjs");
  await esbuild.build({
    stdin: {
      contents: `
        export { useUserRole } from "@/hooks/useUserRole";
        export * from "@/lib/queryPersist";
        export { QueryClient } from "@tanstack/query-core";
        export { net } from "@/integrations/supabase/client";
      `,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    // The shims live in a temp dir, so their own imports resolve from here.
    nodePaths: [join(ROOT, "node_modules")],
    alias: {
      "@/integrations/supabase/client": supabaseShim,
      "@tanstack/react-query": reactQueryShim,
      "@/lib/native": nativeShim,
      "@": join(ROOT, "src"),
    },
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

const settle = () => new Promise((r) => setTimeout(r, 1300)); // > queryPersist WRITE_DEBOUNCE_MS

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "salci-role-offline-"));
  try {
    const storage = makeStorage();
    installGlobals(storage);
    const { useUserRole, QueryClient, persistQueryCache, restoreQueryCache, net } = await loadModules(dir);

    // The app's own defaults (App.tsx), minus retry so a failure lands at once.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, gcTime: 24 * 60 * 60_000, retry: false } },
    });
    const stop = persistQueryCache(client);
    const options = useUserRole();
    const key = options.queryKey;

    // Refetch the way a remount past the 60 s window does. Never pass
    // `staleTime: 0` to force it: that lands in query.options, and queryPersist
    // skips staleTime-0 queries, so the relaunch check below would pass vacuously.
    const refetch = () => client.refetchQueries({ queryKey: key });

    // 1. Online: the real roles load.
    net.online = true;
    await client.fetchQuery(options);
    const good = client.getQueryData(key);
    ok("online: roles load", good?.institutionId === INSTITUTION_ID && good?.isSchoolAdmin === true, JSON.stringify(good));

    // 2. The connection drops and a screen asks again.
    net.online = false;
    await refetch();
    const afterDrop = client.getQueryData(key);
    const state = client.getQueryState(key);
    ok(
      "offline: the failed read is reported as an error, not as success",
      state?.status === "error",
      `status=${state?.status}`,
    );
    ok(
      "offline: the last good roles are kept",
      afterDrop?.institutionId === INSTITUTION_ID,
      `institutionId=${afterDrop?.institutionId}`,
    );

    // 3. What a relaunch would restore.
    await settle();
    stop();
    const relaunched = new QueryClient();
    restoreQueryCache(relaunched);
    const restored = relaunched.getQueryData(key);
    ok(
      "relaunch never restores an empty 'no institution' answer",
      restored === undefined || restored.institutionId === INSTITUTION_ID,
      `restored=${JSON.stringify(restored)}`,
    );

    // 4. Back online: a fetch recovers.
    net.online = true;
    await refetch();
    ok("back online: roles load again", client.getQueryData(key)?.institutionId === INSTITUTION_ID);

    // 5. Offline with the token due for refresh: getSession() fails. That is
    //    "could not check", not "signed out", and must not wipe the roles.
    net.online = false;
    net.sessionDue = true;
    await refetch();
    ok(
      "offline token refresh: reported as an error, roles kept",
      client.getQueryState(key)?.status === "error" && client.getQueryData(key)?.institutionId === INSTITUTION_ID,
      `status=${client.getQueryState(key)?.status} institutionId=${client.getQueryData(key)?.institutionId}`,
    );
    net.online = true;
    net.sessionDue = false;

    // 6. A real sign-out still answers "no roles" as a success: ProtectedRoute
    //    and the login redirect rely on that.
    net.signedIn = false;
    await refetch();
    const signedOut = client.getQueryData(key);
    ok(
      "signed out: 'no roles' is still a successful answer",
      client.getQueryState(key)?.status === "success" && signedOut?.roles?.length === 0 && signedOut?.institutionId === null,
      `status=${client.getQueryState(key)?.status}`,
    );
    net.signedIn = true;
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
