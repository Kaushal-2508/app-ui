import * as React from "react";

import { cn } from "@/lib/utils";

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Merged onto the inner max-width wrapper, for pages that need the content
   * column itself to participate in a layout (e.g. a board that fills the
   * viewport needs `flex` + `min-h-0` here so its height chain is unbroken).
   */
  contentClassName?: string;
  /**
   * Slot for a single MobileFab. The FAB is rendered as a fixed-position child
   * of the shell so it always appears in the same place regardless of the page's
   * own scroll context. Pages that don't need a FAB simply omit this prop.
   */
  fab?: React.ReactNode;
}

/**
 * Tracks whether we're already inside a PageShell. When a tab-host page (e.g.
 * ManageUsersPage) wraps itself in a PageShell and renders sub-pages that ALSO
 * each wrap themselves in a PageShell (e.g. ManageAdminsPage at /admins is also
 * mounted as a tab here), the inner PageShells used to double the page padding
 * and the inner heading/icon ended up offset to the right of the host's header
 * and tab strip. The nested instance now reads this context and renders its
 * children as a fragment instead.
 */
const PageShellNestedContext = React.createContext(false);

/** True inside a PageShell that is itself mounted inside another PageShell
 *  (a tab sub-page). PageHeader reads it to collapse its title block. */
export function usePageShellNested(): boolean {
  return React.useContext(PageShellNestedContext);
}

/**
 * Wrapper around every authenticated page. Paints the universal gradient backdrop,
 * locks horizontal scroll at the root, and reserves a fixed slot for MobileFab.
 *
 * Existing top app bars (hamburger / search / bell / avatar) continue to live
 * outside the shell — PageShell is the content-area wrapper, not an app-shell.
 */
export function PageShell({ children, className, contentClassName, fab }: PageShellProps) {
  const isNested = React.useContext(PageShellNestedContext);

  if (isNested) {
    // Outer PageShell already paints the backdrop and applies the page padding.
    // Re-applying both would double-pad the content, which is what made tab
    // sub-pages render to the right of the host header. Just pass children
    // (and any FAB) straight through.
    return (
      <>
        {children}
        {fab}
      </>
    );
  }

  return (
    <PageShellNestedContext.Provider value={true}>
      <div
        className={cn(
          // AppLayout's <main> pads every page (p-3 / sm:p-4 / md:p-6). Pages
          // that do not use PageShell still want that gutter, so the shell
          // cancels it with matching negative margins and the gradient runs
          // edge to edge: flush with the sidebar and the app bar, no grey
          // frame around the backdrop (asked for 2026-09-14). Content keeps
          // its own gutter through the inner wrapper's padding below.
          // overflow-x-CLIP, not hidden. `hidden` on one axis computes the
          // other to `auto`, which silently makes this a scroll container and
          // kills position:sticky for every descendant: a pinned element sticks
          // to a scrollport that never scrolls, so it just rides away with the
          // content. AppLayout already hit this and fixed its column the same
          // way ("column uses overflow-x-clip (NOT hidden) so it doesn't become
          // a scroll container for sticky purposes"); the shell had been left
          // behind. `clip` still locks horizontal scroll, which is all this was
          // ever for.
          // native-safe-x: inside the native shell in landscape the notch is
          // on a side, so index.css pads the shell by the side insets (0 in
          // a browser and in portrait). Padding, not margin, so the gradient
          // still runs under the notch.
          "relative overflow-x-clip surface-gradient native-safe-x",
          "-m-3 sm:-m-4 md:-m-6",
          // The floor is the viewport MINUS the app bar. With the margins
          // above there is no main padding left to subtract; a taller floor
          // would guarantee every page a scrollbar and an empty band of
          // gradient under its content.
          "min-h-[calc(100dvh-var(--app-bar-height,61px))]",
          "pb-[max(env(safe-area-inset-bottom),16px)]",
          className,
        )}
      >
        {/* Content gutter. The shell now bleeds into <main>'s padding (see
            above), so the top gap the page used to inherit from <main> is
            restored here: without it the title sat hard against the app bar
            on a phone. Side padding widens with the viewport so the gradient
            gets room to breathe on lg+. */}
        <div
          className={cn(
            // native-page-content: inert on the web; inside the native shell
            // index.css trims the top padding so the title sits closer to
            // the app bar.
            "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10 xl:px-14 pt-4 sm:pt-5 lg:pt-8 native-page-content",
            contentClassName,
          )}
        >
          {children}
        </div>
        {fab}
      </div>
    </PageShellNestedContext.Provider>
  );
}
