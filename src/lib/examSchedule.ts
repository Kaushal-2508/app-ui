/**
 * Single source of truth for exam scheduling windows.
 *
 * THREE distinct moments — collapsing them into one is what broke late entry:
 *
 *   1. start_time      — when the exam opens.
 *   2. entry deadline  — start + lateEntryMinutes. The last moment a student may
 *                        JOIN. Stored on `exams.late_entry_minutes` (+ mirrored to
 *                        `availability_end`).
 *   3. end_time        — start + lateEntryMinutes + duration. The last possible
 *                        FINISH: the latest joiner still gets their full duration.
 *
 * Every student's personal deadline is `started_at + duration_minutes` (that is what
 * the attempt timer and `close_stale_exam_attempts_sweep` both use), so `end_time`
 * MUST include the late-entry window. When end_time was computed as
 * `start + duration`, the entry gate closed at the exam's own end: a student who
 * joined 10 minutes late lost those 10 minutes, and a 180-minute late-entry window
 * was silently ignored.
 *
 * All math runs on real Date objects so windows that cross midnight stay correct
 * (the old "HH:MM" string math wrapped with % 24 and produced an end BEFORE the
 * start, instantly expiring the exam).
 */

/** Ceiling for the late-entry window (24 h). */
export const MAX_LATE_ENTRY_MINUTES = 1440;

/** Default late-entry window offered in the publish sheet. */
export const DEFAULT_LATE_ENTRY_MINUTES = 15;

export interface ExamScheduleInput {
  scheduledDate: Date | null;
  /** "HH:MM" from the publish sheet. */
  startTime: string;
  durationMinutes: number | null;
  lateEntryMinutes?: number | null;
}

export interface ExamScheduleWindow {
  /** Exam opens. */
  start: Date | null;
  /** Last moment a student may join (start + lateEntry). */
  entryDeadline: Date | null;
  /** Last possible finish (start + lateEntry + duration). */
  end: Date | null;
  /** Normalised late-entry window actually used. */
  lateEntryMinutes: number;
}

/** Clamp any user input to a whole number of minutes within [0, MAX]. */
export function clampLateEntryMinutes(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_LATE_ENTRY_MINUTES, Math.round(n));
}

/** Combine a calendar date with an "HH:MM" clock time into a Date. */
export function combineExamDateTime(
  date: Date | null,
  time: string,
): Date | null {
  if (!date || !time) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const combined = new Date(date);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

/**
 * Resolve the full window from the exam-creation form values.
 *
 * An UNSET late-entry window resolves to the default the publish sheet shows
 * (not 0) — a silent 0 collapsed the join window onto the start time and every
 * student saw the exam as instantly expired. An EXPLICIT 0 is preserved (`??`
 * keeps it) and is interpreted downstream as "no dedicated join window", which
 * falls back to the legacy gate rather than locking everyone out.
 */
export function computeExamSchedule(input: ExamScheduleInput): ExamScheduleWindow {
  const lateEntryMinutes = clampLateEntryMinutes(
    input.lateEntryMinutes ?? DEFAULT_LATE_ENTRY_MINUTES,
  );
  const start = combineExamDateTime(input.scheduledDate, input.startTime);
  if (!start) {
    return { start: null, entryDeadline: null, end: null, lateEntryMinutes };
  }
  const entryDeadline = addMinutes(start, lateEntryMinutes);
  const duration = Number(input.durationMinutes);
  const end = Number.isFinite(duration) && duration > 0
    ? addMinutes(entryDeadline, duration)
    : null;
  return { start, entryDeadline, end, lateEntryMinutes };
}

/** The exam-row time columns, ready to write. */
export interface ExamScheduleColumns {
  start_time: string | null;
  end_time: string | null;
  availability_start: string | null;
  availability_end: string | null;
  late_entry_minutes: number | null;
}

/**
 * Map the window onto the `exams` columns. `availability_end` mirrors the entry
 * deadline (kept in sync for legacy readers); `late_entry_minutes` is the
 * authoritative value the eligibility view gates on.
 */
export function examScheduleColumns(input: ExamScheduleInput): ExamScheduleColumns {
  const { start, entryDeadline, end, lateEntryMinutes } = computeExamSchedule(input);
  return {
    start_time: start ? start.toISOString() : null,
    end_time: end ? end.toISOString() : null,
    availability_start: start ? start.toISOString() : null,
    availability_end: entryDeadline ? entryDeadline.toISOString() : null,
    late_entry_minutes: start ? lateEntryMinutes : null,
  };
}

/** "HH:MM" for compact schedule summaries. */
export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * "HH:MM", suffixed when the moment lands on a later calendar day than the
 * exam start — otherwise a window crossing midnight reads as if it ends earlier
 * than it began.
 */
export function formatClockWithDayOffset(date: Date, reference: Date): string {
  const dayDiff = Math.round(
    (new Date(date).setHours(0, 0, 0, 0) -
      new Date(reference).setHours(0, 0, 0, 0)) /
      86_400_000,
  );
  const clock = formatClock(date);
  if (dayDiff <= 0) return clock;
  return dayDiff === 1 ? `${clock} (next day)` : `${clock} (+${dayDiff} days)`;
}
