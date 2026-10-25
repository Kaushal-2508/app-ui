import { Flame } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import type { StudentAchievements } from "@/hooks/useStudentAchievements";

import { BadgeShield } from "./BadgeShield";
import { HeroAction, HeroCard } from "./HeroCard";
import { PlayerCard } from "./PlayerCard";
import { pickClosestBadge, type NextBadgeCandidate, type NextBadgePick } from "./nextBadge";
import type { AchievementCategory } from "./types";

export interface AchievementsHeroProps {
  data: StudentAchievements | undefined;
  candidates: NextBadgeCandidate[];
  name: string;
  studentClass?: string | null;
  isLoading: boolean;
  onOpenCategory: (category: AchievementCategory) => void;
}

/**
 * The top of the Achievements page: one wide teal card carrying identity and
 * rank, then two narrower cards for momentum (orange) and the next goal
 * (violet).
 *
 * The asymmetry is the design. Teal is the main colour and gets the full first
 * row on its own; the other two share the second. Three equal cards would put
 * three saturated colours in a row competing for the eye, which is the failure
 * the old four-pastel-tile strip already demonstrated.
 */
export function AchievementsHero({
  data,
  candidates,
  name,
  studentClass,
  isLoading,
  onOpenCategory,
}: AchievementsHeroProps) {
  const streakDays = data?.streak?.current ?? 0;
  const activeToday = data?.streak?.active_today ?? false;
  const pick = pickClosestBadge(candidates);

  return (
    <div className="space-y-4 sm:space-y-5">
      <PlayerCard
        name={name}
        className_={studentClass}
        points={data?.points ?? 0}
        rank={data?.rank ?? "bronze"}
        nextRankAt={data?.next_rank_at ?? null}
        streakDays={streakDays}
        activeToday={activeToday}
        badgesEarned={data?.earned.length ?? 0}
        badgesAvailable={data?.catalog.length ?? 0}
        isLoading={isLoading}
      />

      <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
        {isLoading ? (
          <>
            <Skeleton className="h-[196px] w-full rounded-card" />
            <Skeleton className="h-[196px] w-full rounded-card" />
          </>
        ) : (
          <>
            <StreakCard
              days={streakDays}
              activeToday={activeToday}
              onOpen={() => onOpenCategory("streak_ranks")}
            />
            <GoalCard pick={pick} onOpen={onOpenCategory} />
          </>
        )}
      </div>
    </div>
  );
}

/** Orange: momentum. The one thing on this page that can be lost by doing nothing. */
function StreakCard({
  days,
  activeToday,
  onOpen,
}: {
  days: number;
  activeToday: boolean;
  onOpen: () => void;
}) {
  const title = days === 0 ? "No streak yet" : days === 1 ? "1 day streak" : `${days} day streak`;

  // Three genuinely different situations, three different sentences. A single
  // generic line here would waste the only card that can prompt action today.
  const body =
    days === 0
      ? "Sit an exam, submit homework, or open a study material to start one. Any one of the three counts."
      : activeToday
        ? "You are active today, so this is safe. Come back tomorrow to make it " + (days + 1) + "."
        : "Nothing logged yet today. One exam, homework, or study material keeps it alive.";

  return (
    <HeroCard tone="orange" eyebrow="Momentum">
      <div className="mt-2 flex items-start gap-3">
        <Flame className="mt-1 h-7 w-7 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-[22px] font-bold leading-tight tabular-nums">{title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-white/85">{body}</p>
        </div>
      </div>
      <HeroAction label="Streak Ranks" onClick={onOpen} />
    </HeroCard>
  );
}

/** Violet: the goal ahead. The closest badge still to earn, across every category. */
function GoalCard({
  pick,
  onOpen,
}: {
  // Spelled out rather than `ReturnType<typeof pickClosestBadge>`: the ranker is
  // generic over the category union so the teacher surface can reuse it, and
  // `ReturnType` resolves a type parameter to its CONSTRAINT (`string`), not its
  // default, which would widen `candidate.category` and break `onOpen`.
  pick: NextBadgePick | null;
  onOpen: (category: AchievementCategory) => void;
}) {
  if (!pick) {
    // Not an error and not empty: every measurable badge is already done. The
    // remaining ones are threshold or year-end awards with no partial progress.
    return (
      <HeroCard tone="violet" eyebrow="Next badge">
        <h3 className="mt-2 text-[22px] font-bold leading-tight">Nothing left to chase</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-white/85">
          Every badge with measurable progress is done. What remains is decided by your
          results, or at the end of the year.
        </p>
        <HeroAction label="See Legendary" onClick={() => onOpen("legendary")} />
      </HeroCard>
    );
  }

  const { candidate, ratio, gapLabel } = pick;

  return (
    <HeroCard tone="violet" eyebrow="Next badge">
      <div className="mt-2 flex items-start gap-3.5">
        <BadgeShield tier={candidate.tier} iconName={candidate.iconName} earned={false} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[22px] font-bold leading-tight">{candidate.name}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-white/85">{gapLabel}</p>

          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            aria-label={`Progress toward ${candidate.name}`}
          >
            <div
              className="h-full rounded-full bg-white transition-[width] duration-500"
              style={{ width: `${Math.max(3, Math.round(ratio * 100))}%` }}
            />
          </div>
        </div>
      </div>
      <HeroAction label="View badge" onClick={() => onOpen(candidate.category)} />
    </HeroCard>
  );
}