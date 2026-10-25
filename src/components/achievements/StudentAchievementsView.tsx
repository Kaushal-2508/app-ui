import { useMemo, useState } from "react";
import { Trophy } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { useProfileData } from "@/hooks/useProfileData";
import { useBadgeRarity, useStudentAchievements } from "@/hooks/useStudentAchievements";
import { formatClassName } from "@/lib/utils";

import { AchievementsHero } from "./AchievementsHero";
import { AchievementsTabs } from "./AchievementsTabs";
import { BadgeTile, BadgeTileGrid, BadgeTileSkeleton } from "./BadgeTile";
import { ACHIEVEMENT_CATEGORY_ORDER } from "./categories";
import { isHeldForCurrentPeriod, toBadgeDisplay, toNextBadgeCandidates } from "./toBadgeDisplay";
import type { AchievementCategory } from "./types";

/**
 * The student Achievements surface: next-badge callout, five category tabs, and
 * the tiles for the active category.
 *
 * Composition only. Every display decision lives in toBadgeDisplay(), which
 * returns a discriminated union, so a threshold badge is structurally incapable
 * of rendering a progress bar here.
 */
export function StudentAchievementsView() {
  const { data, isLoading, isError, refetch } = useStudentAchievements();
  const { data: rarity } = useBadgeRarity();
  const { data: profile } = useProfileData();
  const [category, setCategory] = useState<AchievementCategory>("streak_ranks");

  const studentClass = profile?.studentClass;
  const classLabel = studentClass?.name
    ? formatClassName(studentClass.name, studentClass.section)
    : null;

  const rarityMap = useMemo(() => rarity ?? {}, [rarity]);

  const candidates = useMemo(
    () => toNextBadgeCandidates(data, rarityMap),
    [data, rarityMap],
  );

  // Earned-at per badge, newest first. Player of the Month has one row per month,
  // so this deliberately keeps the most recent rather than collapsing to one.
  const earnedAtById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.earned ?? []) {
      const seen = map.get(row.badge_id);
      if (!seen || row.earned_at > seen) map.set(row.badge_id, row.earned_at);
    }
    return map;
  }, [data?.earned]);

  const counts = useMemo(() => {
    const acc: Partial<Record<AchievementCategory, number>> = {};
    for (const badge of data?.catalog ?? []) {
      if (earnedAtById.has(badge.id)) {
        acc[badge.category] = (acc[badge.category] ?? 0) + 1;
      }
    }
    return acc;
  }, [data?.catalog, earnedAtById]);

  const visible = useMemo(
    () => (data?.catalog ?? []).filter((b) => b.category === category),
    [data?.catalog, category],
  );

  // Error BEFORE anything else (§6), and as an EARLY RETURN so the page shows
  // one failure rather than an error card stacked on top of a hero confidently
  // reporting "Bronze rank, 0 points" — which is a claim about the student, not
  // a loading state.
  if (isError) {
    return (
      <EmptyState
        icon={<Trophy className="h-7 w-7" />}
        tone="rose"
        title="Couldn't load your achievements"
        description="Please try again in a moment."
        action={{ label: "Retry", onClick: () => void refetch() }}
      />
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <AchievementsHero
        data={data}
        candidates={candidates}
        name={profile?.full_name ?? "Student"}
        studentClass={classLabel}
        isLoading={isLoading}
        onOpenCategory={setCategory}
      />

      <AchievementsTabs value={category} onValueChange={setCategory} counts={counts} />

      {isLoading ? (
        <BadgeTileGrid>
          {ACHIEVEMENT_CATEGORY_ORDER.map((key) => (
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
            const heldNow = isHeldForCurrentPeriod(badge, data?.earned ?? []);
            return (
              <BadgeTile
                key={badge.id}
                name={badge.name}
                description={badge.description}
                iconName={badge.icon_name}
                tier={badge.tier}
                points={badge.points}
                earned={earnedAtById.has(badge.id)}
                earnedForCurrentPeriod={heldNow}
                earnedAt={earnedAtById.get(badge.id) ?? null}
                display={toBadgeDisplay(badge, data?.progress[badge.id], rarityMap[badge.id])}
              />
            );
          })}
        </BadgeTileGrid>
      )}
    </div>
  );
}