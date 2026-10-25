/**
 * Pure helpers for the hybrid evaluation mark-pad.
 * No React, no Supabase — trivially reviewable and (if a runner lands) testable.
 */

/**
 * Discrete mark options for a question, in 0.5 steps from 0 up to and
 * including its max. A non-half-step max (rare) still ends exactly at max.
 * e.g. buildMarkSteps(2) -> [0, 0.5, 1, 1.5, 2]; buildMarkSteps(1.5) -> [0, 0.5, 1, 1.5].
 */
export function buildMarkSteps(maxMarks: number): number[] {
  if (!Number.isFinite(maxMarks) || maxMarks <= 0) return [0];
  const steps: number[] = [];
  for (let v = 0; v <= maxMarks + 1e-9; v += 0.5) {
    steps.push(Math.round(v * 2) / 2);
  }
  const last = steps[steps.length - 1];
  if (last < maxMarks - 1e-9) {
    steps.push(Math.round(maxMarks * 100) / 100);
  }
  return steps;
}

/**
 * Largest mark the teacher may give the active question without (a) exceeding
 * that question's max or (b) pushing the running total past the exam total.
 * `awardedOthers` = sum already awarded to OTHER questions (excludes active).
 */
export function maxSelectableForActive(
  questionMax: number,
  examTotal: number | null,
  awardedOthers: number,
): number {
  const byTotal = examTotal === null ? Infinity : Math.max(0, examTotal - awardedOthers);
  return Math.min(questionMax, byTotal);
}