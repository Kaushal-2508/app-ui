/**
 * Pure rolling-period math for the Teacher Targets UI. No I/O.
 *
 * This mirrors `public.tgt_periods` (supabase/migrations/20260915120200_teacher_targets_counters.sql)
 * exactly, so a create-target form can preview periods without a round trip
 * to the database, and the preview never disagrees with what the nightly
 * evaluator actually measures.
 *
 * MONTH-CLAMPING CONTRACT (binding, measured against prod). Postgres
 * `date + interval 'N months'` CLAMPS to the last day of the target month
 * when the anchor day-of-month doesn't exist there: 2026-01-31 + 1 month =
 * 2026-02-28 (2026 is not a leap year), never a rollover into March. Every
 * period boundary below is computed FRESH FROM THE ORIGINAL ANCHOR
 * (`startsOn + k * interval`), never by stepping from the previous period's
 * already-clamped result — a step-by-step implementation looks right for two
 * periods and silently diverges from the SQL at period 3 onward. Measured
 * acceptance values for a monthly target anchored 2026-01-31, ending
 * 2026-04-30: period 1 2026-01-31..2026-02-27, period 2 2026-02-28..2026-03-30,
 * period 3 2026-03-31..2026-04-29, period 4 2026-04-30..2026-04-30 (clipped).
 *
 * TIMEZONE. All arithmetic runs in UTC internally so it is stable regardless
 * of the browser's local timezone. Any input Date is first normalised to a
 * UTC-midnight instant carrying that Date's LOCAL calendar day (`toDateOnly`)
 * — this is a no-op for a Date already produced by `parseDateOnly` below, and
 * correctly captures "the day the user picked" for a Date coming out of a
 * date-picker component (which construct local midnight).
 */

export type CadenceUnit = "day" | "week" | "month";
export type TargetMetric = "exams_published" | "homework_published";

export interface TargetPeriodBounds {
  index: number;
  start: Date;
  end: Date;
}

/** Normalises any Date to a UTC-midnight instant carrying its local calendar day. */
function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Parses a "YYYY-MM-DD" string (as returned by a `date` column) into a UTC-midnight Date. */
export function parseDateOnly(value: string): Date {
  const [y, m, day] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

/** Formats a Date back to "YYYY-MM-DD" for sending to an RPC, using its UTC calendar fields. */
export function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastDayOfMonth(year: number, monthIndex0: number): number {
  // Day 0 of the following month is the last day of monthIndex0.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Adds `unit * n * times` to `anchor`, matching Postgres `date + interval`
 * semantics. Called fresh from the anchor for every period boundary — see the
 * module comment for why chaining from a prior result is wrong.
 */
function addFromAnchor(anchor: Date, unit: CadenceUnit, n: number, times: number): Date {
  const amount = n * times;
  if (unit === "day") {
    const d = new Date(anchor.getTime());
    d.setUTCDate(d.getUTCDate() + amount);
    return d;
  }
  if (unit === "week") {
    const d = new Date(anchor.getTime());
    d.setUTCDate(d.getUTCDate() + amount * 7);
    return d;
  }
  // month: clamp to the last day of the target month.
  const anchorDay = anchor.getUTCDate();
  const totalMonths = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + amount;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(anchorDay, lastDayOfMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, day));
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Rolling periods counted from day 1, matching `public.tgt_periods`. Period k
 * runs from `startsOn + (k-1)` intervals to the day before `startsOn + k`
 * intervals, clipped at `endsOn`. A null cadence is one period spanning the
 * whole range. `upto` bounds how far to generate (defaults to `endsOn`);
 * capped at 500 periods, matching the SQL guard.
 */
export function periodsFor(
  startsOn: Date,
  endsOn: Date,
  unit: CadenceUnit | null,
  n: number | null,
  upto?: Date,
): TargetPeriodBounds[] {
  const start0 = toDateOnly(startsOn);
  const end0 = toDateOnly(endsOn);
  const upto0 = upto ? toDateOnly(upto) : end0;

  if (!unit || !n) {
    return start0 <= upto0 ? [{ index: 1, start: start0, end: end0 }] : [];
  }

  const out: TargetPeriodBounds[] = [];
  for (let i = 1; i <= 500; i += 1) {
    const start = addFromAnchor(start0, unit, n, i - 1);
    if (start > end0 || start > upto0) break;
    const nextStart = addFromAnchor(start0, unit, n, i);
    const end = addDays(nextStart, -1);
    out.push({ index: i, start, end: end > end0 ? end0 : end });
  }
  return out;
}

/**
 * The period covering `today` (or the last period, if today is past the
 * range's end). Returns null when the range has not started yet or yields no
 * periods at all. Used to show "which period are we in" in a preview without
 * a round trip.
 */
export function currentPeriod(
  startsOn: Date,
  endsOn: Date,
  unit: CadenceUnit | null,
  n: number | null,
  today: Date = new Date(),
): TargetPeriodBounds | null {
  const end0 = toDateOnly(endsOn);
  const today0 = toDateOnly(today);
  const upto = today0 > end0 ? end0 : today0;
  const periods = periodsFor(startsOn, endsOn, unit, n, upto);
  if (periods.length === 0) return null;
  return periods[periods.length - 1];
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Human display for a Date, e.g. "31 Jan 2026". Reads UTC calendar fields, not
 * the browser's local ones, so it agrees with `parseDateOnly`/`formatDateOnly`
 * regardless of the viewer's timezone offset. Shared by every Teacher Targets
 * surface (create-target preview, progress cards, teacher history) so a
 * period's dates render identically everywhere.
 */
export function formatDisplayDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "period_start to period_end" using the shared display format, for an
 *  already-fetched period row (whose dates are "YYYY-MM-DD" strings). */
export function formatPeriodRange(startIso: string, endIso: string): string {
  return `${formatDisplayDate(parseDateOnly(startIso))} to ${formatDisplayDate(parseDateOnly(endIso))}`;
}

/** Human label for a cadence, e.g. "Every 15 days". Null cadence (a one-off
 *  range target) reads "One-off". Falls back to a generic "Every N units" for
 *  any combination outside the five presets the create form offers, since a
 *  target created before a preset changes must still render sensibly. */
export function cadenceLabel(unit: CadenceUnit | null, n: number | null): string {
  if (!unit || !n) return "One-off";
  if (unit === "day") {
    if (n === 15) return "Every 15 days";
    return n === 1 ? "Daily" : `Every ${n} days`;
  }
  if (unit === "week") return n === 1 ? "Weekly" : `Every ${n} weeks`;
  if (n === 3) return "Quarterly";
  return n === 1 ? "Monthly" : `Every ${n} months`;
}
