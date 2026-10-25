/**
 * Teacher medals: the four standings a teacher can hold, and the pure engine
 * that decides which one they hold from the `teacher_achievements()` payload.
 *
 * WHY A MEDAL AND NOT THE RANK. `badge_rank_for_points()` (bronze at 0, silver
 * at 100, gold at 300, platinum at 600, diamond at 1000) hands every teacher a
 * rank the day they sign in and reaches platinum on first-time badges alone:
 * the teacher on the 2026-10-12 screenshot held "Platinum Rank" with 685 points
 * and 24 of 50 badges. A medal is different in two ways, and both are the
 * product rule, not an optimisation:
 *
 *   1. Nothing is given. There is NO medal until the Bronze requirements are
 *      met, so "No medal yet" is a real state the hero has to render.
 *   2. Points alone never earn a medal. Each medal names KEYSTONE badges that
 *      must all be held, on top of its points floor, and the medals are taken
 *      in order: Gold cannot be held without Silver.
 *
 * The keystones are chosen so that every one of them is inside the teacher's
 * own control (attendance, lessons, planning, syllabus, papers, marking,
 * results, remarks, homework). Tasks, cover periods and leave reviews still
 * carry points, but a teacher nobody assigns a task to must still be able to
 * reach Diamond, so none of them is a keystone.
 *
 * NO KEYSTONE IS A MINUTE'S WORK (Naman, 2026-10-12: "not completed within 1
 * minute, or 1 day"). The catalog's first-time rungs (Roll Call, Paper Out,
 * Homework Set, Red Pen, Results In: threshold 1, done in one click) carry
 * points but never gate a medal; every keystone threshold is 5 or more, and
 * Bronze itself needs attendance on 10 DISTINCT DAYS, which is the one metric
 * that cannot be rushed. Since medals are taken in order, no medal at all can
 * be earned inside a day. `medals.test.mjs` pins both rules.
 *
 * A keystone is addressed by METRIC + THRESHOLD, never by badge id or name:
 * ids differ between environments and names get renamed (`First Exam
 * Creator` became `First Paper`). `resolveKeystone` finds the catalog row
 * with that metric and the smallest `criteria_value` at or above the
 * threshold, so when a harder badge lands in `badge_definitions` the ladder
 * can be re-pointed by editing ONE number here. A keystone with no matching
 * row resolves to null, renders as "not available yet", and keeps its medal
 * out of reach rather than quietly waiving it.
 *
 * Erasable TypeScript on purpose: `import type` only, no runtime import, so
 * `medals.test.mjs` next door can run the real module under
 * `node --experimental-strip-types` with no bundler, the way
 * scripts/test-dashboard-actions.mjs runs dashboardActions.ts. Keep it that
 * way: a runtime import here breaks the test, and a React import would pull
 * the component tree into the hook's chunk (§23).
 *
 * The server still returns `rank` / `next_rank_at` on the payload and students
 * still render it; the teacher surface simply no longer reads it. The rule
 * table below is the frontend's copy until a `teacher_medal_for()` RPC exists
 * (NEEDS DB, see docs/superpowers/specs/2026-10-12-teacher-medals-design.md),
 * after which this table mirrors the server the way RANK_FLOOR used to.
 */

import type { BadgeProgressShape } from "../types";
import type { TeacherAchievements, TeacherBadgeShape, TeacherMetric } from "./teacherTypes";

export type TeacherMedal = "bronze" | "silver" | "gold" | "diamond";

/** Lowest to highest. The ladder is walked in this order and nothing is skipped. */
export const MEDAL_ORDER: readonly TeacherMedal[] = ["bronze", "silver", "gold", "diamond"];

export const MEDAL_LABEL: Record<TeacherMedal, string> = {
  bronze: "Bronze Medal",
  silver: "Silver Medal",
  gold: "Gold Medal",
  diamond: "Diamond Medal",
};

export interface KeystoneRule {
  /** `badge_definitions.criteria_metric` of the badge that must be held. */
  metric: TeacherMetric;
  /**
   * The badge's `criteria_value` must be at least this. Written as the EXACT
   * threshold of the intended catalog row (10 for Register Keeper, 30 for
   * Never Misses); `medals.test.mjs` fails if any rule stops matching a row
   * exactly, which is how a catalog re-pricing gets noticed.
   */
  min: number;
}

export interface MedalRule {
  medal: TeacherMedal;
  /** Two or three words naming what the medal says about the teacher. */
  title: string;
  /** One line under the title. A teacher's voice, no jargon, no em-dash. */
  blurb: string;
  /** Total points held (every earned teacher badge) must reach this. */
  pointsFloor: number;
  keystones: readonly KeystoneRule[];
}

/**
 * THE ladder. Edit here and nowhere else; the hero, the ladder section and the
 * keystone notes on the tiles all read this table.
 *
 * Floors climb 100 / 600 / 1300 / 1900 of the 2,245 points the live catalog
 * carries. Each floor sits a little ABOVE what its own keystones and their
 * lower rungs add up to (about 175, 540, 1,260 and 1,785), so the floor always
 * asks for some breadth beyond the keystones rather than being implied by
 * them, and Diamond takes roughly 85% of everything there is.
 */
export const MEDAL_RULES: Record<TeacherMedal, MedalRule> = {
  bronze: {
    medal: "bronze",
    title: "Settled in",
    blurb: "Ten days on the register, ten lessons logged, ten papers written and homework set five times.",
    pointsFloor: 100,
    keystones: [
      { metric: "attendance_days_marked", min: 10 }, // Register Keeper
      { metric: "lessons_taught", min: 10 }, // Course Keeper
      { metric: "exams_created", min: 10 }, // Paper Trail
      { metric: "homework_created", min: 5 }, // Regular Setter
    ],
  },
  silver: {
    medal: "silver",
    title: "Consistent",
    blurb: "A term of attendance, lessons planned before the day, chapters closed, papers published, marking and results done.",
    pointsFloor: 600,
    keystones: [
      { metric: "attendance_days_marked", min: 30 }, // Never Misses
      { metric: "lessons_planned_ahead", min: 10 }, // Week Ready
      { metric: "syllabus_topics_completed", min: 10 }, // Chapter Closer
      { metric: "exams_published", min: 25 }, // Regular Examiner
      { metric: "answers_evaluated", min: 25 }, // Marking Marathon
      { metric: "results_published", min: 10 }, // Report Ready
      { metric: "students_remarked", min: 10 }, // Class Mentor
    ],
  },
  gold: {
    medal: "gold",
    title: "Complete teacher",
    blurb: "Teaching, planning, assessing, marking and feedback, all carried through a whole year.",
    pointsFloor: 1300,
    keystones: [
      { metric: "lessons_taught", min: 50 }, // Syllabus Shepherd
      { metric: "lessons_planned_ahead", min: 40 }, // Term Ready
      { metric: "syllabus_topics_completed", min: 40 }, // Curriculum Complete
      { metric: "exams_created", min: 25 }, // Exam Architect
      { metric: "answers_evaluated", min: 100 }, // Century of Scripts
      { metric: "results_published", min: 25 }, // Results Veteran
      { metric: "students_remarked", min: 30 }, // Every Student Seen
      { metric: "homework_created", min: 15 }, // Practice Architect
      { metric: "homework_marked", min: 5 }, // Feedback Loop
    ],
  },
  diamond: {
    medal: "diamond",
    title: "Master of the craft",
    blurb: "The hardest badges in the set, every one of them earned by hand. Few teachers get here.",
    pointsFloor: 1900,
    keystones: [
      { metric: "exams_created", min: 50 }, // Question Master
      { metric: "exams_published", min: 50 }, // Publishing Pro
      { metric: "answers_evaluated", min: 200 }, // Marking Machine
      { metric: "questions_authored", min: 50 }, // Question Vault
    ],
  },
};

/* ────────────────────────────────────────────────────────────────────────
   Engine output
   ──────────────────────────────────────────────────────────────────────── */

export interface PointsRequirement {
  kind: "points";
  need: number;
  have: number;
  met: boolean;
}

export interface BadgeRequirement {
  kind: "badge";
  rule: KeystoneRule;
  /** The catalog row the rule resolved to, or null when the set has none. */
  badge: TeacherBadgeShape | null;
  /** The teacher's live progress row for that badge, if the evaluator wrote one. */
  progress: BadgeProgressShape | null;
  /** True only when `user_badges` holds the row. Progress at 100% is not an award. */
  met: boolean;
}

export type MedalRequirement = PointsRequirement | BadgeRequirement;

/**
 *   earned  every requirement met and the medal below it earned
 *   next    the first medal not yet earned: the one to work toward
 *   locked  above the next medal; shown so the whole ladder is visible
 */
export type MedalStatus = "earned" | "next" | "locked";

export interface MedalStep {
  medal: TeacherMedal;
  rule: MedalRule;
  /** Points first, then the keystones in rule order. */
  requirements: MedalRequirement[];
  metCount: number;
  total: number;
  status: MedalStatus;
}

export interface MedalLadder {
  steps: MedalStep[];
  /** Highest medal held, or null when even Bronze is still ahead. */
  current: TeacherMedal | null;
  /** The medal to work toward, or null once Diamond is held. */
  next: TeacherMedal | null;
}

/**
 * The catalog row a keystone points at: same metric, smallest threshold at or
 * above `min`. Picking the smallest row AT OR ABOVE rather than an exact match
 * means a catalog that only carries a harder rung still gives a coherent (if
 * stricter) requirement instead of a hole in the ladder.
 */
export function resolveKeystone(
  rule: KeystoneRule,
  catalog: readonly TeacherBadgeShape[],
): TeacherBadgeShape | null {
  let best: TeacherBadgeShape | null = null;
  for (const badge of catalog) {
    if (badge.criteria_metric !== rule.metric || badge.criteria_value < rule.min) continue;
    if (!best || badge.criteria_value < best.criteria_value) best = badge;
  }
  return best;
}

/** Walk the ladder bottom-up and decide every medal's status. */
export function buildMedalLadder(data: TeacherAchievements | undefined): MedalLadder {
  const catalog = data?.catalog ?? [];
  const points = data?.points ?? 0;
  const progress = data?.progress ?? {};
  const earnedIds = new Set<string>();
  for (const row of data?.earned ?? []) earnedIds.add(row.badge_id);

  const steps: MedalStep[] = [];
  let current: TeacherMedal | null = null;
  let next: TeacherMedal | null = null;
  // True while every medal so far has been earned, so exactly one step can be
  // "next": the first one that is not.
  let belowEarned = true;

  for (const medal of MEDAL_ORDER) {
    const rule = MEDAL_RULES[medal];
    const requirements: MedalRequirement[] = [
      { kind: "points", need: rule.pointsFloor, have: points, met: points >= rule.pointsFloor },
    ];
    for (const keystone of rule.keystones) {
      const badge = resolveKeystone(keystone, catalog);
      requirements.push({
        kind: "badge",
        rule: keystone,
        badge,
        progress: badge ? (progress[badge.id] ?? null) : null,
        met: badge !== null && earnedIds.has(badge.id),
      });
    }

    let metCount = 0;
    for (const r of requirements) if (r.met) metCount++;
    const earned = belowEarned && metCount === requirements.length;

    let status: MedalStatus;
    if (earned) {
      status = "earned";
      current = medal;
    } else if (belowEarned) {
      status = "next";
      next = medal;
    } else {
      status = "locked";
    }
    belowEarned = earned;

    steps.push({ medal, rule, requirements, metCount, total: requirements.length, status });
  }

  return { steps, current, next };
}

/**
 * badge id -> the LOWEST medal that names it as a keystone, for the "Needed
 * for the Silver Medal" note on a tile. A badge is never a keystone of two
 * medals (`medals.test.mjs` asserts it), so "lowest" is only a tie-break rule
 * for a future edit, not a case the live table reaches.
 */
export function keystoneBadgesByMedal(
  catalog: readonly TeacherBadgeShape[],
): Map<string, TeacherMedal> {
  const out = new Map<string, TeacherMedal>();
  for (const medal of MEDAL_ORDER) {
    for (const keystone of MEDAL_RULES[medal].keystones) {
      const badge = resolveKeystone(keystone, catalog);
      if (badge && !out.has(badge.id)) out.set(badge.id, medal);
    }
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * How far along ONE requirement is, 0..1. A met requirement is 1 whatever its
 * numbers say; an unresolved keystone is 0 because there is nothing to
 * progress toward. `badge_progress.target` wins over `criteria_value` for the
 * same reason it does in toBadgeDisplay: the evaluator may write a real target.
 */
export function requirementRatio(r: MedalRequirement): number {
  if (r.met) return 1;
  if (r.kind === "points") return r.need > 0 ? clamp01(r.have / r.need) : 1;
  if (!r.badge) return 0;
  const target =
    r.progress?.target && r.progress.target > 0 ? r.progress.target : r.badge.criteria_value;
  return target > 0 ? clamp01((r.progress?.current ?? 0) / target) : 0;
}

/**
 * The single number on the hero's progress bar: the MEAN of the step's
 * requirement ratios, points included. An average rather than "met / total"
 * so the bar moves on the day a teacher marks their eleventh register, not
 * only on the day a whole badge lands. Round DOWN when printing it (never
 * overstate what a teacher has done, the fmtHave rule).
 */
export function medalProgressRatio(step: MedalStep): number {
  if (step.requirements.length === 0) return 0;
  let sum = 0;
  for (const r of step.requirements) sum += requirementRatio(r);
  return sum / step.requirements.length;
}

/**
 * The next medal's requirements that are still open, points first. Empty once
 * Diamond is held. This is what the card's dropdown lists and counts.
 */
export function openRequirements(ladder: MedalLadder): MedalRequirement[] {
  const step = ladder.next ? ladder.steps.find((s) => s.medal === ladder.next) : undefined;
  return step ? step.requirements.filter((r) => !r.met) : [];
}

/** The medal one rung below, or null for Bronze. Used by the "earn X first" line. */
export function medalBelow(medal: TeacherMedal): TeacherMedal | null {
  const i = MEDAL_ORDER.indexOf(medal);
  return i > 0 ? MEDAL_ORDER[i - 1] : null;
}
