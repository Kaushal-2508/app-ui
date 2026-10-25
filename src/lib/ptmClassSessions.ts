import { format } from "date-fns";

import { buildSlotGrid, formatTimeRange, ptmBusyWindow, teacherWindowError, timeToMinutes, windowsOverlap } from "@/lib/ptm";

/**
 * Class sessions of an admin- or coordinator-made online PTM (Naman,
 * 2026-10-06: "when a single class is chosen a new box appears with the
 * teachers of that class ... if a teacher is already selected they cannot be
 * reselected, greyed, teacher is already busy"). Each chosen class is one
 * session with its own hours inside the meeting and its own teachers; a
 * teacher may sit in two sessions only when their hours do not overlap, gap
 * included. Pure, so the permutation table in
 * docs/superpowers/specs/2026-10-06-ptm-online-class-sessions-design.md can
 * be asserted in node. Nothing here touches React or the network.
 */

export interface ClassSessionDraft {
  classId: string;
  /** Own hours; both empty = the meeting's hours. */
  startTime: string;
  endTime: string;
  teacherIds: string[];
}

/** Students are never picked by the admin (Naman, 2026-10-06: "to select
 *  students, give this option in hand of teachers"): the teachers of a session
 *  pick them afterwards, from the PTM's Edit, and a student may be on several
 *  teachers' lists (2026-10-09). */

export interface MeetingHours {
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  slotBufferMinutes: number;
}

/** The shape of `ptm_teacher_busy_windows` rows this helper reads. */
export interface BusyLike {
  teacher_id: string;
  ptm_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
}

/** A `ptm_online_sessions` row, as much of it as the editor reads. */
export interface SessionRowLike {
  teacher_id: string;
  class_session_id?: string | null;
  class_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

/** The class sessions of an existing PTM as the editor holds them, from
 *  the session rows (one per session and teacher). Rows without a class
 *  (today's flat server) are skipped. */
export function draftsFromSessions(rows: SessionRowLike[]): ClassSessionDraft[] {
  const map = new Map<string, ClassSessionDraft>();
  for (const r of rows) {
    if (!r.class_id) continue;
    const d = map.get(r.class_id) ?? {
      classId: r.class_id,
      startTime: r.start_time ? r.start_time.slice(0, 5) : "",
      endTime: r.end_time ? r.end_time.slice(0, 5) : "",
      teacherIds: [],
    };
    if (!d.teacherIds.includes(r.teacher_id)) d.teacherIds.push(r.teacher_id);
    map.set(r.class_id, d);
  }
  return [...map.values()];
}

export function newClassSession(classId: string): ClassSessionDraft {
  return { classId, startTime: "", endTime: "", teacherIds: [] };
}

export function sessionHasOwnHours(d: Pick<ClassSessionDraft, "startTime" | "endTime">): boolean {
  return !!(d.startTime || d.endTime);
}

/** The hours a session runs: its own when set, else the meeting's. */
export function sessionHours(
  d: Pick<ClassSessionDraft, "startTime" | "endTime">,
  meeting: Pick<MeetingHours, "startTime" | "endTime">,
): { startTime: string; endTime: string } {
  return sessionHasOwnHours(d)
    ? { startTime: d.startTime, endTime: d.endTime }
    : { startTime: meeting.startTime, endTime: meeting.endTime };
}

/** Why a session's own hours are unusable, or null (the meeting's hours are
 *  always fine, the form validates them separately). */
export function sessionHoursError(d: Pick<ClassSessionDraft, "startTime" | "endTime">, meeting: MeetingHours): string | null {
  if (!sessionHasOwnHours(d)) return null;
  return teacherWindowError({ startTime: d.startTime, endTime: d.endTime }, meeting);
}

export function sessionSlotCount(d: Pick<ClassSessionDraft, "startTime" | "endTime">, meeting: MeetingHours): number {
  if (sessionHoursError(d, meeting)) return 0;
  const h = sessionHours(d, meeting);
  return buildSlotGrid(h.startTime, h.endTime, meeting.slotDurationMinutes, meeting.slotBufferMinutes).length;
}

/** The minutes a session holds its teachers: [start, end + gap). Null while
 *  the hours are not usable. */
function heldMinutes(d: Pick<ClassSessionDraft, "startTime" | "endTime">, meeting: MeetingHours): { start: number; end: number } | null {
  const h = sessionHours(d, meeting);
  const start = timeToMinutes(h.startTime);
  const end = timeToMinutes(h.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end: end + Math.max(0, meeting.slotBufferMinutes) };
}

/** True when two sessions overlap in time, gap included (the same half-open
 *  rule as the server's busy guard). Sessions with unusable hours never clash;
 *  their own error already blocks Create. */
export function sessionsClash(a: Pick<ClassSessionDraft, "startTime" | "endTime">, b: Pick<ClassSessionDraft, "startTime" | "endTime">, meeting: MeetingHours): boolean {
  const x = heldMinutes(a, meeting);
  const y = heldMinutes(b, meeting);
  if (!x || !y) return false;
  return x.start < y.end && y.start < x.end;
}

function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : format(at, "h:mm a");
}

/** "Busy 3:00 PM to 5:05 PM with "Hostel PTM 6B"", the one wording for a
 *  teacher held by another PTM, shared by the box picker and the sheet's errors. */
export function busyLabel(b: BusyLike): string {
  return `Busy ${clock(b.starts_at)} to ${clock(b.ends_at)} with "${b.title}"`;
}

/** The other PTMs holding a teacher during a session's hours (plus gap).
 *  Empty when the date is not known yet: nothing to compare against. */
export function busyDuring(
  teacherId: string,
  d: Pick<ClassSessionDraft, "startTime" | "endTime">,
  meeting: MeetingHours,
  date: string,
  busy: BusyLike[],
): BusyLike[] {
  if (!date || sessionHoursError(d, meeting)) return [];
  const h = sessionHours(d, meeting);
  if (!h.startTime || !h.endTime) return [];
  const held = ptmBusyWindow({
    scheduled_date: date,
    start_time: h.startTime,
    end_time: h.endTime,
    slot_buffer_minutes: meeting.slotBufferMinutes,
  });
  return busy.filter(
    (b) => b.teacher_id === teacherId && windowsOverlap(held, { start: new Date(b.starts_at), end: new Date(b.ends_at) }),
  );
}

export type TeacherAvailability =
  | { ok: true; note: string | null }
  | { ok: false; reason: "in_class" | "busy"; text: string };

/**
 * Whether a teacher can be ticked in the box of `classId`: not when they are
 * in another box whose hours overlap (case 4: "In Class 5 - A, 12:00 PM to
 * 1:00 PM"), not when another PTM holds them then (case 7: "Busy 3:00 PM to
 * 5:05 PM with ..."); otherwise yes, with "Also in ..." when they sit in a
 * box at another time (case 5).
 */
export function teacherAvailability(args: {
  teacherId: string;
  classId: string;
  sessions: ClassSessionDraft[];
  meeting: MeetingHours;
  date: string;
  busy: BusyLike[];
  classLabel: (classId: string) => string;
}): TeacherAvailability {
  const { teacherId, classId, sessions, meeting, date, busy, classLabel } = args;
  const here = sessions.find((s) => s.classId === classId) ?? newClassSession(classId);
  const elsewhere = sessions.filter((s) => s.classId !== classId && s.teacherIds.includes(teacherId));
  const clash = elsewhere.find((s) => sessionsClash(here, s, meeting));
  if (clash) {
    const h = sessionHours(clash, meeting);
    return { ok: false, reason: "in_class", text: `In ${classLabel(clash.classId)}, ${formatTimeRange(h.startTime, h.endTime)}` };
  }
  const held = busyDuring(teacherId, here, meeting, date, busy);
  if (held.length > 0) {
    return {
      ok: false,
      reason: "busy",
      text: `${busyLabel(held[0])}${held.length > 1 ? ` and ${held.length - 1} more` : ""}`,
    };
  }
  if (elsewhere.length === 0) return { ok: true, note: null };
  const first = sessionHours(elsewhere[0], meeting);
  const more = elsewhere.length - 1;
  return {
    ok: true,
    note: `Also in ${classLabel(elsewhere[0].classId)}, ${formatTimeRange(first.startTime, first.endTime)}${more > 0 ? ` and ${more} more` : ""}`,
  };
}

export type ClassSessionIssueKind = "hours" | "no_teachers" | "pick_teacher" | "clash" | "busy";

export interface ClassSessionIssue {
  classId: string;
  kind: ClassSessionIssueKind;
  text: string;
}

/**
 * Everything that blocks Create, per box (cases 6, 7, 9 to 11). `teachersOf`
 * returns the teachers assigned to a class, or undefined while that list is
 * still loading (no verdict yet, so no false "nobody is assigned"). Students
 * are not a condition: the teachers pick them afterwards. Every teacher runs
 * their own grid (Together was withdrawn on 2026-10-09), so a teacher in two
 * boxes at overlapping hours is always a clash.
 */
export function classSessionErrors(
  sessions: ClassSessionDraft[],
  meeting: MeetingHours,
  opts: {
    date: string;
    busy: BusyLike[];
    teachersOf: (classId: string) => { id: string }[] | undefined;
    classLabel: (classId: string) => string;
    teacherName: (teacherId: string) => string;
  },
): ClassSessionIssue[] {
  const out: ClassSessionIssue[] = [];
  for (const s of sessions) {
    const hours = sessionHoursError(s, meeting);
    if (hours) out.push({ classId: s.classId, kind: "hours", text: hours });
    const assigned = opts.teachersOf(s.classId);
    if (assigned && assigned.length === 0) {
      out.push({ classId: s.classId, kind: "no_teachers", text: "No teacher is assigned to this class yet." });
    } else if (assigned && s.teacherIds.length === 0) {
      out.push({ classId: s.classId, kind: "pick_teacher", text: "Pick at least one teacher." });
    }
    for (const teacherId of s.teacherIds) {
      const other = sessions.find((o) => o.classId !== s.classId && o.teacherIds.includes(teacherId) && sessionsClash(s, o, meeting));
      if (other) {
        out.push({
          classId: s.classId,
          kind: "clash",
          text: `${opts.teacherName(teacherId)} is also in ${opts.classLabel(other.classId)} at the same time.`,
        });
      }
      const held = busyDuring(teacherId, s, meeting, opts.date, opts.busy);
      if (held.length > 0) {
        out.push({ classId: s.classId, kind: "busy", text: `${opts.teacherName(teacherId)}: ${busyLabel(held[0])}.` });
      }
    }
  }
  return out;
}

/** The `_class_sessions` jsonb the server takes (section 5.2 of the spec).
 *  Hours are null on the meeting's hours; `student_ids` is always empty,
 *  the teachers pick the students afterwards. */
export function classSessionsPayload(
  sessions: ClassSessionDraft[],
): { class_id: string; start_time: string | null; end_time: string | null; teacher_ids: string[]; student_ids: string[] }[] {
  return sessions.map((s) => ({
    class_id: s.classId,
    start_time: sessionHasOwnHours(s) ? s.startTime : null,
    end_time: sessionHasOwnHours(s) ? s.endTime : null,
    teacher_ids: s.teacherIds,
    student_ids: [],
  }));
}

/**
 * What today's server (no class sessions yet) can take: the union of
 * teachers, each with the envelope of their sessions' hours as own hours
 * when that differs from the meeting's. A teacher in two boxes runs ONE
 * session over the envelope until the server lands; `notes` says so, and
 * the form shows them before Create.
 */
export function flattenForLegacyServer(
  sessions: ClassSessionDraft[],
  meeting: MeetingHours,
  teacherName: (teacherId: string) => string,
  classLabel: (classId: string) => string,
): { teacherIds: string[]; teacherWindows: { teacherId: string; startTime: string; endTime: string }[]; notes: string[] } {
  const order: string[] = [];
  const spans = new Map<string, { start: number; end: number; classes: string[] }>();
  for (const s of sessions) {
    const h = sessionHours(s, meeting);
    const start = timeToMinutes(h.startTime);
    const end = timeToMinutes(h.endTime);
    for (const id of s.teacherIds) {
      const cur = spans.get(id);
      if (!cur) {
        order.push(id);
        spans.set(id, { start, end, classes: [s.classId] });
      } else {
        cur.start = Math.min(cur.start, start);
        cur.end = Math.max(cur.end, end);
        cur.classes.push(s.classId);
      }
    }
  }
  const meetingStart = timeToMinutes(meeting.startTime);
  const meetingEnd = timeToMinutes(meeting.endTime);
  const teacherWindows: { teacherId: string; startTime: string; endTime: string }[] = [];
  const notes: string[] = [];
  for (const id of order) {
    const span = spans.get(id)!;
    const whole = span.start <= meetingStart && span.end >= meetingEnd;
    const startTime = hhmm(span.start);
    const endTime = hhmm(span.end);
    if (!whole) teacherWindows.push({ teacherId: id, startTime, endTime });
    if (span.classes.length > 1) {
      notes.push(
        `Until the server update, ${teacherName(id)} runs one session ${formatTimeRange(startTime, endTime)} for ${span.classes.map(classLabel).join(" and ")}.`,
      );
    }
  }
  return { teacherIds: order, teacherWindows, notes };
}

/** Minutes since midnight to "HH:MM", the shape the time inputs hold. */
function hhmm(minutes: number): string {
  if (!Number.isFinite(minutes)) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
