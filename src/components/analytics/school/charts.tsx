import * as React from "react";

import { cn } from "@/lib/utils";

/** Chart components. Tokens and formatters live in ./chartTokens. */

/**
 * Recharts' ResponsiveContainer only computes a height inside a flex or grid
 * parent when its wrapper carries explicit inline dimensions. A Tailwind height
 * class collapses to zero on mobile and the bars silently stop rendering.
 */
export function ChartFrame({
  height,
  children,
  className,
}: {
  height: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)} style={{ width: "100%", height }}>
      {children}
    </div>
  );
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

export interface TooltipLine {
  label: string;
  value: string;
  strong?: boolean;
}

/**
 * One tooltip shape for every chart on the page. The value leads and the label
 * follows, because the reader already knows which mark they are pointing at.
 * Labels are rendered as text nodes by React, never as markup.
 */
export function ChartTooltipCard({
  title,
  subtitle,
  lines,
  hint,
}: {
  title: string;
  subtitle?: string;
  lines: TooltipLine[];
  hint?: string;
}) {
  return (
    <div className="pointer-events-none rounded-lg border border-surface-stroke bg-surface-card px-3 py-2 shadow-card">
      <p className="text-xs font-semibold text-ink-900">{title}</p>
      {subtitle && <p className="mt-0.5 text-[11px] text-ink-500">{subtitle}</p>}
      <div className="mt-1.5 flex flex-col gap-0.5">
        {lines.map((line) => (
          <p key={line.label} className="text-[11px] text-ink-600">
            <span
              className={cn(
                "tabular-nums",
                line.strong ? "font-semibold text-ink-900" : "font-medium text-ink-700",
              )}
            >
              {line.value}
            </span>{" "}
            {line.label}
          </p>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-ink-400">{hint}</p>}
    </div>
  );
}

// ── Table-view twin ──────────────────────────────────────────────────────────

/**
 * Every chart ships a table twin so no value is reachable only by hovering.
 * Collapsed by default; the toggle is a plain button so it is keyboard
 * reachable and announced.
 */
export function ChartTableToggle({
  open,
  onToggle,
  label = "values",
  /** Names WHICH chart this toggles, so three of them on one page do not all
   *  announce themselves as "Show values". */
  chartName,
}: {
  open: boolean;
  onToggle: () => void;
  label?: string;
  chartName: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${label} for ${chartName}`}
      className="-my-1 rounded-md px-1 py-1 text-xs font-medium text-ink-600 underline-offset-4 hover:text-ink-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
    >
      {open ? `Hide ${label}` : `Show ${label}`}
    </button>
  );
}

export function ChartTable({
  head,
  rows,
  caption,
  onRowClick,
  rowActionLabel,
}: {
  head: string[];
  rows: (string | number)[][];
  caption: string;
  /**
   * Makes the first cell of each row a button. Chart bars are clickable but not
   * focusable, so without this the drill-down the caption promises is reachable
   * by mouse only. The table view is the keyboard route to the same place.
   */
  onRowClick?: (rowIndex: number) => void;
  rowActionLabel?: (rowIndex: number) => string;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-surface-stroke">
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  "py-2 pr-3 font-medium text-ink-500",
                  i > 0 && "text-right tabular-nums",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Index keys: the list is static within a render and a first cell can
              repeat (two exams may share a title). */}
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-surface-stroke/60 last:border-0">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "py-2 pr-3 text-ink-700",
                    i === 0 ? "font-medium text-ink-900" : "text-right tabular-nums",
                  )}
                >
                  {i === 0 && onRowClick ? (
                    <button
                      type="button"
                      onClick={() => onRowClick(rowIndex)}
                      aria-label={rowActionLabel?.(rowIndex)}
                      className="rounded-md text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                    >
                      {cell}
                    </button>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
