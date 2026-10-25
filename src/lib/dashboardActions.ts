// Dashboard action cards, the PURE part: parses my_dashboard_actions() and turns it into
// ordered cards and their words. Erasable TypeScript with no value imports on purpose: the
// Node test (scripts/test-dashboard-actions.mjs) loads this file directly with type
// stripping, so it may use no enum, no namespace, and only `import type`.
// The cards' query key lives in src/lib/dashboardActionsKey.ts, so modules in the entry
// chunk can refresh the cards without pulling this file into everyone's first download.
// Spec: docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md

import type { ViewRole } from "@/contexts/ActiveRoleContext";

/** Where the substitution card sends its Assign button. */
export const COVER_LINK = "/staff/workday?tab=substitutions";
const STUDENT_LEAVE_LINK = "/school/attendance?tab=leaves";
const STAFF_LEAVE_LINK = "/staff/workday?tab=staff-leaves";

export interface CheckInAction {
  state: "due" | "absent";
  /** staff_check_in_time, "HH:MM" on the school's clock */
  by: string;
  /** staff_check_out_time, "HH:MM": the card stops showing then */
  until: string;
}

export interface CoverNext {
  label: string;
  className: string;
  section: string | null;
  /** the period's start, "HH:MM" */
  start: string;
}

export interface CoverAction {
  pending: number;
  next: CoverNext | null;
}

export interface LeaveAction {
  students: number;
  staff: number;
  oldestDays: number;
}

export interface CheckOutAction {
  /** today's staff_attendance_records row, never another day's */
  recordId: string;
  /** staff_check_out_time, "HH:MM" */
  since: string;
}

export interface DashboardActions {
  date: string | null;
  view: ViewRole | null;
  checkIn: CheckInAction | null;
  cover: CoverAction | null;
  leave: LeaveAction | null;
  checkOut: CheckOutAction | null;
  passDue: boolean;
  refreshInS: number | null;
}

export type ActionCardKind = "check_in" | "cover" | "leave" | "check_out";

/** The owner's order (2026-10-03): check-in, substitution, leave, check-out. */
export const CARD_ORDER: readonly ActionCardKind[] = ["check_in", "cover", "leave", "check_out"];

export interface CardCopy {
  title: string;
  detail: string;
}

export interface CardLink {
  label: string;
  to: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const whole = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const isView = (v: unknown): v is ViewRole => v === "admin" || v === "coordinator" || v === "teacher";

function parseCheckIn(v: unknown): CheckInAction | null {
  if (!isObj(v)) return null;
  const state = v.state === "due" || v.state === "absent" ? v.state : null;
  const by = text(v.by);
  const until = text(v.until);
  return state && by && until ? { state, by, until } : null;
}

function parseCover(v: unknown): CoverAction | null {
  if (!isObj(v)) return null;
  const pending = whole(v.pending);
  if (pending === 0) return null;
  const n = v.next;
  let next: CoverNext | null = null;
  if (isObj(n)) {
    const label = text(n.label);
    const className = text(n.class_name);
    const start = text(n.start);
    if (label && className && start) next = { label, className, section: text(n.section), start };
  }
  return { pending, next };
}

function parseLeave(v: unknown): LeaveAction | null {
  if (!isObj(v)) return null;
  const students = whole(v.students);
  const staff = whole(v.staff);
  if (students + staff === 0) return null;
  return { students, staff, oldestDays: whole(v.oldest_days) };
}

function parseCheckOut(v: unknown): CheckOutAction | null {
  if (!isObj(v)) return null;
  const recordId = text(v.record_id);
  const since = text(v.since);
  return recordId && since ? { recordId, since } : null;
}

/**
 * The RPC's jsonb, checked field by field. A malformed card is dropped; an answer that is
 * not an object at all THROWS, so the slot shows its error card instead of reading a broken
 * answer as "nothing to do" (CLAUDE.md §6).
 */
export function parseDashboardActions(raw: unknown): DashboardActions {
  if (!isObj(raw)) throw new Error("my_dashboard_actions returned an unexpected answer");
  // A newer server shape must never read as "nothing due" on an older client (the Android
  // shell keeps its bundled build until a store update): an unknown version is an error.
  if (raw.v !== 1) throw new Error("my_dashboard_actions answered in an unknown version");
  const refresh = raw.refresh_in_s;
  return {
    date: text(raw.date),
    view: isView(raw.view) ? raw.view : null,
    checkIn: parseCheckIn(raw.check_in),
    cover: parseCover(raw.cover),
    leave: parseLeave(raw.leave),
    checkOut: parseCheckOut(raw.check_out),
    passDue: raw.pass_due === true,
    refreshInS: typeof refresh === "number" && Number.isFinite(refresh) && refresh > 0 ? refresh : null,
  };
}

/** The due cards, in CARD_ORDER. */
export function dueCards(a: DashboardActions): ActionCardKind[] {
  return CARD_ORDER.filter((k) =>
    k === "check_in" ? a.checkIn !== null
      : k === "cover" ? a.cover !== null
        : k === "leave" ? a.leave !== null
          : a.checkOut !== null,
  );
}

/**
 * True while a card speaks for the person's own check-in or check-out (including "Marked
 * absent"): the small greeting button then steps aside, so there are never two of them.
 */
export function ownsCheckButton(a: DashboardActions | null | undefined): boolean {
  return !!a && (a.checkIn !== null || a.checkOut !== null);
}

/** "HH:MM" (or "HH:MM:SS") to minutes since midnight, or null. */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** "08:00" -> "8:00 AM", "16:00:00" -> "4:00 PM"; anything else comes back unchanged. */
export function formatClock(hhmm: string): string {
  const total = minutesOf(hhmm);
  if (total === null) return hhmm;
  const h = Math.floor(total / 60);
  const m = String(total % 60).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * `nowHHMM` is the school's clock ("HH:MM"), so "late" flips at the school's check-in time.
 * From that minute on (>=): a tap at 08:00:30 is already recorded late (classifyStaffCheckIn).
 */
export function checkInCopy(c: CheckInAction, nowHHMM: string): CardCopy {
  if (c.state === "absent") return { title: "Marked absent today", detail: "Ask your admin to change it." };
  const now = minutesOf(nowHHMM);
  const by = minutesOf(c.by);
  const late = now !== null && by !== null && now >= by;
  return {
    title: "Check in for today",
    detail: late ? "Checking in now is recorded as late." : `Check in by ${formatClock(c.by)}`,
  };
}

/** `formatClass` is formatClassName from "@/lib/utils" (passed in to keep this file import-free). */
export function coverCopy(c: CoverAction, formatClass: (name: string, section: string | null) => string): CardCopy {
  const title = c.pending === 1 ? "1 period needs a substitute" : `${c.pending} periods need a substitute`;
  const detail = c.next
    ? `Next: ${c.next.label}, ${formatClass(c.next.className, c.next.section)} at ${formatClock(c.next.start)}`
    : "Assign a teacher before the period starts.";
  return { title, detail };
}

export function leaveCopy(l: LeaveAction): CardCopy {
  const total = l.students + l.staff;
  const parts: string[] = [];
  if (l.students > 0) parts.push(l.students === 1 ? "1 student" : `${l.students} students`);
  if (l.staff > 0) parts.push(`${l.staff} staff`);
  const age =
    l.oldestDays <= 0 ? "filed today"
      : l.oldestDays === 1 ? "oldest 1 day"
        : `oldest ${l.oldestDays} days`;
  return {
    title: total === 1 ? "1 leave request waiting" : `${total} leave requests waiting`,
    detail: `${parts.join(", ")} · ${age}`,
  };
}

/** One button per screen that holds the requests: students on Attendance, staff on Workday. */
export function leaveLinks(l: LeaveAction): CardLink[] {
  if (l.students > 0 && l.staff > 0) {
    return [
      { label: "Students", to: STUDENT_LEAVE_LINK },
      { label: "Staff", to: STAFF_LEAVE_LINK },
    ];
  }
  return [{ label: "Review", to: l.staff > 0 ? STAFF_LEAVE_LINK : STUDENT_LEAVE_LINK }];
}

export function checkOutCopy(c: CheckOutAction): CardCopy {
  return { title: "Time to check out", detail: `Check-out opened at ${formatClock(c.since)}` };
}

/**
 * When to ask the server again: one second after the moment it named (refresh_in_s), never
 * sooner than 30 seconds, so a clock skew can never become a fetch loop. Null: no timer.
 */
export function refreshDelayMs(a: DashboardActions | null | undefined): number | null {
  if (!a || a.refreshInS === null) return null;
  return Math.max(30_000, Math.ceil(a.refreshInS) * 1000 + 1000);
}

const DEFAULT_ZONE = "Asia/Kolkata";
const CLOCKS = new Map<string, Intl.DateTimeFormat>();
const CLOCK_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

function clockFor(timeZone: string): Intl.DateTimeFormat {
  const cached = CLOCKS.get(timeZone);
  if (cached) return cached;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", { ...CLOCK_OPTIONS, timeZone });
  } catch {
    // RangeError for a zone this runtime does not know: the platform default (§24).
    f = new Intl.DateTimeFormat("en-CA", { ...CLOCK_OPTIONS, timeZone: DEFAULT_ZONE });
  }
  CLOCKS.set(timeZone, f);
  return f;
}

/** The school's calendar date ("YYYY-MM-DD") and wall-clock time ("HH:MM") at `date`. */
export function schoolClock(date: Date, timeZone: string): { date: string; time: string } {
  const parts = clockFor(timeZone || DEFAULT_ZONE).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // Some engines print midnight as "24" even with hourCycle h23.
  const hour = part("hour") === "24" ? "00" : part("hour");
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${hour}:${part("minute")}` };
}
