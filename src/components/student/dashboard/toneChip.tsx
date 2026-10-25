import * as React from "react";

import type { Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

/**
 * Tone → chip classes for the small plain-language labels emitted by the
 * label engine (src/lib/performanceLabels.ts). Kept local to the student
 * dashboard so the engine's `tone` field maps to a consistent, dark-mode-safe
 * pill everywhere on this surface.
 *
 *   mint  = positive (green)   · sky  = neutral
 *   peach = focus area (warm)  · rose = warning (red)
 */
const CHIP_CLASSES: Record<Tone, string> = {
  teal: "bg-brand-primary/10 text-brand-primary",
  violet: "bg-brand-secondary/10 text-brand-secondary",
  peach: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  mint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

export function ToneChip({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-tight",
        CHIP_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The plain label-engine line shown beneath a chart, tinted by its tone. */
export function ToneLine({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const textClass: Record<Tone, string> = {
    teal: "text-brand-primary",
    violet: "text-brand-secondary",
    peach: "text-amber-600 dark:text-amber-400",
    mint: "text-emerald-600 dark:text-emerald-400",
    sky: "text-ink-600",
    rose: "text-rose-600 dark:text-rose-400",
  };
  return (
    <p className={cn("text-[13px] font-medium leading-snug", textClass[tone], className)}>
      {children}
    </p>
  );
}
