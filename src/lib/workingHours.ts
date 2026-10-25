/**
 * Support working hours: 10:00 to 18:00, Monday to Saturday, Asia/Kolkata.
 *
 * The Ticket Resolution SOP (September 2026) measures every ticket on this
 * clock, not on wall-clock time: a ticket filed at 20:30 and closed at 10:15
 * the next morning is a 15-minute ticket. These helpers are pure so the same
 * arithmetic can order the inbox, label a row's age and, once the database
 * carries the paused interval, agree with the server's figure.
 *
 * Timezone: the SALCI support desk is in India, and IST has no daylight
 * saving, so a fixed +05:30 shift and UTC getters are exact. If the desk ever
 * moves to a zone with DST this must switch to Intl-based local time, the same
 * caveat CLAUDE.md §24 records for attendance cut-offs.
 */

import type { AgeParts } from "./formatAge";

export const SUPPORT_HOURS = {
  /** First working hour of the day, 24h clock, local time. */
  start: 10,
  /** Hour the desk closes, exclusive, local time. */
  end: 18,
  /** ISO weekday numbers that are working days: Monday (1) to Saturday (6). */
  workingDays: [1, 2, 3, 4, 5, 6] as readonly number[],
  utcOffsetMinutes: 330,
  timezone: "Asia/Kolkata",
} as const;

/** Working hours in one working day; the SOP counts days at this length. */
export const WORKING_HOURS_PER_DAY = SUPPORT_HOURS.end - SUPPORT_HOURS.start;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const OFFSET_MS = SUPPORT_HOURS.utcOffsetMinutes * MS_PER_MINUTE;

/** Epoch milliseconds shifted so that UTC getters read IST wall-clock values. */
function toLocalMs(ms: number): number {
  return ms + OFFSET_MS;
}

function localDayStart(localMs: number): number {
  return Math.floor(localMs / MS_PER_DAY) * MS_PER_DAY;
}

function isWorkingDay(localDayStartMs: number): boolean {
  // getUTCDay on a shifted timestamp is the local weekday: 0 Sunday .. 6 Saturday.
  const weekday = new Date(localDayStartMs).getUTCDay();
  return SUPPORT_HOURS.workingDays.includes(weekday);
}

/**
 * Working seconds between two instants. Zero when `to` is not after `from`.
 * Sums, per local calendar day, the overlap of [from, to) with the desk's
 * open window on that day, skipping days the desk is closed.
 */
export function workingSecondsBetween(fromIso: string | Date, toIso: string | Date): number {
  const fromMs = toLocalMs(new Date(fromIso).getTime());
  const toMs = toLocalMs(new Date(toIso).getTime());
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;

  let total = 0;
  for (let day = localDayStart(fromMs); day < toMs; day += MS_PER_DAY) {
    if (!isWorkingDay(day)) continue;
    const open = day + SUPPORT_HOURS.start * MS_PER_HOUR;
    const close = day + SUPPORT_HOURS.end * MS_PER_HOUR;
    const overlap = Math.min(toMs, close) - Math.max(fromMs, open);
    if (overlap > 0) total += overlap;
  }
  return Math.round(total / 1000);
}

/** Working hours elapsed since `iso`, as a decimal (2.5 = two and a half hours). */
export function workingHoursSince(iso: string | Date, now: Date = new Date()): number {
  return workingSecondsBetween(iso, now) / 3600;
}

/** True once more than `hours` working hours have passed since `iso`. */
export function isPastWorkingHours(iso: string | Date, now: Date, hours: number): boolean {
  return workingHoursSince(iso, now) > hours;
}

/**
 * A working-hours figure split into number and unit, so a headline can set the
 * two at different sizes. Same steps and same words as `formatWorkingAge`,
 * which is written in terms of this, so a headline and a fact line can never
 * spell the same duration differently. Null in, null out, like
 * `formatAgeParts`, so a caller can hide the line.
 */
export function formatWorkingAgeParts(hours: number | null | undefined): AgeParts | null {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return null;
  if (hours < 1) {
    const minutes = Math.max(0, Math.round(hours * 60));
    return { value: String(minutes), unit: minutes === 1 ? "working minute" : "working minutes" };
  }
  if (hours < WORKING_HOURS_PER_DAY) {
    const whole = Math.floor(hours);
    return { value: String(whole), unit: whole === 1 ? "working hour" : "working hours" };
  }
  const days = Math.floor(hours / WORKING_HOURS_PER_DAY);
  return { value: String(days), unit: days === 1 ? "working day" : "working days" };
}

/**
 * Human label for a working-hours figure. Under one working day it speaks in
 * hours, otherwise in working days of eight hours, so "3 working days" means
 * three desk days, not 72 wall-clock hours. Never use the calendar formatter
 * (`formatAge`) for SOP figures: the two would disagree on every row.
 */
export function formatWorkingAge(hours: number): string {
  const parts = formatWorkingAgeParts(hours);
  if (!parts) return "";
  return `${parts.value} ${parts.unit}`;
}
