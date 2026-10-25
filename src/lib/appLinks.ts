import { getAppUrl } from "@/lib/appUrl";

/**
 * Links that open a SALCI screen from outside: today only the PTM feedback QR.
 * The one list serves three readers:
 *
 * - The Android app claims these paths on the public site. Its intent filter
 *   (AndroidManifest.xml in the shell project, ~/salci-app-shell, see
 *   docs/mobile/README.md) must list the same paths, and the site must serve
 *   public/.well-known/assetlinks.json for Android to trust the claim.
 * - NativeBootstrap opens a link the phone hands the app only if it passes
 *   `appLinkPath`, because any app on the phone can send the app a link, not
 *   only the camera.
 * - The guided tour never auto-starts on these pages, so a family who scans
 *   the QR lands on the form with nothing over it.
 */
const APP_LINK_ROUTES: readonly RegExp[] = [
  // PTM family feedback: /ptm/feedback/<token> (32 hex characters) and
  // /ptm/feedback/active. The character class is wider than hex on purpose,
  // so a future token format keeps opening the app.
  /^\/ptm\/feedback\/[A-Za-z0-9_-]{1,128}$/,
];

/** True for a page people reach from a link outside SALCI (the feedback QR). */
export function isAppLinkRoute(pathname: string): boolean {
  return APP_LINK_ROUTES.some((route) => route.test(pathname));
}

/**
 * The in-app route for a link the phone opened, or null to ignore it. Only an
 * https link on the public site this build is for (VITE_PUBLIC_URL, see
 * src/lib/appUrl.ts) and only a listed route: anything else, including plain
 * http, another host, or a route not listed, is refused. The query and hash
 * are dropped; no listed route reads them.
 */
export function appLinkPath(link: string, publicUrl: string = getAppUrl()): string | null {
  let url: URL;
  let site: URL;
  try {
    url = new URL(link);
    site = new URL(publicUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.host !== site.host) return null;
  return isAppLinkRoute(url.pathname) ? url.pathname : null;
}
