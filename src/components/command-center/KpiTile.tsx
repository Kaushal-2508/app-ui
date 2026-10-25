import * as React from "react";

import { cn } from "@/lib/utils";

export interface KpiTileProps {
  /** Tiny uppercase caption above the value. */
  eyebrow: string;
  /** Big bold headline number (already formatted, e.g. "92%" or "—"). */
  value: string;
  /** Plain-language interpretation sentence below the value. */
  sentence: string;
  /** When provided, the whole tile becomes a focusable button. */
  onClick?: () => void;
}

/**
 * Calm KPI card — NO gradient (CLAUDE.md §20b: the loud GradientKPICard is
 * deprecated). A frosted surface-card with an eyebrow caption, a large bold
 * value, and a muted interpretation sentence. When `onClick` is supplied the
 * entire tile renders as a focusable button.
 */
export function KpiTile({ eyebrow, value, sentence, onClick }: KpiTileProps) {
  const body = (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <p className="text-[34px] sm:text-[40px] font-bold text-ink-900 leading-tight">{value}</p>
      <p className="mt-1 text-sm text-ink-600">{sentence}</p>
    </>
  );

  const base = "surface-card frosted-shadow rounded-card p-4";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          base,
          "block w-full text-left transition-shadow hover:frosted-shadow-lg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
        )}
      >
        {body}
      </button>
    );
  }

  return <div className={base}>{body}</div>;
}
