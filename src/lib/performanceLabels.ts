/**
 * Deterministic, rule-based performance labels for the student portal.
 *
 * SINGLE SOURCE OF TRUTH for the plain-language labels shown alongside every
 * visual on the student Dashboard and inside the My Results drill-down. NO AI —
 * every label is computed from the numbers here so the wording never diverges
 * between surfaces (the consolidation requirement).
 *
 * Audience: parents + students on phones, low chart-literacy. Wording is plain
 * and never a judgement on the child — a below-average result is framed as a
 * "focus area" (a next action), never as "weak".
 *
 * Tones map to the shared `Tone` palette (src/components/shared/design-system):
 *   mint  = positive (above / improving / top)
 *   sky   = neutral  (about the same / middle / not enough data)
 *   peach = focus    (below / declining / bottom) — warm, NOT harsh red
 *   rose  = warning  (attendance below threshold, overdue) — reserved for the few red states
 */
import type { Tone } from "@/components/shared/design-system";

/** ± percentage points around the class average within which we say "about the same".
 *  A small band stops a 1–2 point difference from flipping the label. */
export const COMPARISON_BAND = 5;

/** Percentile cutoffs for the class band (top / middle / bottom quarter). */
export const TOP_QUARTILE = 75;
export const BOTTOM_QUARTILE = 25;

/** Below this many classmates, a quartile band isn't meaningful — we hide it. */
export const MIN_COHORT_FOR_BAND = 4;

/** Attendance at or above this % is "good"; below it shows a gentle warning. */
export const ATTENDANCE_WARN_THRESHOLD = 75;

/** Minimum point change between the last two tests before we call it up/down (else "about the same"). */
export const TREND_FLAT_BAND = 1;

export type ComparisonVerdict = "above" | "at_par" | "below" | "unknown";

export interface ComparisonResult {
  verdict: ComparisonVerdict;
  /** Short label for a chip, e.g. "Above class average". */
  label: string;
  tone: Tone;
  /** student − classAvg, rounded 1dp; null when no class average is available. */
  delta: number | null;
}

/**
 * Compare a student value (e.g. their average in a subject) to the class average
 * with a ±band. Drives the dashboard subject snapshot and the My Results subject view.
 */
export function compareToClassAverage(
  studentValue: number | null | undefined,
  classAverage: number | null | undefined,
  band: number = COMPARISON_BAND,
): ComparisonResult {
  if (studentValue == null || classAverage == null) {
    return { verdict: "unknown", label: "No class comparison yet", tone: "sky", delta: null };
  }
  const delta = Math.round((studentValue - classAverage) * 10) / 10;
  if (delta > band) return { verdict: "above", label: "Above class average", tone: "mint", delta };
  if (delta < -band) return { verdict: "below", label: "Focus area · below class average", tone: "peach", delta };
  return { verdict: "at_par", label: "About the same as class", tone: "sky", delta };
}

export type PercentileBand = "top_quarter" | "middle" | "bottom_quarter" | "unknown";

export interface PercentileResult {
  band: PercentileBand;
  /** A band, never an exact rank — avoids student-vs-student pressure. */
  label: string;
  /** Compact label for a tile/chip (e.g. "Top quarter", "Middle", "Focus area"). */
  short: string;
  tone: Tone;
}

/**
 * Map a percentile (0–100, e.g. cume_dist×100 from student_exam_class_comparison)
 * to a calm class band. Returns "unknown" when the cohort is too small to be fair.
 */
export function percentileToBand(
  percentile: number | null | undefined,
  cohortSize: number | null | undefined,
): PercentileResult {
  if (percentile == null || cohortSize == null || cohortSize < MIN_COHORT_FOR_BAND) {
    return { band: "unknown", label: "Not enough classmates to compare", short: "Not ranked", tone: "sky" };
  }
  if (percentile >= TOP_QUARTILE) return { band: "top_quarter", label: "Top quarter of the class", short: "Top quarter", tone: "mint" };
  if (percentile <= BOTTOM_QUARTILE) return { band: "bottom_quarter", label: "Focus area · bottom quarter", short: "Focus area", tone: "peach" };
  return { band: "middle", label: "Middle of the class", short: "Middle", tone: "sky" };
}

export type TrendDirection = "up" | "down" | "flat" | "none";

export interface TrendResult {
  direction: TrendDirection;
  label: string;
  tone: Tone;
  /** latest − previous, rounded 1dp; null when there aren't two tests to compare. */
  delta: number | null;
}

/** "Improved / declined since last test" label for the score-trend line. */
export function compareLatestToPrevious(
  latest: number | null | undefined,
  previous: number | null | undefined,
): TrendResult {
  if (latest == null || previous == null) {
    return { direction: "none", label: "Not enough tests yet to compare", tone: "sky", delta: null };
  }
  const delta = Math.round((latest - previous) * 10) / 10;
  if (delta >= TREND_FLAT_BAND) {
    return { direction: "up", label: `Improved ${delta}% since last test`, tone: "mint", delta };
  }
  if (delta <= -TREND_FLAT_BAND) {
    return { direction: "down", label: `Down ${Math.abs(delta)}% since last test`, tone: "peach", delta };
  }
  return { direction: "flat", label: "About the same as last test", tone: "sky", delta };
}

export interface AttendanceLabelResult {
  /** true when attendance is below threshold — caller should tint the tile red (rose). */
  warn: boolean;
  label: string | null;
  tone: Tone;
}

/**
 * Attendance label. Only shows a warning when below threshold (spec: no negative
 * messaging otherwise) — at/above threshold returns a calm positive line.
 *
 * `periodPhrase` lets a caller that shows a selectable window say "in the last 3
 * months" instead of "this month". It defaults to "this month" so the month-scoped
 * callers (the status-strip tile) read exactly as before.
 */
export function attendanceLabel(
  percentage: number | null | undefined,
  periodPhrase: string = "this month",
): AttendanceLabelResult {
  if (percentage == null) {
    return { warn: false, label: `No attendance recorded yet ${periodPhrase}`, tone: "sky" };
  }
  if (percentage < ATTENDANCE_WARN_THRESHOLD) {
    return {
      warn: true,
      label: `Attendance is below ${ATTENDANCE_WARN_THRESHOLD}% ${periodPhrase} · needs attention`,
      tone: "rose",
    };
  }
  return { warn: false, label: `Attendance is on track ${periodPhrase}`, tone: "mint" };
}

export type PerformanceBand =
  | "excellent"
  | "very_good"
  | "good"
  | "developing"
  | "needs_attention";

export interface PerformanceBandResult {
  band: PerformanceBand;
  label: string;
  tone: Tone;
}

/** Overall performance band for a percentage (mirrors the legacy getPerformanceStatus cutoffs). */
export function performanceBand(percentage: number | null | undefined): PerformanceBandResult {
  const p = percentage ?? 0;
  if (p >= 85) return { band: "excellent", label: "Excellent", tone: "mint" };
  if (p >= 75) return { band: "very_good", label: "Very good", tone: "mint" };
  if (p >= 65) return { band: "good", label: "Good", tone: "sky" };
  if (p >= 50) return { band: "developing", label: "Developing", tone: "peach" };
  return { band: "needs_attention", label: "Needs attention", tone: "peach" };
}
