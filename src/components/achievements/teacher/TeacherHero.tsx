import { Skeleton } from "@/components/ui/skeleton";

import { BadgeShield } from "../BadgeShield";
import { HeroAction, HeroCard } from "../HeroCard";
import { pickClosestBadge, type NextBadgeCandidate, type NextBadgePick } from "../nextBadge";
import { MedalProgressCard, MedalProgressHeading } from "./MedalProgressCard";
import { NextMedalTodoList } from "./NextMedalTodo";
import { openRequirements, type MedalLadder } from "./medals";
import { TEACHER_CATEGORY_ORDER, type TeacherAchievementCategory } from "./teacherCategories";
import type { TeacherAchievements } from "./teacherTypes";

export interface TeacherHeroProps {
  data: TeacherAchievements | undefined;
  candidates: NextBadgeCandidate<TeacherAchievementCategory>[];
  /** The medal ladder built from `data` by `buildMedalLadder()`, built once by the view. */
  ladder: MedalLadder;
  /** Teacher's display name, the progress card's title. */
  name: string;
  isLoading: boolean;
  /** Opens a category tab below: the violet card's "View badge" and every to-do row. */
  onOpenCategory: (category: TeacherAchievementCategory) => void;
}

/**
 * The top of the teacher Achievements surface: a "Medal progress" heading,
 * the medal progress card (with the next medal's to-do list behind its
 * dropdown), and the violet card carrying the closest badge still to earn.
 *
 * The Home chip (dashboards/MedalChip) shows the same medal and percentage
 * from the same payload, so the two surfaces never disagree. The violet
 * "next badge" card stays, so the row keeps one saturated tile.
 *
 * TWO cards, not three. The student surface has an orange momentum card for the
 * streak; teachers have no streak, because `user_activity_log` is student-only,
 * so there is nothing to put in a third card that would not be invented.
 *
 * This row used to show the points RANK (`badge_rank_for_points()`, which
 * starts everyone at bronze and reached platinum on first-time badges). It now
 * shows the MEDAL from ./medals, which is earned, never given; the payload's
 * `rank` / `next_rank_at` are no longer read on this surface.
 */
export function TeacherHero({
  data,
  candidates,
  ladder,
  name,
  isLoading,
  onOpenCategory,
}: TeacherHeroProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
          <Skeleton className="h-[164px] w-full rounded-card lg:col-span-3" />
          <Skeleton className="h-[164px] w-full rounded-card lg:col-span-2" />
        </div>
      </div>
    );
  }

  const pick = pickClosestBadge(candidates);
  const hasCatalog = (data?.catalog.length ?? 0) > 0;
  // No dropdown without a catalog: every keystone would resolve to "not
  // available yet" and the violet card already says the badge set is off.
  const openCount = hasCatalog ? openRequirements(ladder).length : 0;

  return (
    <div className="space-y-2">
      <MedalProgressHeading />

      {/* lg:items-start: the medal card grows when its dropdown opens, and the
          violet card should keep its own height rather than stretch to match. */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-5 lg:items-start">
        <MedalProgressCard
          className="lg:col-span-3"
          name={name}
          ladder={ladder}
          todo={
            openCount > 0
              ? {
                  count: openCount,
                  content: <NextMedalTodoList ladder={ladder} onOpenCategory={onOpenCategory} />,
                }
              : undefined
          }
        />
        <TeacherGoalCard
          className="lg:col-span-2"
          pick={pick}
          hasCatalog={hasCatalog}
          onOpen={onOpenCategory}
        />
      </div>
    </div>
  );
}

interface TeacherGoalCardProps {
  pick: NextBadgePick<TeacherAchievementCategory> | null;
  /** False when the school's teacher catalog is empty, which is not "all done". */
  hasCatalog: boolean;
  onOpen: (category: TeacherAchievementCategory) => void;
  className?: string;
}

/**
 * Violet: the goal ahead. The closest unearned badge across every category.
 *
 * Every teacher metric is a running count, so every teacher badge is rankable
 * and this card is never starved by the kind filter in `pickClosestBadge` the
 * way the student one can be.
 */
function TeacherGoalCard({ pick, hasCatalog, onOpen, className }: TeacherGoalCardProps) {
  // An empty catalog and a completed one produce the same `null` pick and mean
  // opposite things. Telling a teacher with no badge set that they have "earned
  // everything" would be a claim about them, not a description of the data.
  if (!hasCatalog) {
    return (
      <HeroCard tone="violet" eyebrow="Next badge" className={className}>
        <h3 className="mt-2 text-[22px] font-bold leading-tight">No badges set up yet</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-white/85">
          Your school has not switched on the teacher badge set. Nothing you do is being
          missed, there is simply nothing to award yet.
        </p>
      </HeroCard>
    );
  }

  if (!pick) {
    return (
      <HeroCard tone="violet" eyebrow="Next badge" className={className}>
        <h3 className="mt-2 text-[22px] font-bold leading-tight">Every badge earned</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-white/85">
          There is nothing left to chase. You hold every teacher badge in the catalog.
        </p>
        <HeroAction label="Review your badges" onClick={() => onOpen(TEACHER_CATEGORY_ORDER[0])} />
      </HeroCard>
    );
  }

  const { candidate, ratio, gapLabel } = pick;

  return (
    <HeroCard tone="violet" eyebrow="Next badge" className={className}>
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
