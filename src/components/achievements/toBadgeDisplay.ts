/**
 * The single adapter from the `student_achievements()` / `badge_rarity()`
 * payload to the `BadgeDisplay` union the components render.
 *
 * This is the one place that knows the LOCKED `criteria_metric` vocabulary, and
 * `criteria_type` is what decides the display variant:
 *
 *   criteria_type | badges                                           | variant
 *   --------------|--------------------------------------------------|-----------
 *   streak        | Hat-trick .. Legacy (7)                          | cumulative
 *   count         | Debut, Regular Starter, Iron Man, First XI,      | cumulative
 *                 | Playbook Pro, In Form, Double Century            |
 *   periodic      | Player of the Month                              | cumulative
 *   threshold     | Clean Hit, MVP Round, Ace, Century               | threshold
 *   event         | Comeback, Personal Best                          | event
 *   aggregate     | Grand Slam, Undefeated, Class MVP, All-Star,     | rarity
 *                 | Immortal                                         |
 *
 * A bar is reachable only through `CumulativeDisplay`, so a threshold or
 * aggregate badge cannot render one no matter what a call site does.
 */

import type { NextBadgeCandidate } from "./nextBadge";
import {
  formatRarity,
  isCumulativeMetric,
  type AchievementCategory,
  type BadgeDisplay,
  type BadgeProgressShape,
  type BadgeRarityShape,
  type CumulativeMetric,
  type EarnedBadgeShape,
  type ShieldTier,
} from "./types";

/**
 * The catalog-row fields this adapter reads, and nothing else.
 *
 * Deliberately structural rather than `AchievementBadgeShape`: the student and
 * teacher catalogs are two different `category` unions over the same row shape,
 * and every function below treats `category` as an opaque bucket key. Typing the
 * parameter as the fields actually read lets both catalogs share one adapter
 * instead of growing a second copy that drifts. `AchievementBadgeShape` still
 * satisfies it, so no student call site changes.
 */
export interface CatalogRowShape<TCategory extends string = string> {
  id: string;
  name: string;
  description: string | null;
  icon_name: string;
  category: TCategory;
  tier: ShieldTier;
  points: number;
  criteria_type: string;
  criteria_metric: string;
  criteria_value: number;
}

/**
 * Institution-local rendering default (§24). `earned_at` is a timestamptz and
 * the evaluator awards on institution-local dates, so formatting in the
 * device's zone put a 00:30 IST award on the previous day for anyone abroad.
 * Thread the real `institutions.timezone` in once a non-IST school exists.
 */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/**
 * Plural / singular nouns per cumulative metric. Typed as a total record over
 * `CumulativeMetric`, so this map and `CUMULATIVE_METRIC_LIST` cannot drift:
 * adding a metric without a unit, or a unit without a metric, fails typecheck.
 */
const CUMULATIVE_UNITS: Record<CumulativeMetric, { one: string; many: string }> = {
  streak_days: { one: "day", many: "days" },
  exams_completed: { one: "exam", many: "exams" },
  study_materials_opened: { one: "material", many: "materials" },
  homework_submitted: { one: "homework", many: "pieces of homework" },
  exams_at_90: { one: "exam above 90%", many: "exams above 90%" },
  perfect_score_count: { one: "perfect score", many: "perfect scores" },
  active_days_in_month: { one: "active day", many: "active days" },

  // Teacher nouns. Each one names the UNIT OF WORK the metric counts, which is
  // not always the row it counts: attendance_days_marked counts distinct dates
  // rather than attendance_records, so the noun is "days marked", never
  // "students marked".
  attendance_days_marked: { one: "day marked", many: "days marked" },
  lessons_taught: { one: "lesson", many: "lessons" },
  exams_created: { one: "paper", many: "papers" },
  answers_evaluated: { one: "answer marked", many: "answers marked" },
  homework_created: { one: "assignment", many: "assignments" },
  homework_marked: { one: "assignment marked", many: "assignments marked" },
  tasks_completed: { one: "task", many: "tasks" },
  lessons_planned_ahead: { one: "lesson planned ahead", many: "lessons planned ahead" },
  // "chapter", not "topic": the syllabus UI calls a syllabus_topics row a chapter.
  syllabus_topics_completed: { one: "chapter", many: "chapters" },
  exams_published: { one: "paper published", many: "papers published" },
  questions_authored: { one: "question", many: "questions" },
  ai_questions_saved: { one: "AI question saved", many: "AI questions saved" },
  templates_created: { one: "template", many: "templates" },
  templates_shared: { one: "template shared", many: "templates shared" },
  // DISTINCT exams whose results the teacher finalized or published.
  results_published: { one: "result set published", many: "result sets published" },
  // DISTINCT students, not remarks.
  students_remarked: { one: "student", many: "students" },
  substitutions_covered: { one: "period covered", many: "periods covered" },
  leave_reviews_done: { one: "leave request reviewed", many: "leave requests reviewed" },
};

/**
 * The nouns for one cumulative metric, for a surface that has to name a
 * quantity without a catalog row in hand (the medal ladder's "Needs 10 days
 * marked" line when the badge set lacks the keystone).
 */
export function unitsFor(metric: CumulativeMetric): { one: string; many: string } {
  return CUMULATIVE_UNITS[metric];
}

/** What earns each event badge. There is no partial progress toward these. */
const EVENT_HINTS: Record<string, string> = {
  streak_comeback_hours: "Return within 48 hours of breaking a streak",
  score_improvement: "Beat your previous exam by 15 percentage points",
};

/** The rule behind each aggregate badge, shown when no cohort rarity is loaded. */
const AGGREGATE_CRITERIA: Record<string, string> = {
  all_exams_completed: "Sit every exam of the academic year",
  subject_avg_min: "Average 90% or above in every subject",
  class_first_place_count: "Top your class more often than anyone else",
  streak_percentile: "Hold a top 1% streak in your school",
  streak_full_year: "Stay active every day of the academic year",
};

/** Supporting line under an aggregate badge's rarity chip. */
const AGGREGATE_DETAILS: Record<string, string> = {
  all_exams_completed: "Decided at the end of the academic year",
  subject_avg_min: "Decided at the end of the academic year",
  class_first_place_count: "One per class, per academic year",
  streak_percentile: "Decided at the end of the academic year",
  streak_full_year: "Decided at the end of the academic year",
};

/** Institution-local 'YYYY-MM', matching `user_badges.period_key`. */
export function periodKeyFor(now: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD, which slices cleanly and is locale-stable.
  return now.toLocaleDateString("en-CA", { timeZone }).slice(0, 7);
}

/** Institution-local "August 2026", for the Player of the Month period line. */
export function periodLabelFor(now: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  return now.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone });
}

/** True when `criteria_type` marks a badge as re-earnable once per period. */
export function isPeriodic(badge: CatalogRowShape): boolean {
  return badge.criteria_type === "periodic" || badge.category === "monthly_form";
}

/**
 * Whether the student holds this badge for the period that matters right now.
 *
 * One-shot badges: held once, forever. Player of the Month: held only for the
 * current 'YYYY-MM', so it comes back into reach on the 1st.
 */
export function isHeldForCurrentPeriod(
  badge: CatalogRowShape,
  earned: readonly EarnedBadgeShape[],
  now: Date = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): boolean {
  if (!isPeriodic(badge)) return earned.some((e) => e.badge_id === badge.id);
  const period = periodKeyFor(now, timeZone);
  return earned.some((e) => e.badge_id === badge.id && e.period_key === period);
}

function rarityDisplay(
  badge: CatalogRowShape,
  rarity: BadgeRarityShape | null | undefined,
): BadgeDisplay {
  const criterion =
    AGGREGATE_CRITERIA[badge.criteria_metric] ??
    badge.description ??
    "Awarded at the end of the academic year";
  const detail = AGGREGATE_DETAILS[badge.criteria_metric];

  // A live cohort count is the better headline when we have one; the criterion
  // then moves to the supporting line so "Top 1%" is never read as a count.
  if (rarity && rarity.holders > 0) {
    return { kind: "rarity", label: formatRarity(rarity), source: "cohort", detail: criterion };
  }
  return { kind: "rarity", label: criterion, source: "criterion", detail };
}

function cumulativeDisplay(
  badge: CatalogRowShape,
  metric: CumulativeMetric,
  progress: BadgeProgressShape | null | undefined,
  now: Date,
  timeZone: string,
): BadgeDisplay {
  const units = CUMULATIVE_UNITS[metric];
  // `badge_progress.target` wins over `criteria_value`: for Player of the Month
  // the catalog value 15 is a CAP and the evaluator writes the real target,
  // LEAST(15, ceil(0.6 * school_days)).
  const target = progress?.target && progress.target > 0 ? progress.target : badge.criteria_value;
  const current = Math.max(0, Math.min(progress?.current ?? 0, Math.max(target, 0)));

  return {
    kind: "cumulative",
    current,
    target,
    unit: units.many,
    unitOne: units.one,
    periodLabel: isPeriodic(badge) ? periodLabelFor(now, timeZone) : undefined,
  };
}

/**
 * Map one catalog row plus its live progress and rarity to a display.
 *
 * `progress` is the student's `badge_progress` row for this badge, if the
 * evaluator has written one. For threshold badges its `current` is the best
 * single-exam percentage, NOT partial progress, which is why the threshold
 * branch never produces a ratio.
 */
export function toBadgeDisplay(
  badge: CatalogRowShape,
  progress?: BadgeProgressShape | null,
  rarity?: BadgeRarityShape | null,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): BadgeDisplay {
  switch (badge.criteria_type) {
    case "threshold":
      return {
        kind: "threshold",
        best: progress?.current ?? null,
        required:
          progress?.target && progress.target > 0 ? progress.target : badge.criteria_value,
        unit: "%",
      };

    case "aggregate":
      return rarityDisplay(badge, rarity);

    case "event":
      return {
        kind: "event",
        hint:
          EVENT_HINTS[badge.criteria_metric] ??
          badge.description ??
          "Awarded the moment you earn it",
      };

    case "streak":
    case "count":
    case "periodic":
    default:
      // The metric guard is the safety net: an unrecognised metric degrades to
      // an event readout rather than inventing a bar out of a number nobody
      // has defined units for.
      if (isCumulativeMetric(badge.criteria_metric)) {
        return cumulativeDisplay(badge, badge.criteria_metric, progress, now, timeZone);
      }
      return {
        kind: "event",
        hint: badge.description ?? "Awarded the moment you earn it",
      };
  }
}

/**
 * `TCategory` defaults to the student union, so `AchievementsPayloadShape` with
 * no argument still means exactly what it meant before. The teacher payload
 * instantiates it with its own five-category union.
 */
export interface AchievementsPayloadShape<TCategory extends string = AchievementCategory> {
  catalog: CatalogRowShape<TCategory>[];
  earned: EarnedBadgeShape[];
  progress: Record<string, BadgeProgressShape>;
}

/**
 * Build the candidate list the hero's goal card ranks, from one payload.
 *
 * Every badge is included; `pickClosestBadge` is the single place that decides
 * which kinds can be ranked, so this function never pre-filters by variant.
 *
 * The category union flows straight through to the candidates, so the goal
 * card's "View badge" action opens a tab that exists on the surface it is
 * rendered on: a student pick can only carry a student category, a teacher pick
 * only a teacher one.
 */
export function toNextBadgeCandidates<TCategory extends string = AchievementCategory>(
  data: AchievementsPayloadShape<TCategory> | undefined,
  rarityMap: Record<string, BadgeRarityShape> = {},
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): NextBadgeCandidate<TCategory>[] {
  if (!data) return [];
  return data.catalog.map((badge) => ({
    id: badge.id,
    name: badge.name,
    description: badge.description,
    iconName: badge.icon_name,
    tier: badge.tier,
    category: badge.category,
    points: badge.points,
    display: toBadgeDisplay(
      badge,
      data.progress[badge.id],
      rarityMap[badge.id],
      now,
      timeZone,
    ),
    earnedForCurrentPeriod: isHeldForCurrentPeriod(badge, data.earned, now, timeZone),
  }));
}
