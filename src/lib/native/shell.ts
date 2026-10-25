import { nativePlatform, nativePlugin, removeListener, type ListenerHandleLike } from "./platform";

/**
 * The shell's own chrome: splash, status bar, Android back button. Web: every
 * function here is a no-op. Called only from NativeBootstrap.
 */

type SplashScreenPlugin = { hide(o?: { fadeOutDuration?: number }): Promise<void> };
type StatusBarPlugin = {
  setStyle(o: { style: "DARK" | "LIGHT" | "DEFAULT" }): Promise<void>;
  setBackgroundColor?(o: { color: string }): Promise<void>;
};
type AppPlugin = {
  exitApp(): Promise<void>;
  addListener(event: "backButton", cb: (s: { canGoBack: boolean }) => void): ListenerHandleLike;
};

// The app bar's surface in each theme so the Android status bar reads as part
// of the bar instead of a black strip. Light: the pale teal the app paints the
// bar (src/index.css, `.native-shell:not(.dark) .app-bar-frost`, hsl(184 45%
// 89%)). Dark: the card surface (--surface-card).
const STATUS_BAR_BG = { light: "#d7eff0", dark: "#202532" };

/**
 * The viewport flags a native app needs, added at boot because they belong
 * in index.html's viewport meta, a root file this branch may not edit; WebKit
 * and Chromium honour a changed viewport meta immediately. No-op in a browser.
 *
 * - `viewport-fit=cover` makes `env(safe-area-inset-*)` non-zero on iOS.
 *   Without it the app bar and the login title sat under the status bar on
 *   every iPhone (2026-09-17).
 * - `maximum-scale=1, user-scalable=no` locks the page scale, as Capacitor's
 *   own template does. A native app does not pinch-zoom, and without the lock
 *   WebKit zooms the whole page in when an input smaller than 16px is focused,
 *   which the app's compact type scale (index.css) would otherwise trigger on
 *   every field.
 */
export function ensureViewportFitCover(): void {
  if (!nativePlatform() || typeof document === "undefined") return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const parts: string[] = [];
  if (!/viewport-fit=/.test(meta.content)) parts.push("viewport-fit=cover");
  if (!/maximum-scale=/.test(meta.content)) parts.push("maximum-scale=1.0");
  if (!/user-scalable=/.test(meta.content)) parts.push("user-scalable=no");
  if (parts.length > 0) {
    meta.content = `${meta.content}, ${parts.join(", ")}`;
  }
}

/**
 * Marks <html> with `native-shell` so index.css can adapt chrome that behaves
 * badly in a WebView: frosted (backdrop-filter) pinned bars shimmer on every
 * scroll frame in WKWebView, and mandatory scroll-snap rows re-snap while the
 * page moves under them. Both read as "the text vibrates" (2026-09-17).
 */
export function markNativeShell(): void {
  if (!nativePlatform() || typeof document === "undefined") return;
  document.documentElement.classList.add("native-shell");
}

export function hideSplash(): void {
  void nativePlugin<SplashScreenPlugin>("SplashScreen")?.hide({ fadeOutDuration: 200 }).catch(() => {});
}

/**
 * Status bar text and (Android) background follow the app bar: dark text on
 * the pale day bar, light text on the dark night bar ("DARK" is Capacitor's
 * name for the light-on-dark style). Android also paints the bar itself.
 */
export function applyStatusBarTheme(isDark: boolean): void {
  const bar = nativePlugin<StatusBarPlugin>("StatusBar");
  if (!bar) return;
  void bar.setStyle({ style: isDark ? "DARK" : "LIGHT" }).catch(() => {});
  if (nativePlatform() === "android") {
    void bar.setBackgroundColor?.({ color: isDark ? STATUS_BAR_BG.dark : STATUS_BAR_BG.light }).catch(() => {});
  }
}

/**
 * Android hardware/gesture back. `onBack` returns true when it consumed the
 * press (navigated back, closed a sheet); false means "nothing to go back
 * to", and the app exits like a native one would from its home screen.
 */
export function onAndroidBack(onBack: () => boolean): () => void {
  const app = nativePlugin<AppPlugin>("App");
  if (!app || nativePlatform() !== "android") return () => {};
  const handle = app.addListener("backButton", () => {
    if (!onBack()) void app.exitApp();
  });
  return () => removeListener(handle);
}
