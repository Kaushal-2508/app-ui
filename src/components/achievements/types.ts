/**
 * Shared vocabulary for the redesigned student Achievements surface.
 *
 * Kept in a plain `.ts` module (no JSX) so the `.tsx` component files export
 * components only and never trip `react-refresh/only-export-components`, and so
 * a type-only consumer never drags the component tree into its chunk (§23).
 */

/** Badge tiers. `legendary` is new and sits above `diamond`. */
export type ShieldTier =
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "legendary";

/** `badge_definitions.category` values for the student achievement set. */
export type AchievementCategory =
  | "streak_ranks"
  | "quest_log"
  | "clutch_plays"
  | "monthly_form"
  | "legendary";

const SHIELD_TIERS: readonly ShieldTier[] = [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "legendary",
];

const ACHIEVEMENT_CATEGORIES: readonly AchievementCategory[] = [
  "streak_ranks",
  "quest_log",
  "clutch_plays",
  "monthly_form",
  "legendary",
];

/** Narrow a raw `badge_definitions.tier` string. Unknown values fall back to bronze. */
export function toShieldTier(value: string | null | undefined): ShieldTier {
  return SHIELD_TIERS.includes(value as ShieldTier) ? (value as ShieldTier) : "bronze";
}

/** Narrow a raw `badge_definitions.category` string. Unknown values fall back to quest_log. */
export function toAchievementCategory(
  value: string | null | undefined,
): AchievementCategory {
  return ACHIEVEMENT_CATEGORIES.includes(value as AchievementCategory)
    ? (value as AchievementCategory)
    : "quest_log";
}

/* ────────────────────────────────────────────────────────────────────────
   Payload shapes

   Declared here rather than in the hook so there is exactly ONE definition of
   each row shape. `useStudentAchievements` re-exports these; the adapter and
   the components consume them without importing the hook (which would pull
   react-query + the supabase client into every chunk that touches a badge).
   ──────────────────────────────────────────────────────────────────────── */

/** One row of `badge_definitions`, as returned by `student_achievements()`. */
export interface AchievementBadgeShape {
  id: string;
  name: string;
  description: string | null;
  icon_name: string;
  category: AchievementCategory;
  tier: ShieldTier;
  points: number;
  /** Drives the display variant: streak | event | count | threshold | periodic | aggregate. */
  criteria_type: string;
  criteria_metric: string;
  criteria_value: number;
  display_order: number;
}

/** One row of `user_badges` for the signed-in student. */
export interface EarnedBadgeShape {
  badge_id: string;
  earned_at: string;
  /** 'YYYY-MM' for re-earnable badges (Player of the Month); null otherwise. */
  period_key: string | null;
}

/** One row of `badge_progress`, keyed by badge id in the payload. */
export interface BadgeProgressShape {
  current: number;
  target: number;
}

/** One entry of `badge_rarity()`, keyed by badge id. */
export interface BadgeRarityShape {
  holders: number;
  /** Percent of students in the same institution, or null when the cohort is empty. */
  percent: number | null;
}

/**
 * The metrics whose badges accumulate toward a count, and therefore get a
 * progress bar. This is the LOCKED list from the achievements contract: every
 * other metric belongs to a threshold, event, or aggregate badge and must be
 * structurally incapable of rendering a bar.
 *
 * STUDENT (badge_type='student'):
 *
 *   streak_days            streak ranks   (Hat-trick .. Legacy)
 *   exams_completed        quest log      (Debut, Regular Starter, Iron Man, First XI)
 *   study_materials_opened quest log      (Playbook Pro)
 *   homework_submitted     quest log      (Net Session .. Full Season)
 *   exams_at_90            clutch plays   (In Form)
 *   perfect_score_count    legendary      (Double Century - NOT 'perfect_scores',
 *                                          which the browser awarder dispatches on)
 *   active_days_in_month   monthly form   (Player of the Month)
 *
 * Note homework_submitted counts SUBMISSIONS while study_materials_opened counts
 * DAYS. Three assignments handed in on one day is three pieces of homework; ten
 * opens of one PDF in an afternoon is one day of revision.
 *
 * TEACHER (badge_type='teacher'): every live teacher badge is a count badge, so
 * all seven teacher metrics are here and none of them can reach a threshold,
 * event or rarity readout.
 *
 *   attendance_days_marked classroom      (Roll Call, Register Keeper, Never Misses)
 *   lessons_taught         classroom      (Lesson Logged, Course Keeper, Syllabus Shepherd)
 *   exams_created          assessment     (First Paper .. Question Master)
 *   answers_evaluated      marking        (Red Pen .. Marking Machine)
 *   homework_created       homework       (Homework Set, Regular Setter, Practice Architect)
 *   homework_marked        homework       (Marked and Returned, Feedback Loop)
 *   tasks_completed        teamwork       (Task Starter .. Task Champion)
 *
 * attendance_days_marked counts DISTINCT DATES, never attendance_records rows:
 * marking one class of 40 is one day of work, not 40 days of work.
 *
 * `student_improvement_percent` and `tasks_on_time` are deliberately ABSENT.
 * The badges that used them (Student Mentor, Impact Creator, Speed Demon) are
 * deactivated precisely because neither metric is computed anywhere: the first
 * has never existed, and the second needs a completion timestamp that `tasks`
 * does not carry. Adding either here would put a bar on a number nobody writes.
 */
export const CUMULATIVE_METRIC_LIST = [
  "streak_days",
  "exams_completed",
  "study_materials_opened",
  "homework_submitted",
  "exams_at_90",
  "perfect_score_count",
  "active_days_in_month",
  "attendance_days_marked",
  "lessons_taught",
  "exams_created",
  "answers_evaluated",
  "homework_created",
  "homework_marked",
  "tasks_completed",
  "lessons_planned_ahead",
  "syllabus_topics_completed",
  "exams_published",
  "questions_authored",
  "ai_questions_saved",
  "templates_created",
  "templates_shared",
  "results_published",
  "students_remarked",
  "substitutions_covered",
  "leave_reviews_done",
] as const;

export type CumulativeMetric = (typeof CUMULATIVE_METRIC_LIST)[number];

/** True when a raw `criteria_metric` is one of the six cumulative metrics. */
export function isCumulativeMetric(metric: string): metric is CumulativeMetric {
  return (CUMULATIVE_METRIC_LIST as readonly string[]).includes(metric);
}

/* ────────────────────────────────────────────────────────────────────────
   Progress display union

   Every badge in the catalog maps to EXACTLY ONE of these four kinds, and the
   kind is what decides the readout. A threshold badge cannot be handed a bar
   because `displayRatio` returns null for it, so `<Progress value={...}/>` does
   not type-check at any call site.
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Badges that accumulate toward a count (streak days, exams taken, study
 * material opens, 90%+ exams, 100% exams, active days). The ONLY kind that
 * gets a progress bar.
 *
 * `unit` is the plural noun: "7 of 15 days".
 * `unitOne` is the singular, required so no call site can produce "1 more days".
 */
export interface CumulativeDisplay {
  kind: "cumulative";
  current: number;
  target: number;
  unit: string;
  unitOne: string;
  /**
   * Set for re-earnable badges (Player of the Month) so the tile can say
   * which period the progress belongs to, e.g. "August 2026".
   */
  periodLabel?: string;
}

/**
 * Single-shot score thresholds (Clean Hit, MVP Round, Ace, Century).
 * These MUST NOT render a progress bar: one 89% exam is not "89% of the way"
 * to an Ace. They show the best score so far against the threshold instead,
 * and `displayRatio` refuses to rank them by closeness for the same reason.
 *
 * `unit` is appended with no space: "74%".
 */
export interface ThresholdDisplay {
  kind: "threshold";
  /** Best single-exam score so far, or null when the student has no result yet. */
  best: number | null;
  required: number;
  unit?: string;
}

/**
 * One-shot events with no measurable run-up (Comeback, Personal Best). There is
 * no partial progress toward "return within 48 hours", so these show what
 * triggers the award and nothing else.
 */
export interface EventDisplay {
  kind: "event";
  /** What earns it, e.g. "Come back within 48 hours of breaking a streak". */
  hint: string;
}

/**
 * Aggregate / legendary badges. There is no meaningful "progress" toward being
 * the one Class MVP, so these show scarcity or the criterion instead.
 */
export interface RarityDisplay {
  kind: "rarity";
  /** Headline chip text, e.g. "Earned by 4% of students" or "Top 1% streak". */
  label: string;
  /**
   * Where `label` came from. "cohort" is a live rarity count from
   * `badge_rarity()`; "criterion" is the rule itself, used when no rarity is
   * loaded. Keeping them apart stops "Top 1%" (a rule) being read as a count.
   */
  source: "cohort" | "criterion";
  /** Optional supporting line, e.g. "One per class, per academic year". */
  detail?: string;
}

export type BadgeDisplay =
  | CumulativeDisplay
  | ThresholdDisplay
  | EventDisplay
  | RarityDisplay;

/* ────────────────────────────────────────────────────────────────────────
   Formatting helpers (shared by BadgeTile and the hero goal card)
   ──────────────────────────────────────────────────────────────────────── */

function trim1(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Format a value the student HAS, rounded DOWN to 1dp.
 *
 * Rounding half-up here printed "Best so far 90%, need 90%" directly above
 * "Not earned yet" for a best of 89.96, and "0 more percentage points" in the
 * gap line. Never overstate what a student has achieved.
 */
export function fmtHave(n: number): string {
  return trim1(Math.floor(n * 10) / 10);
}

/** Format a value the student still NEEDS, rounded UP to 1dp. Never understate a gap. */
export function fmtNeed(n: number): string {
  return trim1(Math.ceil(n * 10) / 10);
}

/** Pick the singular or plural noun for `n`. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Completion ratio 0..1 for a cumulative display. */
export function cumulativeRatio(display: CumulativeDisplay): number {
  return display.target > 0 ? clamp01(display.current / display.target) : 0;
}

/** Completion percent 0..100 for a cumulative display. */
export function cumulativePercent(display: CumulativeDisplay): number {
  return Math.round(cumulativeRatio(display) * 100);
}

/**
 * Completion ratio 0..1, or `null` when the badge cannot be ranked by closeness.
 *
 * Only cumulative badges have a ratio. Threshold badges deliberately return
 * null: `best / required` is a historical maximum, not accumulated progress, so
 * ranking on it pinned the "closest badge" card to Ace forever for anyone who
 * once scored 89%. Event and rarity badges have no distance at all.
 */
export function displayRatio(display: BadgeDisplay): number | null {
  switch (display.kind) {
    case "cumulative":
      return cumulativeRatio(display);
    case "threshold":
    case "event":
    case "rarity":
      return null;
  }
}

/** How many units are still missing. `null` for event and rarity displays. */
export function displayRemaining(display: BadgeDisplay): number | null {
  switch (display.kind) {
    case "cumulative":
      return Math.max(0, display.target - display.current);
    case "threshold":
      return Math.max(0, display.required - (display.best ?? 0));
    case "event":
    case "rarity":
      return null;
  }
}

/** The line shown under the badge name. Never contains an em-dash. */
export function displayProgressLabel(display: BadgeDisplay, earned = false): string {
  switch (display.kind) {
    case "cumulative": {
      const noun = plural(display.target, display.unitOne, display.unit);
      return `${fmtHave(display.current)} of ${fmtHave(display.target)} ${noun}`;
    }
    case "threshold": {
      const unit = display.unit ?? "%";
      if (earned && display.best !== null) return `Achieved ${fmtHave(display.best)}${unit}`;
      if (display.best === null) return `No score yet, need ${fmtHave(display.required)}${unit}`;
      return `Best so far ${fmtHave(display.best)}${unit}, need ${fmtHave(display.required)}${unit}`;
    }
    case "event":
      return display.hint;
    case "rarity":
      return display.label;
  }
}

/** "What closes the gap", used by the hero goal card. `null` for event and rarity. */
export function displayGapLabel(display: BadgeDisplay): string | null {
  const remaining = displayRemaining(display);
  if (remaining === null) return null;

  switch (display.kind) {
    case "cumulative": {
      const noun = plural(remaining, display.unitOne, display.unit);
      return `${fmtNeed(remaining)} more ${noun} to go`;
    }
    case "threshold": {
      const unit = display.unit ?? "%";
      const noun =
        unit === "%"
          ? plural(remaining, "percentage point", "percentage points")
          : unit;
      return `${fmtNeed(remaining)} more ${noun} in a single exam`;
    }
    case "event":
    case "rarity":
      return null;
  }
}

/**
 * Cohort scarcity as a sentence.
 *
 * `percent` is deliberately NULL when the institution has no students to
 * compare against, so "earned by 0%" (a claim) becomes "Rarity unknown" (the
 * truth). Missing rarity data reads the same way rather than inventing a zero.
 */
export function formatRarity(rarity: BadgeRarityShape | null | undefined): string {
  if (!rarity) return "Rarity unknown";
  if (rarity.holders <= 0) return "Nobody has this yet";
  if (rarity.percent === null) {
    return `Earned by ${rarity.holders} ${plural(rarity.holders, "student", "students")}`;
  }
  return `Earned by ${fmtHave(rarity.percent)}% of students`;
}
