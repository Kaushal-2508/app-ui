import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Resets the scroll position on route changes.
 *
 * React Router does NOT reset scroll on navigation, so following a link from
 * halfway down a page (e.g. a subject in the dashboard's Subject snapshot) left
 * the next page opened at the previous page's scroll offset — the destination
 * appeared to start somewhere in its middle. It went unnoticed for a long time
 * because sidebar navigation usually happens from the top of a page already.
 *
 * The viewport is the scroll container for the whole app (AppLayout deliberately
 * keeps scrolling on the window so the header's `sticky` works), so scrolling the
 * window is the correct target.
 *
 * Two deliberate exemptions:
 *  - POP (browser back/forward) is left alone; forcing the top on "back" throws
 *    the user away from where they were reading.
 *  - A `#hash` is left alone so in-page anchors still land on their target.
 *
 * Keyed on pathname only — re-running on `search` would yank the page to the top
 * every time a filter writes a query param.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === "POP" || hash) return;
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname, hash, navigationType]);

  return null;
}
