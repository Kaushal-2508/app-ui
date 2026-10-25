import { format } from "date-fns";

import { buildAppUrl } from "@/lib/appUrl";

/**
 * Pure helpers for the PTM module: no React, no Supabase. Everything that
 * both the hooks and the components need to agree on lives here, so the slot
 * grid a student books against is the same grid the staff Bookings tab draws.
 *
 * Contract: docs/superpowers/specs/2026-09-28-ptm-module-design.md. The
 * server enforces every gate (booking cutoff, feedback window, scope) in the
 * institution's timezone; these helpers only decide what the UI shows, using
 * browser time, the same concession `isPastCutoff` already makes for
 * attendance (CLAUDE.md section 24).
 */

/** The institution feature flag that gates every PTM surface (decision 6). */
export const PTM_FEATURE_ID = "ptm_scheduling";

/** Private bucket for family voice notes (decision 7). Object name is
 *  `<ptm_id>/<student_id>/<uuid>.<ext>`; the storage policies parse it. */
export const PTM_AUDIO_BUCKET = "ptm-feedback-audio";

export const PTM_TEXT_MAX = 1000;
export const PTM_AUDIO_MAX_SECONDS = 120;
export const PTM_AUDIO_MAX_BYTES = 5 * 1024 * 1024;

/** Defaults for a new PTM; the create form pre-fills these (decision 5). */
export const PTM_DEFAULTS = {
  slotDurationMinutes: 15,
  bookingCutoffMinutes: 60,
  feedbackEditDays: 3,
} as const;

/** How a PTM is held. `in_person` is everything that existed before
 *  2026-10-03; `online` is the residential (Google Meet) mode, spec
 *  docs/superpowers/specs/2026-10-03-ptm-online-residential-design.md. */
export type PTMMode = "in_person" | "online";

export const PTM_MODE_LABEL: Record<PTMMode, string> = {
  in_person: "In person",
  online: "Online",
};

/** Defaults for a residential (online) PTM. Slots are per teacher, so the
 *  gap between them is real time the teacher needs. Booking stays open
 *  until the meeting starts (Naman, 2026-10-05, replacing the 4 hours the
 *  pasted spec asked for): the room cron runs every 5 minutes, so a late
 *  booking still gets its link within minutes. */
export const PTM_ONLINE_DEFAULTS = {
  slotDurationMinutes: 15,
  slotBufferMinutes: 5,
  bookingCutoffMinutes: 0,
  feedbackEditDays: 3,
} as const;

/** The Join button opens this many minutes before a slot starts. */
/** Join turns on this long before the slot; until then every booked slot
 *  reads "On hold" (Naman, 2026-10-05: all links on hold except the one whose
 *  turn it is). One Meet room per booked slot: Google Meet caps a call at an
 *  hour, so the teacher moves to the next room when one is done. */
export const PTM_JOIN_EARLY_MINUTES = 2;

export type PTMScopeType = "school" | "wing" | "class";

/** The hat a staff member acts under. Mirrors ViewRole, but resolved for
 *  single-role accounts too (see resolvePTMHat). */
export type PTMHat = "admin" | "coordinator" | "teacher";

export type PTMEffectiveStatus = "scheduled" | "active" | "completed" | "cancelled";

export type PTMWindowState = "not_open" | "open" | "closed" | "cancelled";

/** The fields every status and window helper reads. Both the list row and
 *  the feedback context satisfy it. */
export interface PTMTiming {
  scheduled_date: string;
  start_time: string;
  end_time: string;
  status: string;
  booking_cutoff_minutes?: number | null;
  feedback_edit_days?: number | null;
  /** `online` books per slot: open until the meeting ENDS, each slot until it starts. */
  mode?: string | null;
}

/**
 * Which hat this account wears for PTM rights. `activeViewRole` alone is not
 * enough: ActiveRoleContext offers a switch only to dual-role accounts and
 * defaults everyone else to "teacher", so a plain admin must resolve to
 * "admin" here, exactly as CommunicationPage derives its own flags.
 */
export function resolvePTMHat(
  roleInfo:
    | { isSchoolAdmin: boolean; isCoordinator: boolean; isTeacher: boolean }
    | null
    | undefined,
  activeViewRole: PTMHat,
  hasDualRole: boolean,
): PTMHat | null {
  if (!roleInfo) return null;
  if (hasDualRole) return activeViewRole;
  if (roleInfo.isSchoolAdmin) return "admin";
  if (roleInfo.isCoordinator) return "coordinator";
  if (roleInfo.isTeacher) return "teacher";
  return null;
}

/** "10:30:00" or "10:30" to minutes since midnight. NaN on garbage. */
export function timeToMinutes(time: string | null | undefined): number {
  if (!time) return Number.NaN;
  const [h, m] = time.split(":");
  const hours = Number(h);
  const minutes = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
  return hours * 60 + minutes;
}

/** Minutes since midnight to "HH:MM:SS", the shape Postgres `time` returns. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** "10:30:00" to "10:30 AM". Falls back to the raw string on garbage. */
export function formatClockTime(time: string | null | undefined): string {
  const minutes = timeToMinutes(time);
  if (!Number.isFinite(minutes)) return time ?? "";
  return format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60), "h:mm a");
}

/** "10:00 AM to 1:00 PM". Ranges use "to", never a dash (repo rule). */
export function formatTimeRange(start: string, end: string): string {
  return `${formatClockTime(start)} to ${formatClockTime(end)}`;
}

/** "2026-10-03" to "3 Oct 2026". */
export function formatPTMDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return format(new Date(y, m - 1, d), "d MMM yyyy");
}

/** "Meera Nair", "Meera Nair and Ravi Kumar", "A, B and C" (no Oxford comma,
 *  no dash: repo rule). */
export function joinNames(names: string[]): string {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Local Date for the PTM's start (or end). Browser time, display only. */
export function ptmStartsAt(ptm: PTMTiming): Date {
  return combineLocal(ptm.scheduled_date, ptm.start_time);
}

export function ptmEndsAt(ptm: PTMTiming): Date {
  return combineLocal(ptm.scheduled_date, ptm.end_time);
}

function combineLocal(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const minutes = timeToMinutes(time);
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  return new Date(y, (m || 1) - 1, d || 1, Math.floor(safeMinutes / 60), safeMinutes % 60, 0, 0);
}

/**
 * The slot grid: every start time from `start` in steps of `duration` plus
 * `buffer` whose whole slot still fits before `end`. Computed, never stored,
 * so this MUST match the server's rule (`slot_time + duration <= end_time`,
 * pitch `duration + buffer`). The buffer defaults to 0, which keeps every
 * in-person grid exactly as it was; online PTMs pass their gap.
 */
export function buildSlotGrid(
  start: string,
  end: string,
  durationMinutes: number,
  bufferMinutes = 0,
): string[] {
  const from = timeToMinutes(start);
  const to = timeToMinutes(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || durationMinutes <= 0) return [];
  const pitch = durationMinutes + Math.max(0, bufferMinutes);
  const slots: string[] = [];
  for (let t = from; t + durationMinutes <= to; t += pitch) {
    slots.push(minutesToTime(t));
    // A 5-minute grid over a whole day is 288 slots; anything past that is
    // a corrupt row, not a real meeting.
    if (slots.length >= 300) break;
  }
  return slots;
}

/** When one slot of a PTM starts and ends, as local Dates (display only). */
export function slotBounds(
  ptm: { scheduled_date: string; slot_duration_minutes: number },
  slotTime: string,
): { start: Date; end: Date } {
  const start = combineLocal(ptm.scheduled_date, slotTime);
  return { start, end: new Date(start.getTime() + ptm.slot_duration_minutes * 60_000) };
}

/**
 * The slot bounds the server sent (timestamptz in the school's timezone),
 * falling back to the browser-local computation when a row predates them.
 * Prefer the server's: a phone set to the wrong zone would otherwise open
 * the Join button at the wrong time.
 */
export function slotBoundsFrom(
  server: { slot_starts_at?: string | null; slot_ends_at?: string | null },
  fallback: () => { start: Date; end: Date },
): { start: Date; end: Date } {
  if (server.slot_starts_at && server.slot_ends_at) {
    const start = new Date(server.slot_starts_at);
    const end = new Date(server.slot_ends_at);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) return { start, end };
  }
  return fallback();
}

export type JoinWindowState = "not_yet" | "open" | "over";

/**
 * When a family or teacher may join an online slot: from a few minutes
 * before it starts until it ends plus the gap after it. Browser time, the
 * same concession as every other window helper here.
 */
export function joinWindowState(
  slotStart: Date,
  slotEnd: Date,
  bufferMinutes: number,
  now: Date = new Date(),
  earlyMinutes: number = PTM_JOIN_EARLY_MINUTES,
): { state: JoinWindowState; opensAt: Date; closesAt: Date } {
  const opensAt = new Date(slotStart.getTime() - earlyMinutes * 60_000);
  const closesAt = new Date(slotEnd.getTime() + Math.max(0, bufferMinutes) * 60_000);
  const t = now.getTime();
  if (t < opensAt.getTime()) return { state: "not_yet", opensAt, closesAt };
  if (t > closesAt.getTime()) return { state: "over", opensAt, closesAt };
  return { state: "open", opensAt, closesAt };
}

function whenLabel(at: Date, now: Date): string {
  const sameDay =
    at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? format(at, "h:mm a") : format(at, "d MMM 'at' h:mm a");
}

/**
 * What a Join button should show, in one place for the family's card and
 * booking sheet and for every row of the staff grid. One Meet room per booked
 * slot, and every room is "on hold" except the one whose turn it is: Join is
 * disabled until two minutes before the slot and after it ends plus the gap.
 * The wording differs by who is looking: the family hears "Your turn at
 * 3:40 PM" / "Your slot is over"; the teacher, scanning a column of slots,
 * sees the slot time and "Done".
 */
export function joinButtonState(args: {
  slotStart: Date;
  slotEnd: Date;
  bufferMinutes: number;
  meetUri: string | null;
  now?: Date;
  role?: "family" | "teacher";
}): { enabled: boolean; label: string; reason: string | null } {
  const now = args.now ?? new Date();
  const teacher = args.role === "teacher";
  const { state } = joinWindowState(args.slotStart, args.slotEnd, args.bufferMinutes, now);
  if (state === "over") return { enabled: false, label: "Join now", reason: teacher ? "Done" : "Your slot is over" };
  if (state === "not_yet") {
    const at = whenLabel(args.slotStart, now);
    return { enabled: false, label: "On hold", reason: teacher ? `Slot at ${at}` : `Your turn at ${at}` };
  }
  if (!args.meetUri) return { enabled: false, label: "Join now", reason: "Room not ready yet" };
  return { enabled: true, label: "Join now", reason: null };
}

/**
 * Why a teacher's own hours inside an online PTM are not usable, or null when
 * they are (per-teacher windows, 2026-10-06). Mirrors the checks the server
 * will make: inside the meeting, end after start, at least one slot.
 */
export function teacherWindowError(
  w: { startTime: string; endTime: string },
  meeting: { startTime: string; endTime: string; slotDurationMinutes: number; slotBufferMinutes: number },
): string | null {
  if (!w.startTime || !w.endTime) return "Set both times.";
  const s = timeToMinutes(w.startTime);
  const e = timeToMinutes(w.endTime);
  if (e <= s) return "The end must be after the start.";
  if (s < timeToMinutes(meeting.startTime) || e > timeToMinutes(meeting.endTime)) {
    return `Must be within the meeting, ${formatTimeRange(meeting.startTime, meeting.endTime)}.`;
  }
  if (buildSlotGrid(w.startTime, w.endTime, meeting.slotDurationMinutes, meeting.slotBufferMinutes).length === 0) {
    return "Shorter than one slot.";
  }
  return null;
}

/** True while a slot is in progress (its own minutes, not the early margin or
 *  the gap): the staff grid marks that row "Now". */
export function isSlotInProgress(slotStart: Date, slotEnd: Date, now: Date): boolean {
  const t = now.getTime();
  return t >= slotStart.getTime() && t < slotEnd.getTime();
}

/**
 * The time a teacher is held by a PTM: its window plus the gap after the
 * last slot. Mirrors the server's `_ptm_busy_window`; used to grey busy
 * teachers in the picker before the server refuses them.
 */
export function ptmBusyWindow(ptm: {
  scheduled_date: string;
  start_time: string;
  end_time: string;
  slot_buffer_minutes?: number | null;
}): { start: Date; end: Date } {
  const start = combineLocal(ptm.scheduled_date, ptm.start_time);
  const end = new Date(
    combineLocal(ptm.scheduled_date, ptm.end_time).getTime() +
      Math.max(0, ptm.slot_buffer_minutes ?? 0) * 60_000,
  );
  return { start, end };
}

/** Half-open overlap, the same rule the server's busy check uses. */
export function windowsOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** The server refused because a teacher is already in a PTM at that time
 *  (P0001 with HINT `ptm_teacher_busy`); the message names who and when. */
export function isPtmTeacherBusyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { hint?: unknown; message?: unknown };
  if (e.hint === "ptm_teacher_busy") return true;
  return typeof e.message === "string" && /is already in "/.test(e.message);
}

/** The server's "no Google account" refusal (P0001, HINT `ptm_teacher_no_google`).
 *  Since 2026-10-05 the app never blocks on it (a teacher's login email is
 *  their Google account unless they set another); the server relaxation is
 *  Tushar's, so the create sheet still catches it and returns to step 1. */
export function isPtmTeacherNoGoogleError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { hint?: unknown; message?: unknown };
  if (e.hint === "ptm_teacher_no_google") return true;
  return typeof e.message === "string" && /Google account email/.test(e.message);
}

/**
 * What the card should say. Stored status wins for `cancelled`, and for the
 * legacy `completed` value older rows carry; everything else is the time
 * window.
 */
export function ptmEffectiveStatus(ptm: PTMTiming, now: Date = new Date()): PTMEffectiveStatus {
  if (ptm.status === "cancelled") return "cancelled";
  if (ptm.status === "completed") return "completed";
  const start = ptmStartsAt(ptm).getTime();
  const end = ptmEndsAt(ptm).getTime();
  const t = now.getTime();
  if (t < start) return "scheduled";
  if (t <= end) return "active";
  return "completed";
}

/** Can a student still book, cancel or move a slot? (Display only.) */
export function ptmBookingWindowOpen(ptm: PTMTiming, now: Date = new Date()): boolean {
  if (ptm.status === "cancelled" || ptm.status === "completed") return false;
  // Online (Naman, 2026-10-05: "after a ptm starts a student can still
  // choose a slot"): the window is the whole meeting; a slot that has
  // already started is greyed in the grid, the rest stay bookable. The
  // server's book_ptm_slot must agree (NEEDS DB in the design spec).
  if (ptm.mode === "online") return now.getTime() < ptmEndsAt(ptm).getTime();
  const cutoff = ptm.booking_cutoff_minutes ?? PTM_DEFAULTS.bookingCutoffMinutes;
  return now.getTime() < ptmStartsAt(ptm).getTime() - cutoff * 60_000;
}

/** "until each slot starts" (online) or the in-person cutoff phrase. */
export function describeBookingWindow(ptm: Pick<PTMTiming, "mode" | "booking_cutoff_minutes">): string {
  if (ptm.mode === "online") return "until each slot starts, even once the meeting is under way";
  return describeCutoff(ptm.booking_cutoff_minutes ?? PTM_DEFAULTS.bookingCutoffMinutes);
}

/** A slot the family can no longer pick because it has already started. */
export function slotHasStarted(slotStart: Date, now: Date): boolean {
  return now.getTime() >= slotStart.getTime();
}

/** Local mirror of the server's feedback window (display only). */
export function ptmFeedbackWindow(ptm: PTMTiming, now: Date = new Date()): PTMWindowState {
  if (ptm.status === "cancelled") return "cancelled";
  const days = ptm.feedback_edit_days ?? PTM_DEFAULTS.feedbackEditDays;
  const opens = ptmStartsAt(ptm).getTime();
  const closes = ptmEndsAt(ptm).getTime() + days * 86_400_000;
  const t = now.getTime();
  if (t < opens) return "not_open";
  if (t > closes) return "closed";
  return "open";
}

/** Absolute URL the printed QR carries. Never a hard-coded domain: two
 *  production frontends share this project (CLAUDE.md section 1).
 *
 *  buildAppUrl, as for every link that leaves the device (docs/mobile/
 *  README.md). The website's build leaves VITE_PUBLIC_URL unset, so its QR
 *  keeps the page's own origin. Every app build sets it, because inside the
 *  app the origin is the WebView's (https://localhost), which no other phone
 *  can open. The Android app claims that public address (src/lib/appLinks.ts),
 *  so a scan opens the app when it is installed and the website otherwise. */
export function ptmFeedbackUrl(token: string): string {
  return buildAppUrl(`/ptm/feedback/${encodeURIComponent(token)}`);
}

/** "1 hour before it starts", "30 minutes before it starts", "until it starts". */
export function describeCutoff(minutes: number): string {
  if (minutes <= 0) return "until it starts";
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `up to ${h} ${h === 1 ? "hour" : "hours"} before it starts`;
  }
  return `up to ${minutes} minutes before it starts`;
}

/** "3 days after the meeting", "until the meeting ends". */
export function describeEditWindow(days: number): string {
  if (days <= 0) return "until the meeting ends";
  return `up to ${days} ${days === 1 ? "day" : "days"} after the meeting`;
}

/** "up to 3 days after the meeting" to "Up to 3 days after the meeting". */
export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "1:45" style duration for the recorder and the player. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(totalSeconds ?? 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Recorder MIME type to a file extension the storage allow-list accepts. */
export function audioExtensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  switch (base) {
    case "audio/webm":
      return "webm";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    default:
      return "webm";
  }
}

/** The MIME type stored on the row: the base type without codec parameters. */
export function audioBaseType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase() || "audio/webm";
}

/** What the viewer's current hat covers, from ptm_manageable_scope. */
export interface PTMViewerScope {
  can_school: boolean;
  classIds: Set<string>;
}

/**
 * Whether the viewer may edit or cancel the PTM, mirrored from
 * `can_manage_ptm` so the buttons only appear when the server will say yes.
 * The rule is the plan's "the creator, and anyone with higher rights over
 * that scope": admin > coordinator > teacher, compared against the hat the
 * creator acted under (`created_as_role`; legacy rows were admin-only, so a
 * missing value reads as admin). The creator keeps the right only while they
 * still cover every class of the PTM. The server is still the gate.
 */
export function canManagePTM(
  ptm: {
    scope_type: PTMScopeType;
    classIds: string[];
    status: string;
    created_by: string | null;
    created_as_role: PTMHat | null;
    /** Missing on legacy callers; an in-person PTM. */
    mode?: PTMMode;
  },
  viewer: { userId: string | null; hat: PTMHat | null; scope: PTMViewerScope | null | undefined },
): boolean {
  const { userId, hat, scope } = viewer;
  if (!hat || !scope || ptm.status === "cancelled") return false;
  if (hat === "admin") return scope.can_school;
  if (ptm.mode === "online") {
    // An online PTM has no classes until its teachers pick students, so the
    // class test below cannot apply. The server rule: the creator, under the
    // hat they created it with (can_manage_ptm, online branch).
    const creatorRole: PTMHat = ptm.created_as_role ?? "admin";
    return !!userId && ptm.created_by === userId && creatorRole === hat;
  }
  if (ptm.scope_type === "school" || ptm.classIds.length === 0) return false;
  if (!ptm.classIds.every((id) => scope.classIds.has(id))) return false;

  const creatorRole: PTMHat = ptm.created_as_role ?? "admin";
  const isCreator = !!userId && ptm.created_by === userId;
  if (hat === "coordinator") {
    // Above a teacher's PTM; level with another coordinator's, so only the
    // coordinator who made it.
    return creatorRole === "teacher" || (creatorRole === "coordinator" && isCreator);
  }
  // A teacher manages only the class PTM they made themselves.
  return ptm.scope_type === "class" && creatorRole === "teacher" && isCreator;
}

export interface PTMClassLike {
  id: string;
  name: string;
  section: string | null;
}

/**
 * The PTM's classes this hat may look into (bookings, feedback). A
 * school-wide PTM has no class rows, so it means every class the hat covers;
 * an admin sees every class of a class-scoped PTM even if one has since been
 * deactivated. Mirrors the scoping inside ptm_feedback_summary.
 */
export function ptmViewableClasses(
  ptmClasses: PTMClassLike[],
  scopeClasses: PTMClassLike[],
  hat: PTMHat | null,
): PTMClassLike[] {
  if (!hat) return [];
  if (ptmClasses.length === 0) return scopeClasses;
  if (hat === "admin") return ptmClasses;
  const inScope = new Set(scopeClasses.map((c) => c.id));
  return ptmClasses.filter((c) => inScope.has(c.id));
}

/** Staff may open the detail view when their hat covers at least one class
 *  of the PTM; an admin always may; so may a teacher who is in an online
 *  PTM, whose classes only appear once teachers pick students. */
export function canOpenPTM(
  ptmClasses: PTMClassLike[],
  scopeClasses: PTMClassLike[],
  hat: PTMHat | null,
  isParticipant = false,
): boolean {
  if (!hat) return false;
  if (hat === "admin" || isParticipant) return true;
  return ptmViewableClasses(ptmClasses, scopeClasses, hat).length > 0;
}

/**
 * A teacher in an online PTM edits their own student list (nothing else)
 * while the meeting has not ended. Mirrors the server's rule for
 * set_ptm_online_students; the server is still the gate.
 */
export function canEditOwnSession(
  ptm: PTMTiming & { mode: PTMMode },
  hat: PTMHat | null,
  isParticipant: boolean,
  now: Date = new Date(),
): boolean {
  if (!hat || !isParticipant || ptm.mode !== "online") return false;
  if (ptm.status === "cancelled" || ptm.status === "completed") return false;
  return now.getTime() < ptmEndsAt(ptm).getTime();
}
