import * as React from "react";

import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

export interface StatCellProps {
  label: string;
  value: React.ReactNode;
  /** Target size h-5 w-5: it sits in a 40px disc. */
  icon: React.ReactNode;
  tone?: Tone;
  /**
   * `strip` (default) is one cell of a KPI strip: a flat cell that shares one
   * card with its neighbours, hairlines between them. `raised` is a tile of
   * its own with card lift and a hover rise, for a row of separate counters.
   */
  variant?: "strip" | "raised";
  className?: string;
}

/**
 * The compact sibling of StatTile: disc on the left, eyebrow + value on the
 * right, so a row of them shares one baseline and stays about 72px tall where
 * StatTile stacks to twice that. Lives here so pages stop redefining it.
 */
export function StatCell({ label, value, icon, tone = "teal", variant = "strip", className }: StatCellProps) {
  const t = TONES[tone];
  const raised = variant === "raised";
  return (
    <div
      className={cn(
        raised
          ? cn(
              // Stacked on a phone (disc above the figure) so the disc stays
              // visible in a half-width tile; side by side from sm.
              "surface-card frosted-shadow-lg flex flex-col items-start gap-3 px-4 py-4 sm:flex-row sm:items-center md:px-5",
              "relative overflow-hidden transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-hero",
              "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white/70 dark:before:bg-white/10",
            )
          : "flex items-center gap-3 bg-surface-card px-4 py-3.5 md:px-5",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center",
          raised
            ? "relative h-9 w-9 overflow-hidden rounded-xl shadow-card-sm ring-1 ring-inset ring-white/60 dark:ring-white/10 sm:h-11 sm:w-11 sm:rounded-2xl"
            : "h-10 w-10 rounded-lg",
          t.bg,
          t.fg,
        )}
      >
        {raised && (
          <span
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/60 to-transparent dark:from-white/10"
            aria-hidden
          />
        )}
        <span className="relative">{icon}</span>
      </span>
      <div className="min-w-0">
        <p className="eyebrow truncate">{label}</p>
        <p
          className={cn(
            "font-semibold leading-7 tabular-nums text-ink-900",
            raised ? "text-[24px]" : "text-[22px]",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
