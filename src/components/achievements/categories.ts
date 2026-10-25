import { CalendarCheck, Crown, Flame, ScrollText, Target, type LucideIcon } from "lucide-react";

import type { AchievementCategory } from "./types";

export interface AchievementCategoryMeta {
  label: string;
  icon: LucideIcon;
  /**
   * One-line description rendered as the section header under the tab strip by
   * `AchievementsTabs`. Keep it true to the badges the category actually holds.
   */
  blurb: string;
}

/** Tab order is fixed: consistency, volume, performance, rhythm, glory. */
export const ACHIEVEMENT_CATEGORY_ORDER: AchievementCategory[] = [
  "streak_ranks",
  "quest_log",
  "clutch_plays",
  "monthly_form",
  "legendary",
];

export const ACHIEVEMENT_CATEGORY_META: Record<AchievementCategory, AchievementCategoryMeta> = {
  streak_ranks: {
    label: "Streak Ranks",
    icon: Flame,
    blurb: "Show up day after day and climb from Hat-trick to Legacy.",
  },
  quest_log: {
    label: "Quest Log",
    icon: ScrollText,
    blurb: "Milestones for exams attempted and study material opened.",
  },
  clutch_plays: {
    label: "Clutch Plays",
    icon: Target,
    // In Form is a 3-exam cumulative badge in this category, so the old copy
    // ("big scores in a single exam") described the category as single-exam only.
    blurb: "Rewards for big scores, beating your own best, and stringing strong results together.",
  },
  monthly_form: {
    label: "Monthly Form",
    icon: CalendarCheck,
    blurb: "Resets on the 1st. Stay active and win the month, every month.",
  },
  legendary: {
    label: "Legendary",
    icon: Crown,
    blurb: "Decided at the end of the academic year. Only a handful ever land these.",
  },
};
