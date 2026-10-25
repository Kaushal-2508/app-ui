import * as React from "react";

import { cn } from "@/lib/utils";

import type { ChartTipState } from "./useChartTip";

/**
 * The positioned chart tooltip from
 * public/report_reference/salci-admin-dashboard-v5.html (`.tip`, line 460).
 *
 * Every chart on this page used a native SVG `<title>` instead, which gives one
 * line of plain text, appears after a browser delay of its own choosing, and on
 * a touch screen never appears at all. The reference's charts answer four or
 * five things per point, which is the difference between a dot you can hover
 * and a dot you can act on.
 *
 * Positioning converts viewBox units to pixels through the rendered rect, so it
 * stays correct at any width without the chart knowing what width it is.
 */

/** The panel itself. Render it as the last child of the wrapper. */
export function ChartTip({ tip }: { tip: ChartTipState | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // w-max, because an absolutely positioned box shrink-to-fits against
        // the distance to its containing block's right edge: near the end of a
        // chart the panel was squeezed to ~170px and every line wrapped.
        "pointer-events-none absolute z-20 w-max max-w-[min(260px,100%)] rounded-[10px] border border-surface-stroke",
        "bg-surface-card px-3 py-2 text-[11.5px] leading-[1.5] text-ink-600 shadow-lg",
        "transition-opacity duration-100",
        tip ? "opacity-100" : "opacity-0",
      )}
      style={
        tip
          ? {
              left: tip.x,
              top: tip.y,
              transform: tip.below
                ? "translate(-50%, 14px)"
                : "translate(-50%, calc(-100% - 14px))",
            }
          : { left: -9999, top: -9999 }
      }
    >
      {tip?.body}
    </div>
  );
}

/* --------------------------------------------------------------- pieces --- */

/** The bold first line of a tip. */
export function TipTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] font-bold text-ink-900">{children}</div>;
}

/** A detail line. `dim` is for the "click to open" hint the reference ends on. */
export function TipLine({
  children, dim,
}: { children: React.ReactNode; dim?: boolean }) {
  return <div className={cn("mt-0.5", dim && "text-ink-400")}>{children}</div>;
}

/**
 * A transparent hit area. SVG hit-testing only fires on painted pixels, so a
 * 5px dot or a 30px bar needs something bigger and invisible behind it, and
 * `fill="transparent"` paints while `fill="none"` does not.
 */
export function TipHit({
  onShow, onHide, onClick, ...rest
}: React.SVGProps<SVGRectElement> & { onShow: () => void; onHide: () => void }) {
  return (
    <rect
      {...rest}
      fill="transparent"
      className={onClick ? "cursor-pointer" : undefined}
      onPointerEnter={onShow}
      onPointerMove={onShow}
      onPointerLeave={onHide}
      // Touch has no hover: a tap shows the tip, and the click still fires.
      onPointerDown={onShow}
      onClick={onClick}
    />
  );
}
