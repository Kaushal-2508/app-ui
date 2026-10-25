import * as React from "react";

import type { Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { ClayPebble } from "./FeatureTile";

// Written out in full so Tailwind keeps every class (index.css, "Clay tiles").
const CLAY_TONE: Record<Tone, string> = {
  teal: "clay-tone-teal",
  violet: "clay-tone-violet",
  peach: "clay-tone-peach",
  mint: "clay-tone-mint",
  sky: "clay-tone-sky",
  rose: "clay-tone-rose",
};

export interface ClayStatTileProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: Tone;
  className?: string;
}

/**
 * A number in the dashboard's clay tile (Naman, 2026-10-07, for the Manage
 * Users tabs: "I want that style in here"): the icon in its puffy pebble, the
 * eyebrow label, the value. The pebble sits beside the text on a phone and
 * above it from sm up, so two or three of them fit one row without a tall
 * column. Same clay CSS as FeatureTile, no hover lift (it is not a link).
 */
export function ClayStatTile({ label, value, icon, tone = "teal", className }: ClayStatTileProps) {
  return (
    <div className={cn("clay-tile flex items-center gap-4 p-4 sm:flex-col sm:items-start sm:gap-0 sm:p-5", CLAY_TONE[tone], className)}>
      <ClayPebble tone={tone} className="sm:mb-4">
        {icon}
      </ClayPebble>
      <div className="min-w-0 space-y-1">
        <p className="eyebrow">{label}</p>
        <p className="text-[26px] font-bold leading-none text-ink-900 sm:text-[30px]">{value}</p>
      </div>
    </div>
  );
}
