import type { ReactNode } from "react";

import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

/** One fact about the PTM: tinted icon disc, eyebrow label, the value, and
 *  an optional line of detail. Four of these replace the old stack of
 *  label-over-value rows (Naman, 2026-09-29: "fix the ui where details of
 *  the ptm is written"). Shared by the in-person and online overviews. */
export function Fact({
  icon,
  tone,
  label,
  children,
  note,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  children: ReactNode;
  note?: string;
}) {
  const t = TONES[tone];
  return (
    <div className="flex gap-3 rounded-xl border border-border p-3">
      <span
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&_svg]:h-4 [&_svg]:w-4",
          t.bg,
          t.fg,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 space-y-1">
        <dt className="eyebrow">{label}</dt>
        <dd className="text-sm font-medium text-ink-900">{children}</dd>
        {note && <dd className="text-xs text-ink-500">{note}</dd>}
      </div>
    </div>
  );
}
