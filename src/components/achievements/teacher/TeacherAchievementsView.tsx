import { useMemo, useState } from "react";
import { Medal, Trophy } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { useProfileData } from "@/hooks/useProfileData";

import { BadgeTile, BadgeTileGrid, BadgeTileSkeleton } from "../BadgeTile";
import { isHeldForCurrentPeriod, toBadgeDisplay, toNextBadgeCandidates } from "../toBadgeDisplay";
import { TeacherAchievementsTabs } from "./TeacherAchievementsTabs";
import { TeacherHero } from "./TeacherHero";
import { MEDAL_LABEL, buildMedalLadder, keystoneBadgesByMedal } from "./medals";
import { TEACHER_CATEGORY_ORDER, type TeacherAchievementCategory } from "./teacherCategories";
import type { TeacherAchievements } from "./teacherTypes";

export interface TeacherAchievementsViewProps {
  /** The `useTeacherAchievements()` payload. */
  data: TeacherAchievements | undefined;
  isLoading?: boolean;
  isError?: boolean;
  /** Wired to the error state's Retry button, e.g. the query's `refetch`. */
  onRetry?: () => void;
}

/**
 * The teacher Achievements surface: rank + next-badge hero, five category tabs,
 * and the tiles for the active category.
 *
 * Structurally the student surface, in a teacher's language. Composition only:
 * every display decision lives in `toBadgeDisplay()`, and every teacher metric
 * is a running count, so every tile here gets a progress bar and none of them
 * can reach the threshold, event or rarity readouts.
 *
 * Deliberately takes its payload as a prop rather than calling the hook, so the
 * page that already needs the same numbers (badge counts, points) shares one
 * query instead of issuing a second.
 */
export function TeacherAchievementsView({
  data,
  isLoading = false,
  isError = false,
  onRetry,
}: TeacherAchievementsViewProps) {
  const { data: profile } = useProfileData();
  const [category, setCategory] = useState<TeacherAchievementCategory>("classroom");

  // Earned-at per badge, newest first. No teacher badge is periodic, so this is
  // one row per badge in practice; the reduction is kept for symmetry with the
  // student view and to stay correct if a re-earnable teacher badge ever lands.
  const earnedAtById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.earned ?? []) {
      const seen = map.get(row.badge_id);
      if (!seen || row.earned_at > seen) map.set(row.badge_id, row.earned_at);
    }
    return map;
  }, [data?.earned]);

  // No rarity argument: `badge_rarity()` compares a student against the students
  // of their institution, so it says nothing about a teacher. Every teacher
  // badge is cumulative and never renders a rarity chip, so there is nothing to
  // pass and nothing missing.
  // Every catalog row comes from the server since 20260904160000 was applied;
  // the frontend mirror of not-yet-migrated badges was deleted on 2026-10-05
  // (Task 10).
  const candidates = useMemo(() => toNextBadgeCandidates<TeacherAchievementCategory>(data), [data]);

  // The medal ladder, built ONCE here and handed to the hero, which shows the
  // medal held, how far the next is, and (behind its dropdown) what is left.
  const ladder = useMemo(() => buildMedalLadder(data), [data]);
  const keystoneMedalById = useMemo(() => keystoneBadgesByMedal(data?.catalog ?? []), [data?.catalog]);

  const counts = useMemo(() => {
    const acc: Partial<Record<TeacherAchievementCategory, number>> = {};
    for (const badge of data?.catalog ?? []) {
      if (earnedAtById.has(badge.id)) {
        acc[badge.category] = (acc[badge.category] ?? 0) + 1;
      }
    }
    return acc;
  }, [data?.catalog, earnedAtById]);

  // Sorted by display_order so the tier ladder always reads bronze to platinum,
  // whatever order the payload arrives in.
  const visible = useMemo(
    () =>
      (data?.catalog ?? [])
        .filter((b) => b.category === category)
        .sort((a, b) => a.display_order - b.display_order),
    [data?.catalog, category],
  );

  // Error BEFORE anything else (§6), and as an EARLY RETURN so the page shows
  // one failure rather than an error card stacked on top of a hero confidently
  // reporting "Bronze rank, 0 points" — which is a claim about the teacher, not
  // a loading state.
  if (isError) {
    return (
      <EmptyState
        icon={<Trophy className="h-7 w-7" />}
        tone="rose"
        title="Couldn't load your achievements"
        description="Please try again in a moment."
        action={onRetry ? { label: "Retry", onClick: onRetry } : undefined}
      />
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <TeacherHero
        data={data}
        candidates={candidates}
        ladder={ladder}
        name={profile?.full_name ?? "Teacher"}
        isLoading={isLoading}
        onOpenCategory={setCategory}
      />

      <TeacherAchievementsTabs value={category} onValueChange={setCategory} counts={counts} />

      {isLoading ? (
        <BadgeTileGrid>
          {TEACHER_CATEGORY_ORDER.map((key) => (
            <BadgeTileSkeleton key={key} />
          ))}
        </BadgeTileGrid>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-7 w-7" />}
          title="Nothing here yet"
          description="Badges in this category will appear once your school starts using it."
        />
      ) : (
        <BadgeTileGrid>
          {visible.map((badge) => {
            const keystoneOf = keystoneMedalById.get(badge.id);
            return (
              <BadgeTile
                key={badge.id}
                name={badge.name}
                description={badge.description}
                iconName={badge.icon_name}
                tier={badge.tier}
                points={badge.points}
                earned={earnedAtById.has(badge.id)}
                earnedForCurrentPeriod={isHeldForCurrentPeriod(badge, data?.earned ?? [])}
                earnedAt={earnedAtById.get(badge.id) ?? null}
                display={toBadgeDisplay(badge, data?.progress[badge.id])}
                note={
                  keystoneOf ? (
                    <span className="inline-flex items-center gap-1">
                      <Medal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Needed for the {MEDAL_LABEL[keystoneOf]}
                    </span>
                  ) : undefined
                }
              />
            );
          })}
        </BadgeTileGrid>
      )}
    </div>
  );
}
