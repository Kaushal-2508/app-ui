import * as React from "react";
import { CalendarCheck2, CheckCircle2, Gem, History, Lock, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { BadgeShield } from "./BadgeShield";
import { BAR_FILL, TIER_LABEL, rarityChipClass, tierTextClass } from "./tierStyles";
import { DEFAULT_TIME_ZONE } from "./toBadgeDisplay";
import {
  cumulativePercent,
  displayProgressLabel,
  type BadgeDisplay,
  type ShieldTier,
} from "./types";

/**
 * `earned_at` is a timestamptz and the evaluator awards on institution-local
 * dates (§24), so rendering in the device zone put a 00:30 IST award on the
 * previous day for anyone travelling, disagreeing with the streak day that
 * earned it. Locale is pinned too so an en-US device does not show "Aug 13,
 * 2026" while the rest of the portal shows "13 Aug 2026".
 */
function formatEarnedDate(value: string, timeZone: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
}

export interface BadgeTileProps {
  name: string;
  description?: string | null;
  /** `badge_definitions.icon_name`. */
  iconName: string;
  tier: ShieldTier;
  points: number;
  /**
   * Held at any point in time. Drives the shield colour: a badge won in July is
   * still the student's trophy in August.
   */
  earned: boolean;
  /**
   * Held for the period that matters right now. Drives the status chip and the
   * "last won" line. Defaults to `earned`, which is correct for every one-shot
   * badge; pass it explicitly for Player of the Month, the one re-earnable
   * badge in the catalog, or the tile says "Earned 31 Jul" while the bar
   * simultaneously reads "4 of 15 active days".
   */
  earnedForCurrentPeriod?: boolean;
  /** Most recent award timestamp. */
  earnedAt?: string | null;
  /**
   * Discriminated union: the shape of `display` decides the readout, so a
   * threshold badge can never be handed a progress bar and an aggregate badge
   * can never be handed a raw count.
   *   cumulative -> progress bar, "7 of 15 days"
   *   threshold  -> no bar, "Best so far 74%, need 90%"
   *   event      -> no bar, "Return within 48 hours of breaking a streak"
   *   rarity     -> scarcity chip, "Earned by 4% of students"
   */
  display: BadgeDisplay;
  /** Re-earnable badges (Player of the Month): how many periods have been won. */
  timesEarned?: number;
  /** IANA zone for `earnedAt`. Defaults to the institution default (§24). */
  timeZone?: string;
  /**
   * One short line under the status row, for what the badge counts toward
   * beyond its own points (the teacher surface: "Needed for the Gold Medal").
   * Structure only; the caller decides the words and the icon.
   */
  note?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

/**
 * One badge: shield, name, and exactly the readout its `display` kind allows.
 * Cards follow the house style (surface-card frosted-shadow rounded-card) and
 * work down to 375px, where the shield stays 60px and the text column flexes.
 */
export function BadgeTile({
  name,
  description,
  iconName,
  tier,
  points,
  earned,
  earnedForCurrentPeriod,
  earnedAt,
  display,
  timesEarned,
  timeZone = DEFAULT_TIME_ZONE,
  note,
  onClick,
  className,
}: BadgeTileProps) {
  const held = earnedForCurrentPeriod ?? earned;
  const isLegendary = tier === "legendary";
  const readout = displayProgressLabel(display, held);
  const tierText = tierTextClass(tier, earned);
  const earnedDate = earnedAt ? formatEarnedDate(earnedAt, timeZone) : "";

  const body = (
    <>
      <BadgeShield tier={tier} iconName={iconName} earned={earned} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-5 text-ink-900">{name}</p>
            <p
              className={cn(
                "mt-0.5 text-[11px] font-medium uppercase tracking-[0.06em]",
                tierText,
              )}
            >
              {TIER_LABEL[tier]}
            </p>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 rounded-full border-[hsl(var(--surface-stroke))] bg-brand-primary/5 px-2 py-0 text-[11px] font-semibold tabular-nums text-brand-primary"
          >
            {points} pts
          </Badge>
        </div>

        {description && (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-4 text-ink-500">{description}</p>
        )}

        <div className="mt-3 space-y-1.5">
          {display.kind === "cumulative" && (
            <>
              {/* Cumulative badges are the only kind that gets a bar. The percent
                  is derived from the narrowed CumulativeDisplay, so no other
                  branch can reach a Progress. */}
              <Progress
                value={cumulativePercent(display)}
                aria-label={`${name} progress`}
                className={cn("h-1.5 bg-ink-400/15", BAR_FILL[tier])}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium tabular-nums text-ink-700">{readout}</span>
                <span className="text-[11px] tabular-nums text-ink-500">
                  {cumulativePercent(display)}%
                </span>
              </div>
              {display.periodLabel && (
                <p className="flex items-center gap-1 text-[11px] text-ink-500">
                  <CalendarCheck2 className="h-3 w-3 shrink-0" />
                  {display.periodLabel}
                </p>
              )}
            </>
          )}

          {display.kind === "threshold" && (
            /* Deliberately bar-free: one 89% exam is not "89% of an Ace". */
            <p className="text-[12px] font-medium tabular-nums text-ink-700">{readout}</p>
          )}

          {display.kind === "event" && (
            /* One-shot events have no run-up, so they show the trigger instead. */
            <p className="flex items-start gap-1 text-[12px] font-medium leading-4 text-ink-700">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand-accent" />
              <span>{readout}</span>
            </p>
          )}

          {display.kind === "rarity" && (
            <div className="space-y-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  rarityChipClass(tier, earned),
                  tierText,
                )}
              >
                <Gem className="h-3 w-3 shrink-0" />
                {readout}
              </span>
              {display.detail && (
                <p className="text-[11px] leading-4 text-ink-500">{display.detail}</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {held ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {earnedDate ? `Earned ${earnedDate}` : "Earned"}
            </span>
          ) : earned ? (
            /* Re-earnable badge won in an earlier period. Saying "Not earned
               yet" beside a coloured shield would be a lie, so say which. */
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-600">
              <History className="h-3.5 w-3.5 shrink-0" />
              {earnedDate ? `Last won ${earnedDate}` : "Won before"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-500">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Not earned yet
            </span>
          )}
          {typeof timesEarned === "number" && timesEarned > 1 && (
            <span className="text-[11px] tabular-nums text-ink-500">Won {timesEarned} times</span>
          )}
        </div>

        {note && <div className="mt-1.5 text-[11px] font-medium leading-4 text-ink-600">{note}</div>}
      </div>
    </>
  );

  const cardClasses = cn(
    "surface-card frosted-shadow rounded-card",
    isLegendary && earned && "shadow-legendary border-[hsl(var(--tier-legendary-glow)/0.35)]",
    !earned && "opacity-95",
    onClick &&
      "cursor-pointer transition-[box-shadow,transform] duration-200 hover:shadow-card-lg active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
    className,
  );

  // A real <button> when clickable, matching the ListRow primitive: Enter and
  // Space activation, the focus ring and the disabled semantics all come free,
  // instead of a div with role="button" and a hand-rolled keydown handler.
  if (onClick) {
    return (
      <div className={cardClasses}>
        <button
          type="button"
          onClick={onClick}
          className="flex w-full gap-4 rounded-card p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
        >
          {body}
        </button>
      </div>
    );
  }

  return <div className={cn(cardClasses, "flex gap-4 p-4")}>{body}</div>;
}

/** Loading placeholder with the same footprint as a BadgeTile. */
export function BadgeTileSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("surface-card frosted-shadow rounded-card flex gap-4 p-4", className)}>
      <Skeleton className="h-[60px] w-[60px] shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-1.5 w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

/** Responsive grid for a category's tiles. One column at 375px. */
export function BadgeTileGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3", className)}>
      {children}
    </div>
  );
}
