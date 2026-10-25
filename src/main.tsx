import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App.tsx";
import { ensureViewportFitCover, isNativePlatform, markNativeShell } from "@/lib/native";
import { loadWebFonts } from "@/lib/fonts";
import { isDecorativeLoadError } from "@/lib/decorativeImports";
import "./index.css";

// Before the first render: safe-area insets need the viewport flag in place
// and the stylesheet needs to know it is inside the shell (both native only);
// the fonts are queued for after first paint so styling is never held back by
// a network request.
ensureViewportFitCover();
markNativeShell();
loadWebFonts();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </ErrorBoundary>
);

// ── Stale-chunk self-heal ──────────────────────────────────────────────────────
// Designed by Naman (docs/superpowers/specs/2026-09-22-route-chunk-revert.md).
// Shipped with three defects fixed, each measured in headless Chromium against a
// server that 404s missing /assets/ files the way vercel.json does.
//
// A deploy renames nearly every emitted file (~300 of 324 hashes change on a one-line
// edit, 71d10f42), so a tab left open across a deploy can ask for a file that no
// longer exists. vercel.json excludes /assets/ from the SPA rewrite, so Vercel 404s
// it, the dynamic import rejects, and the ErrorBoundary shows its crash screen on a
// perfectly healthy deploy. Vite fires `vite:preloadError` for exactly this, and a
// reload fetches the new index.html, which names the new files.
//
// It matters more since 71d10f42 throttled the service-worker update check to once
// per 15 minutes: a stale tab now stays stale longer before controllerchange reloads
// it, so more first visits land on a deleted file. This handler is what makes that
// throttle safe; keep the two together.
window.addEventListener("vite:preloadError", (event) => {
  // Offline, the file is not stale; the network is gone. A reload would land on the
  // browser's own offline page and lose the app. Let the import fail normally: the
  // ErrorBoundary's Reload button works once the connection returns.
  if (!navigator.onLine) return;

  // A decorative chunk (the 3D dashboard banner's engine) downloads in the background,
  // unasked, and its feature keeps a fallback: never reload the page under the user for
  // it. Not preventing default lets the import reject into its own catch.
  if (isDecorativeLoadError(event.payload)) return;

  // Unsaved input (§17 dirty-form contract): never reload under it, and do NOT call
  // preventDefault either. preventDefault makes Vite resolve the import to undefined:
  // for a lazy page React then crashes with "Cannot read properties of undefined
  // (reading 'default')" and the ErrorBoundary tears down the Toaster, so the update
  // toast could never appear. Failing normally is better in both cases: a lazy PAGE
  // shows the ErrorBoundary's own Reload button, and an on-demand LIBRARY (photo
  // conversion, PDF export) rejects into its caller's catch while the form and the
  // toast both survive.
  if (document.querySelector('form[data-dirty="true"]')) {
    window.dispatchEvent(new CustomEvent("salci-update-ready"));
    return;
  }

  // Loop guard: at most one automatic reload per 30 seconds per tab, because a file
  // missing for any reason other than a deploy is not fixed by reloading. If storage
  // is unavailable (blocked site data, some in-app browsers) there is no way to guard,
  // so do not auto-reload at all: without this a genuinely missing file measured 88
  // reloads in 15 seconds.
  const KEY = "salci-preload-reload-at";
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }

  // Handled: keep it away from the ErrorBoundary and load the new build.
  event.preventDefault();
  window.location.reload();
});

// ── Service Worker registration + update listener ──────────────────────────────
// Works for every surface our users touch: desktop browsers, mobile browsers,
// and installed PWAs (Add to Home Screen on iOS / Android, installed app on
// Windows / Mac). Installed PWAs are the tricky case — they suspend instead
// of closing, so a user can stay on an old build for days. The visibilitychange
// hook asks the browser to re-check /sw.js every time the app is brought to
// the foreground; paired with the build-id stamp in vite.config.ts that
// reliably surfaces new deploys within seconds of the user returning.
//
// PROD only. In dev the build-id stamp doesn't run (its plugin is apply:"build"),
// so the SW would cache /src/*.tsx under a never-changing name and serve stale
// chunks across dev server restarts. Self-heal below also tears down any SW a
// dev left behind from a prior prod visit.
//
// Never inside the native shell: the app bundle is local, so registration
// .update() can never see a new deploy, the controllerchange reload is
// meaningless, and WKWebView does not run service workers on its scheme.
// Updates reach the app as store releases.
if (import.meta.env.PROD && !isNativePlatform() && "serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.register("/sw.js").then((registration) => {
    // registration.update() ALWAYS goes to the network. A service worker script is
    // fetched with updateViaCache "imports" by default, so the worker script itself
    // bypasses the HTTP cache and NO Cache-Control header can suppress it. Firing it
    // on every visibilitychange therefore cost one uncacheable request per tab focus,
    // and a teacher switching between this tab and anything else focuses it dozens of
    // times a day. Five independent audit passes on 2026-09-21 each landed on 33-42
    // requests per user per day, making it the single largest source of origin traffic
    // on a day with no deploy.
    //
    // Throttled to once every 15 minutes. A returning user still picks up a new deploy
    // well inside a working session, which is all §17 needs, while a burst of forty tab
    // switches now costs one request instead of forty. The hourly interval below is
    // unaffected: 60 minutes is already past the gap.
    const MIN_UPDATE_GAP_MS = 15 * 60_000;
    // Seeded to now, not 0: register() has just fetched /sw.js, so the very first
    // focus must not immediately fetch it again.
    let lastUpdateCheck = Date.now();
    const checkForUpdate = () => {
      const now = Date.now();
      if (now - lastUpdateCheck < MIN_UPDATE_GAP_MS) return;
      lastUpdateCheck = now;
      registration.update().catch(() => {
        // Offline or transient network error — the next check will retry. The
        // timestamp is deliberately NOT rolled back: a device that is offline for an
        // hour should not retry on every single focus while it is down.
      });
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });

    setInterval(checkForUpdate, 60 * 60 * 1000);
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // First-ever install on this device: controller goes from null → SW.
    // That's not an "update", so don't reload the page the user just opened.
    if (!hadController) return;
    if (refreshing) return;
    refreshing = true;

    // Only auto-reload on safe pages — check for dirty forms
    const hasDirtyForm = document.querySelector('form[data-dirty="true"]');
    if (!hasDirtyForm) {
      window.location.reload();
    } else {
      // Show a soft toast instead (handled in App.tsx)
      window.dispatchEvent(new CustomEvent("salci-update-ready"));
    }
  });
} else if (import.meta.env.DEV && "serviceWorker" in navigator) {
  // Dev self-heal: a SW left behind from a prior prod visit (or an old dev
  // session before this guard existed) will intercept Vite's ESM module
  // requests and serve stale code. Unregister any worker and drop salci-*
  // caches so the next reload is clean.
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
  if (typeof caches !== "undefined") {
    caches.keys().then((keys) => {
      keys.filter((k) => k.startsWith("salci-")).forEach((k) => caches.delete(k));
    });
  }
}
