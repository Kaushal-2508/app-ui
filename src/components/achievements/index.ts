/**
 * Redesigned student Achievements surface (2026-08-13).
 *
 * COMPONENTS ONLY, plus type-only re-exports (which are erased at build, so
 * they cost nothing). Runtime helpers are deliberately NOT re-exported here:
 * importing `toShieldTier` from this barrel used to pull BadgeTile, Progress,
 * Skeleton, Badge, EmptyState, Button, MobileTabs and ~14 lucide icons into
 * whatever chunk touched it, against the §23 bundle budget.
 *
 * Import helpers from their own modules instead:
 *   ./types           toShieldTier, toAchievementCategory, displayRatio,
 *                     displayRemaining, displayProgressLabel, displayGapLabel,
 *                     cumulativeRatio, cumulativePercent, formatRarity, plural
 *   ./toBadgeDisplay  toBadgeDisplay, toNextBadgeCandidates,
 *                     isHeldForCurrentPeriod, periodKeyFor, periodLabelFor
 *   ./nextBadge       pickClosestBadge
 *   ./categories      ACHIEVEMENT_CATEGORY_META, ACHIEVEMENT_CATEGORY_ORDER
 *   ./tierStyles      BAR_FILL, TIER_TEXT, TIER_LABEL, tierTextClass
 *
 * OnboardingJourneyPanel is also not re-exported, so this barrel does not drag
 * framer-motion into every consumer.
 */

export { BadgeShield } from "./BadgeShield";
export type { BadgeShieldProps, BadgeShieldSize } from "./BadgeShield";

export { BadgeTile, BadgeTileGrid, BadgeTileSkeleton } from "./BadgeTile";
export type { BadgeTileProps } from "./BadgeTile";

export { AchievementsHero } from "./AchievementsHero";
export type { AchievementsHeroProps } from "./AchievementsHero";

export { HeroCard, HeroAction } from "./HeroCard";
export type { HeroCardProps, HeroTone } from "./HeroCard";

export { PlayerCard } from "./PlayerCard";
export type { PlayerCardProps } from "./PlayerCard";

export { AchievementsTabs } from "./AchievementsTabs";
export type { AchievementsTabsProps } from "./AchievementsTabs";

/* Teacher surface (badge_type='teacher'). Same discipline as above: components
   and types only. `TEACHER_CATEGORY_META` / `TEACHER_CATEGORY_ORDER` /
   `toTeacherCategory` are runtime values and stay in ./teacher/teacherCategories,
   and `TEACHER_METRIC_LIST` / `TEACHER_CUMULATIVE_METRICS` in
   ./teacher/teacherTypes, so importing a teacher type never drags five lucide
   icons into the chunk. */
export { TeacherAchievementsView } from "./teacher/TeacherAchievementsView";
export type { TeacherAchievementsViewProps } from "./teacher/TeacherAchievementsView";

export { TeacherAchievementsTabs } from "./teacher/TeacherAchievementsTabs";
export type { TeacherAchievementsTabsProps } from "./teacher/TeacherAchievementsTabs";

export { TeacherHero } from "./teacher/TeacherHero";
export type { TeacherHeroProps } from "./teacher/TeacherHero";

export type {
  TeacherAchievementCategory,
  TeacherCategoryMeta,
} from "./teacher/teacherCategories";
export type {
  TeacherAchievements,
  TeacherBadgeShape,
  TeacherMetric,
} from "./teacher/teacherTypes";

export type { NextBadgeCandidate, NextBadgePick } from "./nextBadge";
export type { AchievementCategoryMeta } from "./categories";
export type { AchievementsPayloadShape, CatalogRowShape } from "./toBadgeDisplay";
export type {
  AchievementBadgeShape,
  AchievementCategory,
  BadgeDisplay,
  BadgeProgressShape,
  BadgeRarityShape,
  CumulativeDisplay,
  CumulativeMetric,
  EarnedBadgeShape,
  EventDisplay,
  RarityDisplay,
  ShieldTier,
  ThresholdDisplay,
} from "./types";
