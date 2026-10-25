/**
 * Exam slot booking: which times a class section already has taken, and whether
 * the exam being scheduled would clash with them.
 *
 * The server is the source of truth (migration 20260928170000):
 *   - get_exam_slot_bookings returns the booked slots, filtered to the sections
 *     the caller may see (a class's own teachers, its wing coordinator, its
 *     school admins). Never read exams / exam_classes directly for this: RLS
 *     lets every member of a school read every exam row.
 *   - the exams_slot_guard triggers refuse any publish or reschedule that
 *     overlaps, race-safely, so this file only PREVIEWS; it never decides.
 *
 * What this file does: parse the RPC payload, compute the teacher's own
 * proposed window (mirroring public.exam_slot_occupied_until), and do the
 * interval maths for the timeline, the clash card and the free-time chips.
 * Every window is half-open [start, occupiedUntil), so back-to-back is free.
 */
import { computeExamSchedule } from "@/lib/examSchedule";

/** Raw booking row as the RPC returns it. Kept plain JSON (ISO strings, no
 * Dates) because query data is persisted and restored as JSON. */
export interface ExamSlotBookingRow {
  class_id: string;
  exam_id: string;
  is_own: boolean;
  /** Only set for the caller's own exams. */
  title: string | null;
  subject_names: string | null;
  /** Null for the caller's own exams. */
  teacher_name: string | null;
  exam_mode: string;
  status: string;
  starts_at: string;
  entry_deadline: string | null;
  occupied_until: string;
  /** Same optional group as the exam being scheduled: runs alongside, no clash. */
  runs_alongside: boolean;
}

export interface ExamSlotClassRow {
  class_id: string;
  name: string;
  section: string | null;
  /** False when the caller has no authority over this section: its bookings
   * are withheld, but the server still checks it on publish. */
  authorized: boolean;
}

export interface ExamSlotBookingsPayload {
  classes: ExamSlotClassRow[];
  bookings: ExamSlotBookingRow[];
}

export interface ExamSlotBooking {
  classId: string;
  examId: string;
  isOwn: boolean;
  title: string | null;
  subjectNames: string | null;
  teacherName: string | null;
  mode: string;
  status: string;
  start: Date;
  entryDeadline: Date | null;
  occupiedUntil: Date;
  runsAlongside: boolean;
}

export interface TimeInterval {
  start: Date;
  end: Date;
}

export function parseSlotBookings(rows: ExamSlotBookingRow[]): ExamSlotBooking[] {
  return rows
    .map((r) => ({
      classId: r.class_id,
      examId: r.exam_id,
      isOwn: r.is_own === true,
      title: r.title,
      subjectNames: r.subject_names,
      teacherName: r.teacher_name,
      mode: r.exam_mode,
      status: r.status,
      start: new Date(r.starts_at),
      entryDeadline: r.entry_deadline ? new Date(r.entry_deadline) : null,
      occupiedUntil: new Date(r.occupied_until),
      runsAlongside: r.runs_alongside === true,
    }))
    .filter((b) => Number.isFinite(b.start.getTime()) && Number.isFinite(b.occupiedUntil.getTime()));
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

/** Default phone-upload window when a hybrid exam has no settings row, as the
 * upload edge functions assume. */
const DEFAULT_HYBRID_GRACE_MINUTES = 5;

/**
 * Mirror of public.exam_slot_occupied_until. Keep the two identical.
 *   - late entry > 0: the exam ends at end_time (start + late entry + duration).
 *   - late entry 0 / unset: no dedicated join window, so students may join until
 *     end_time (student_eligible_exams). Online attempts are then capped at
 *     end_time (exam_attempt_remaining_seconds), so the exam still ends there;
 *     hybrid attempts are not capped, so a late joiner runs to end_time +
 *     duration. With no end_time at all there is no cap either.
 *   - hybrid: plus each student's phone upload window.
 */
export function examSlotOccupiedUntil(input: {
  start: Date;
  end: Date | null;
  lateEntryMinutes: number | null;
  durationMinutes: number | null;
  mode: string;
  graceMinutes?: number | null;
}): Date {
  const late = input.lateEntryMinutes ?? 0;
  const duration = input.durationMinutes ?? 0;
  let until = input.end ?? addMinutes(input.start, late + duration);
  if (late <= 0 && (input.mode === "hybrid" || input.end === null)) {
    until = addMinutes(until, duration);
  }
  if (input.mode === "hybrid") {
    until = addMinutes(until, input.graceMinutes ?? DEFAULT_HYBRID_GRACE_MINUTES);
  }
  const floor = addMinutes(input.start, 1);
  return until.getTime() < floor.getTime() ? floor : until;
}

export interface ProposedExamSlot {
  start: Date;
  /** Last moment a student may start. */
  entryDeadline: Date;
  /** When the exam stops holding its students. */
  occupiedUntil: Date;
  lateEntryMinutes: number;
  lengthMinutes: number;
}

/** The window the exam being scheduled would hold, or null until the date,
 * start time and duration are all set. */
export function proposedExamSlot(input: {
  scheduledDate: Date | null;
  startTime: string;
  durationMinutes: number | null;
  lateEntryMinutes?: number | null;
  examMode: string;
  graceMinutes?: number | null;
}): ProposedExamSlot | null {
  const schedule = computeExamSchedule({
    scheduledDate: input.scheduledDate,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    lateEntryMinutes: input.lateEntryMinutes,
  });
  if (!schedule.start || !schedule.end || !schedule.entryDeadline) return null;
  const occupiedUntil = examSlotOccupiedUntil({
    start: schedule.start,
    end: schedule.end,
    lateEntryMinutes: schedule.lateEntryMinutes,
    durationMinutes: input.durationMinutes,
    mode: input.examMode,
    graceMinutes: input.graceMinutes,
  });
  // A 0 late-entry window lets students join until the end time (see above).
  const entryDeadline = schedule.lateEntryMinutes > 0 ? schedule.entryDeadline : schedule.end;
  return {
    start: schedule.start,
    entryDeadline,
    occupiedUntil,
    lateEntryMinutes: schedule.lateEntryMinutes,
    lengthMinutes: Math.round((occupiedUntil.getTime() - schedule.start.getTime()) / 60_000),
  };
}

/** Half-open overlap: [aStart, aEnd) and [bStart, bEnd). */
export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** Bookings the proposed slot collides with. Optional-group alternatives never clash. */
export function findSlotClashes(
  bookings: ExamSlotBooking[],
  slot: TimeInterval | null,
): ExamSlotBooking[] {
  if (!slot) return [];
  return bookings.filter(
    (b) => !b.runsAlongside && intervalsOverlap(slot, { start: b.start, end: b.occupiedUntil }),
  );
}

/** Bookings that touch the local calendar day starting at `dayStart`. */
export function bookingsOnDay(bookings: ExamSlotBooking[], dayStart: Date): ExamSlotBooking[] {
  const day = { start: dayStart, end: addDays(dayStart, 1) };
  return bookings.filter((b) => intervalsOverlap(day, { start: b.start, end: b.occupiedUntil }));
}

/**
 * Up to `count` start times on the given day at which an exam of
 * `lengthMinutes` fits around every blocking interval, closest to `preferred`
 * first, returned in time order. Candidates are the edges of each free gap
 * (the first start "right after Hindi ends" and the last start that still
 * finishes before the next exam) plus the first free time after `preferred`,
 * so the chips read as real choices on both sides of the clash rather than
 * 5-minute nudges or the crack of dawn.
 */
export function suggestFreeStarts(input: {
  blocking: TimeInterval[];
  dayStart: Date;
  lengthMinutes: number;
  preferred: Date | null;
  notBefore?: Date | null;
  count?: number;
  earliestHour?: number;
  latestStartHour?: number;
  stepMinutes?: number;
}): Date[] {
  const {
    blocking,
    dayStart,
    lengthMinutes,
    preferred,
    notBefore = null,
    count = 3,
    earliestHour = 6,
    latestStartHour = 22,
    stepMinutes = 5,
  } = input;
  if (lengthMinutes <= 0) return [];

  const stepMs = stepMinutes * 60_000;
  let first = addMinutes(dayStart, earliestHour * 60).getTime();
  if (notBefore && notBefore.getTime() > first) {
    first = Math.ceil(notBefore.getTime() / stepMs) * stepMs;
  }
  const last = addMinutes(dayStart, latestStartHour * 60).getTime();

  const isFree = (t: number) => {
    const slot = { start: new Date(t), end: new Date(t + lengthMinutes * 60_000) };
    return !blocking.some((b) => intervalsOverlap(slot, b));
  };

  const edges: number[] = [];
  let firstAfterPreferred: number | null = null;
  let prevFree = false;
  let prevT = first;
  for (let t = first; t <= last; t += stepMs) {
    const free = isFree(t);
    if (free && !prevFree) edges.push(t);
    if (!free && prevFree) edges.push(prevT);
    if (free && firstAfterPreferred === null && preferred && t >= preferred.getTime()) {
      firstAfterPreferred = t;
    }
    prevFree = free;
    prevT = t;
  }
  if (prevFree) edges.push(prevT);

  const candidates = new Set<number>(edges);
  if (firstAfterPreferred !== null) candidates.add(firstAfterPreferred);
  const anchor = preferred ? preferred.getTime() : first;
  return Array.from(candidates)
    .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b)
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((t) => new Date(t));
}

/** Merge overlapping intervals, for drawing one busy band per lane. */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: TimeInterval[] = [];
  for (const i of sorted) {
    const prev = out[out.length - 1];
    if (prev && i.start.getTime() <= prev.end.getTime()) {
      if (i.end.getTime() > prev.end.getTime()) prev.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local midnight of the given moment. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** "YYYY-MM-DD" from local getters. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** Local midnight for a "YYYY-MM-DD" key, or null for anything else. */
export function localDayFromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "HH:MM" for a Date, local time. */
export function toTimeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * The server's guard error (P0001, HINT exam_slot_conflict). PostgREST errors
 * keep `hint`; the message prefix is the fallback for anything that drops it.
 */
export function isExamSlotConflictError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { hint?: unknown; message?: unknown };
  if (e.hint === "exam_slot_conflict") return true;
  return typeof e.message === "string" && /^Time clash:/.test(e.message);
}
