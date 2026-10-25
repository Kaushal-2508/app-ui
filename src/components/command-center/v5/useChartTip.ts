import * as React from "react";

/**
 * State and positioning for the chart tooltip in ChartTip.tsx.
 *
 * Split out because a file that exports a hook alongside components loses Fast
 * Refresh, the same reason useScopeFilter lives on its own.
 */

export interface ChartTipState {
  x: number;
  y: number;
  /** True when the anchor is near the top and the panel has to sit below it. */
  below: boolean;
  body: React.ReactNode;
}

export function useChartTip(vbW: number, vbH: number) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [tip, setTip] = React.useState<ChartTipState | null>(null);

  const show = React.useCallback(
    (x: number, y: number, body: React.ReactNode) => {
      const svg = svgRef.current;
      const wrap = wrapRef.current;
      if (!svg || !wrap) return;
      const s = svg.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      if (!s.width || !w.width) return;
      const px = s.left - w.left + (x / vbW) * s.width;
      const py = s.top - w.top + (y / vbH) * s.height;
      // Half the panel's widest allowed size, so the clamp below actually
      // keeps it inside. It used to assume 92 (a 184px panel) while the panel
      // may be 260 wide, which let the right-hand edge squeeze it.
      const half = Math.min(130, w.width / 2);
      setTip({
        // Clamped so a point at either edge does not push the panel off the card.
        x: Math.max(half, Math.min(w.width - half, px)),
        y: py,
        below: py < 96,
        body,
      });
    },
    [vbW, vbH],
  );

  const hide = React.useCallback(() => setTip(null), []);

  return { wrapRef, svgRef, tip, show, hide };
}
