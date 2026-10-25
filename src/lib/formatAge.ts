/**
 * Humane duration for a number of hours, for at-a-glance ops copy.
 *
 * Steps are chosen so a reader never has to divide: under two days in hours,
 * under two weeks in days, under eight weeks in weeks, then months.
 *   2872 h -> "4 months", 571 h -> "3 weeks", 297 h -> "12 days", 30 h -> "30 hours"
 * Full words, one vocabulary for every card: a headline "5 weeks" and a fact
 * line "Oldest has waited 4 months" must never disagree on how a unit is spelt.
 * Returns null for null/undefined/NaN so callers can hide the line.
 */
export interface AgeParts {
  /** The number as text ("<1" for under an hour). */
  value: string;
  /** The unit as it reads next to the number: "hour(s)", "days", "weeks", "month(s)". */
  unit: string;
}

/**
 * The same steps as formatAge, split into number and unit so a headline can
 * set them at two sizes. Same null contract.
 */
export function formatAgeParts(hours: number | null | undefined): AgeParts | null {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return null;
  const h = Math.max(0, hours);
  if (h < 1) return { value: "<1", unit: "hour" };
  if (h < 48) {
    const n = Math.round(h);
    return { value: String(n), unit: n === 1 ? "hour" : "hours" };
  }
  if (h < 14 * 24) return { value: String(Math.round(h / 24)), unit: "days" };
  if (h < 8 * 7 * 24) return { value: String(Math.round(h / 168)), unit: "weeks" };
  const months = Math.round(h / 730);
  return { value: String(months), unit: months === 1 ? "month" : "months" };
}

export function formatAge(hours: number | null | undefined): string | null {
  const parts = formatAgeParts(hours);
  if (!parts) return null;
  if (parts.value === "<1") return "under an hour";
  return `${parts.value} ${parts.unit}`;
}
