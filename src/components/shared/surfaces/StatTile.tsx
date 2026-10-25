import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  delta?: { value: string; direction: "up" | "down" };
  className?: string;
  /** Makes the tile an interactive button (e.g. KPI tiles that deep-link
   *  into a filtered list). Opt-in — plain tiles render as before. */
  onClick?: () => void;
}

export function StatTile({ label, value, icon, tone = "teal", delta, className, onClick }: StatTileProps) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        // stat-tile / stat-tile-icon / stat-tile-value are hooks for the
        // native shell's compact row layout in index.css; inert on the web.
        "surface-card frosted-shadow p-5 flex flex-col gap-4 stat-tile",
        onClick &&
          "cursor-pointer transition-[box-shadow,transform] duration-200 hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
        className,
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {icon && (
        <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-2xl stat-tile-icon", t.bg, t.fg)}>
          {icon}
        </span>
      )}
      {/* Phase 9 hierarchy: eyebrow caption above, big bold value below.
          Matches CoachPro tiles (Possession 65%, Overall Price $690.2m, …). */}
      <div className="min-w-0 space-y-1">
        <p className="eyebrow truncate">{label}</p>
        <p className="text-[30px] leading-[36px] font-semibold tabular-nums text-ink-900 stat-tile-value">{value}</p>
      </div>
      {delta && (
        <div
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
            delta.direction === "up" ? "text-emerald-600" : "text-rose-600",
          )}
        >
          {delta.direction === "up" ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5" />
          )}
          {delta.value}
        </div>
      )}
    </div>
  );
}

export interface StatTileGridProps {
  /** Mobile column count (default 2). 1 valid for narrow stacks; 3 keeps the
   *  base 2-col grid (renders as grid-cols-2) and relies on mdCols for the
   *  wider layout. */
  cols?: 1 | 2 | 3;
  /** Desktop column count at md+ (default 3). */
  mdCols?: 2 | 3 | 4;
  /** Wide-desktop column count at lg+ (default = mdCols). */
  lgCols?: 2 | 3 | 4 | 5 | 6;
  children: React.ReactNode;
  className?: string;
}

export function StatTileGrid({
  cols = 2,
  mdCols = 3,
  lgCols,
  children,
  className,
}: StatTileGridProps) {
  return (
    <div
      className={cn(
        // stat-tile-grid: hook for the native shell (index.css), which lets an
        // odd last tile span the row instead of leaving an orphan cell.
        "grid gap-3 sm:gap-4 stat-tile-grid",
        cols === 1 ? "grid-cols-1" : "grid-cols-2",
        mdCols === 2 ? "md:grid-cols-2" : mdCols === 3 ? "md:grid-cols-3" : "md:grid-cols-4",
        // lgCols undefined: no lg:* class emitted, mdCols cascades up.
        lgCols === 2 && "lg:grid-cols-2",
        lgCols === 3 && "lg:grid-cols-3",
        lgCols === 4 && "lg:grid-cols-4",
        lgCols === 5 && "lg:grid-cols-5",
        lgCols === 6 && "lg:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
