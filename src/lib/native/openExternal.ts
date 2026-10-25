import { nativePlugin } from "./platform";

/**
 * Open a URL outside the app's own document: a signed storage file, a
 * receipt, the terms page, a magic link.
 *
 * Web: a new tab with no link back to this page (what `noopener` did at every
 * call site by hand).
 * Native: the `Browser` plugin, an in-app browser sheet (SFSafariViewController
 * / Chrome Custom Tabs). A plain `window.open` inside a WebView either does
 * nothing or navigates the app itself away with no way back.
 *
 * Returns false when the browser blocked the popup, so the caller can toast.
 */

type BrowserPlugin = { open(o: { url: string; presentationStyle?: "fullscreen" | "popover" }): Promise<void> };

export function openExternal(url: string): boolean {
  if (typeof window === "undefined") return false;

  const browser = nativePlugin<BrowserPlugin>("Browser");
  if (browser) {
    void browser.open({ url }).catch(() => {
      // Fall back to a plain navigation attempt if the sheet cannot open.
      window.open(url, "_blank", "noopener,noreferrer");
    });
    return true;
  }

  // `window.open(url, "_blank", "noopener")` returns null by spec even when
  // the tab opens, so it cannot tell a blocked popup from an opened one.
  // Open a blank tab, cut its link back to this page, then send it on.
  const win = window.open("about:blank", "_blank");
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    // Already detached: nothing to cut.
  }
  win.location.href = url;
  return true;
}
