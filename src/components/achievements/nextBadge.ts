import {
  displayGapLabel,
  displayRatio,
  displayRemaining,
  type AchievementCategory,
  type BadgeDisplay,
  type ShieldTier,
} from "./types";

/**
 * `TCategory` defaults to the student union, so a bare `NextBadgeCandidate`
 * still means exactly what it meant before this became generic. The teacher
 * surface instantiates it with its own five-category union, which is what stops
 * a teacher pick's "View badge" action from asking for a student tab.
 *
 * The ranking below never reads `category`; it is carried through so the caller
 * can navigate to the pick.
 */
export interface NextBadgeCandidate<TCategory extends string = AchievementCategory> {
  id: string;
  name: string;
  description?: string | null;
  iconName: string;
  tier: ShieldTier;
  category: TCategory;
  points: number;
  display: BadgeDisplay;
  /**
   * True when the student already holds this badge for the period that
   * matters:
   *   one-shot badges  -> held at any time
   *   re-earnable ones -> held for the CURRENT period_key
   *
   * Player of the Month is re-earnable, so pass `true` once the student has
   * a user_badges row with period_key = the current 'YYYY-MM'. That is what
   * keeps it out of the callout for the rest of the month while still
   * letting it come back on the 1st. `isHeldForCurrentPeriod` in
   * ./toBadgeDisplay computes it from the payload.
   */
  earnedForCurrentPeriod: boolean;
}

export interface NextBadgePick<TCategory extends string = AchievementCategory> {
  candidate: NextBadgeCandidate<TCategory>;
  /** 0..1 completion. Only cumulative badges are ranked, so this is real progress. */
  ratio: number;
  /** Units still missing (days, exams, materials). */
  remaining: number;
  /** Human sentence for closing the gap, e.g. "8 more days to go". */
  gapLabel: string;
}

/**
 * The single closest unearned badge across every category.
 *
 * ONLY cumulative badges are ranked, and that is the product rule, not an
 * optimisation:
 *
 *   threshold  a "best single exam" is a historical maximum, not accumulated
 *              progress. Ranking on best/required pinned this card to Ace at
 *              ratio 0.99 forever for anyone who once scored 89%, and the
 *              number never moved again no matter what they did.
 *   event      there is no partial progress toward "come back within 48 hours".
 *   rarity     there is no measurable distance to "be the one Class MVP".
 *
 * `displayRatio` returns null for all three, so they drop out here without a
 * special case. Everything else is ranked by completion ratio, then by the
 * smallest absolute gap, then by the cheapest badge, then by name, so the pick
 * is stable across renders.
 */
export function pickClosestBadge<TCategory extends string = AchievementCategory>(
  candidates: NextBadgeCandidate<TCategory>[],
): NextBadgePick<TCategory> | null {
  const ranked: NextBadgePick<TCategory>[] = [];

  for (const candidate of candidates) {
    if (candidate.earnedForCurrentPeriod) continue;

    const ratio = displayRatio(candidate.display);
    const remaining = displayRemaining(candidate.display);
    const gapLabel = displayGapLabel(candidate.display);
    if (ratio === null || remaining === null || gapLabel === null) continue;
    // Already complete but not yet awarded: the evaluator runs on the next
    // qualifying event, so surfacing it as "the next thing to do" is wrong.
    if (remaining <= 0) continue;

    ranked.push({ candidate, ratio, remaining, gapLabel });
  }

  if (ranked.length === 0) return null;

  ranked.sort((a, b) => {
    if (b.ratio !== a.ratio) return b.ratio - a.ratio;
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    if (a.candidate.points !== b.candidate.points) return a.candidate.points - b.candidate.points;
    return a.candidate.name.localeCompare(b.candidate.name);
  });

  return ranked[0];
}

/** Re-export so callers can build candidates without importing two modules. */
export type { BadgeDisplay };
