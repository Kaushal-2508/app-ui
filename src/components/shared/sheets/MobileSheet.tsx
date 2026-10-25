import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MobileSheetAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export interface MobileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  primaryAction?: MobileSheetAction;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  children: React.ReactNode;
  className?: string;
  /**
   * Where the panel sits.
   *
   * "bottom" (default) is the thumb-reachable sheet that slides up — right for
   * a form the user is filling in, and what every existing consumer gets.
   *
   * "center" is a centred modal that zooms in. Use it for content the user
   * READS rather than fills in, where a bottom sheet buries the opening lines
   * at the bottom of the screen. Drops the grab handle, since a centred panel
   * is not draggable.
   *
   * "right" is a full-height drawer that slides in from the trailing edge. Use
   * it for a DETAIL panel opened from a row or a chart, where the thing behind
   * it stays on screen and keeps its place: the reader is drilling into one row
   * of a table, not leaving the table. It fills the screen on a phone and caps
   * at 580px from sm up, and like "center" it drops the grab handle.
   */
  placement?: "bottom" | "center" | "right";
  /**
   * How wide the bottom sheet may grow on sm+ screens.
   *
   * "full" (default) keeps the edge-to-edge sheet every existing consumer
   * gets. "md" / "lg" float a centred panel (max-w-2xl / max-w-3xl) a little
   * off the bottom edge, so a form does not stretch its inputs across a
   * 1,900px monitor. Constrained panels also take the `--surface-card` token
   * instead of the legacy literal white, so they flip in dark mode; opt in
   * only when the sheet's children are theme-safe. Ignored for "center".
   */
  desktopWidth?: "full" | "md" | "lg";
  /**
   * Merged onto the scrollable body. A child that manages its own scrolling
   * (a chat thread with a pinned composer) passes `flex flex-col p-0
   * overflow-y-hidden` so the body becomes a plain flex column it can fill.
   */
  bodyClassName?: string;
}

/**
 * Bottom sheet for forms, multi-field flows, and detail views on mobile.
 * Built on shadcn Sheet (NOT Dialog) — the project's DialogContent fork
 * auto-wraps children in ScrollArea, which we don't want here because the
 * sheet manages its own scrollable body.
 *
 * Three regions: sticky header, scrollable body, sticky footer.
 * Includes safe-area inset bottom padding on the footer so the primary
 * action stays above the iOS home indicator.
 */
export function MobileSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  icon,
  primaryAction,
  secondaryAction,
  children,
  className,
  placement = "bottom",
  desktopWidth = "full",
  bodyClassName,
}: MobileSheetProps) {
  const isCentered = placement === "center";
  const isRight = placement === "right";
  const isConstrained = !isCentered && !isRight && desktopWidth !== "full";
  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <SheetPrimitive.Content
          className={cn(
            "fixed z-50 border-surface-stroke shadow-lg",
            "transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
            "p-0 flex flex-col",
            // The bottom sheet keeps its literal bg-white. It does not flip in
            // dark mode, which is a real bug — but it is a PRE-EXISTING one
            // shared by 20+ consumers whose children may assume a light
            // background, so fixing it belongs in its own pass rather than
            // riding along with a placement prop. New centred panels get the
            // token and behave correctly in both themes.
            isCentered || isRight || isConstrained ? "bg-surface-card" : "bg-white",
            // Constrained bottom sheet: still flush and full-width on phones,
            // but from sm up it floats as a centred, rounded panel. Centring
            // uses inset-x-0 + mx-auto + max-w rather than a translate, so it
            // cannot fight Radix's slide animation transform.
            isConstrained && [
              "overflow-hidden",
              "sm:bottom-4 sm:mx-auto sm:w-[calc(100%-2rem)] sm:rounded-3xl sm:border sm:max-h-[88dvh]",
              desktopWidth === "md" ? "sm:max-w-2xl" : "sm:max-w-3xl",
            ],
            isRight
              ? [
                  // Full height against the trailing edge. max-h is deliberately
                  // absent: the panel IS the viewport height and its body
                  // scrolls, which is what keeps the header and the actions row
                  // pinned while a long roster scrolls between them.
                  "inset-y-0 right-0 h-full w-full border-l sm:max-w-[580px]",
                  "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
                ]
              : isCentered
              ? [
                  // Centred on both axes. The translate has to be part of the
                  // class list rather than a wrapper, or Radix's own animation
                  // transform fights it and the panel drifts off-centre.
                  "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
                  "w-[calc(100%-2rem)] max-w-lg max-h-[85dvh] rounded-3xl border",
                  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                ]
              : [
                  "inset-x-0 bottom-0 border-t max-h-[90dvh] rounded-t-3xl",
                  "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                ],
            className,
          )}
        >
          {/* Grab handle — only the draggable bottom sheet gets one. */}
          {!isCentered && !isRight && (
            <div className="flex justify-center pt-3 pb-1">
              <span className="block h-1 w-10 rounded-full bg-ink-400/30" />
            </div>
          )}

          {/* Sticky header.
              The bottom sheet takes its top breathing room from the grab
              handle rendered above it (pt-3 pb-1). A centred panel renders no
              handle, so without an explicit pt here the icon, title and close
              button sit flush against the panel's top edge. */}
          <div
            className={cn(
              "flex items-start gap-3 px-5 pb-3 border-b border-surface-stroke",
              isCentered && "pt-5",
              // The right drawer fills the screen edge to edge, so in the app
              // its header starts under the status bar: add the top inset
              // (0 in a browser) or the clock sits on the title (2026-09-18).
              isRight && "pt-[calc(1.25rem_+_env(safe-area-inset-top,0px))]",
            )}
          >
            {icon && (
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                {icon}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-ink-900">{title}</h2>
              {subtitle && <p className="text-sm text-ink-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              // Radix focuses the first focusable on open, which is this
              // button; the browser's default ring read as an orange warning
              // on every sheet (2026-09-18 audit). Brand ring, keyboard only.
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable body */}
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 [scroll-padding-bottom:100px]",
              bodyClassName,
            )}
          >
            {children}
          </div>

          {/* Sticky footer */}
          {(primaryAction || secondaryAction) && (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end px-5 pt-4 border-t border-surface-stroke pb-[max(env(safe-area-inset-bottom),16px)]">
              {secondaryAction && (
                <Button
                  variant="ghost"
                  onClick={secondaryAction.onClick}
                  disabled={secondaryAction.disabled}
                  className="w-full sm:w-auto"
                >
                  {secondaryAction.label}
                </Button>
              )}
              {primaryAction && (
                <Button
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled || primaryAction.loading}
                  className="w-full sm:w-auto bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
                >
                  {primaryAction.loading ? "Working…" : primaryAction.label}
                </Button>
              )}
            </div>
          )}
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}
