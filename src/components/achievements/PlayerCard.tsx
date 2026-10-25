import { Skeleton } from "@/components/ui/skeleton";

import { HeroCard } from "./HeroCard";
import type { ShieldTier } from "./types";

/**
 * Points floor for each rank. Mirrors badge_rank_for_points() in
 * 20260813180000_achievements_read_api.sql, which is the server-side source of
 * truth. Only the FLOOR lives here: the ceiling arrives as `nextRankAt` from
 * that same RPC, so the two can never disagree about where a rank ends.
 */
const RANK_FLOOR: Record<ShieldTier, number> = {
  bronze: 0,
  silver: 100,
  gold: 300,
  platinum: 600,
  diamond: 1000,
  legendary: 1000,
};

const RANK_LABEL: Record<ShieldTier, string> = {
  bronze: "Bronze Rank",
  silver: "Silver Rank",
  gold: "Gold Rank",
  platinum: "Platinum Rank",
  diamond: "Diamond Rank",
  legendary: "Legendary",
};

/** The ring geometry. r=52 in a 120 box leaves room for the 9px stroke. */
const R = 52;
const CIRCUMFERENCE = 2 * Math.PI * R;

export interface PlayerCardProps {
  name: string;
  /** e.g. "Class 12 Science - Non - Medical - A". Optional: not every student has one. */
  className_?: string | null;
  points: number;
  rank: ShieldTier;
  nextRankAt: number | null;
  streakDays: number;
  activeToday: boolean;
  badgesEarned: number;
  badgesAvailable: number;
  isLoading?: boolean;
}

/**
 * The page's single focal point: rank, progress to the next rank, and the four
 * supporting figures, all in one object.
 *
 * This replaces four separately-coloured stat cards plus a dark "Level Progress"
 * slab that repeated the same points total a second time. One card, one number
 * that matters, three that support it.
 */
export function PlayerCard({
  name,
  className_,
  points,
  rank,
  nextRankAt,
  streakDays,
  activeToday,
  badgesEarned,
  badgesAvailable,
  isLoading,
}: PlayerCardProps) {
  if (isLoading) {
    return <Skeleton className="h-[232px] w-full rounded-card" />;
  }

  const floor = RANK_FLOOR[rank] ?? 0;
  const span = nextRankAt !== null ? Math.max(1, nextRankAt - floor) : 1;
  const fraction = nextRankAt === null ? 1 : Math.min(1, Math.max(0, (points - floor) / span));
  const pct = Math.round(fraction * 100);
  const toGo = nextRankAt === null ? 0 : Math.max(0, nextRankAt - points);

  return (
    <HeroCard tone="teal" eyebrow={className_ ? `${name} · ${className_}` : name}>
      <div className="mt-3 flex flex-wrap items-center gap-5 sm:gap-7">
        <div className="relative h-[116px] w-[116px] shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
            <circle cx="60" cy="60" r={R} fill="none" stroke="hsl(0 0% 100% / 0.18)" strokeWidth="9" />
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke="hsl(var(--brand-accent))"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-[26px] font-bold leading-none tabular-nums">{pct}%</div>
              <div className="hero-eyebrow mt-1">
                {nextRankAt === null ? "Maxed" : "To next"}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-[190px] flex-1">
          <h2 className="text-[26px] font-bold leading-tight sm:text-[30px]">{RANK_LABEL[rank]}</h2>
          <p className="mt-1 text-sm tabular-nums text-white/80">
            {nextRankAt === null
              ? `${points} points`
              : `${points} of ${nextRankAt} points · ${toGo} to go`}
          </p>

          <dl className="mt-5 flex flex-wrap gap-x-7 gap-y-3">
            <Figure value={badgesEarned} label="Badges" />
            <Figure value={streakDays} label={streakDays === 1 ? "Day streak" : "Day streak"} />
            <Figure value={badgesAvailable} label="Available" />
            <div>
              <dd className="text-[17px] font-bold leading-none">{activeToday ? "Yes" : "Not yet"}</dd>
              <dt className="hero-eyebrow mt-1.5">Active today</dt>
            </div>
          </dl>
        </div>
      </div>
    </HeroCard>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dd className="text-[17px] font-bold leading-none tabular-nums">{value}</dd>
      <dt className="hero-eyebrow mt-1.5">{label}</dt>
    </div>
  );
}