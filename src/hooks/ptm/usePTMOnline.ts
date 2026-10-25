import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";

import { toastError, toastWarning } from "@/lib/toast";
import type { PTMHat } from "@/lib/ptm";
import { callPtmRpc, ptmKeys } from "./ptmClient";
import type { PTMSlotRow } from "./usePTMBookings";

/**
 * Hooks for the residential (online) PTM mode. Every RPC here is NEEDS DB
 * (Tushar); the contract, with each function's exact signature, is in
 * docs/superpowers/specs/2026-10-03-ptm-online-residential-design.md.
 * Nothing in this file is reachable until usePTMSchemaReady() says
 * `onlineReady`, so a missing function never surfaces as a toast.
 */

/** One row of ptm_online_teacher_options(_as_role): a teacher the caller's
 *  hat may invite. The address itself is never returned, only whether one
 *  is set. */
export interface PTMOnlineTeacherOption {
  teacher_id: string;
  full_name: string;
  has_google_email: boolean;
  class_count: number;
}

export function usePTMOnlineTeacherOptions(hat: PTMHat | null, enabled = true) {
  return useQuery({
    queryKey: ptmKeys.onlineTeacherOptions(hat),
    queryFn: async (): Promise<PTMOnlineTeacherOption[]> => {
      const rows = await callPtmRpc<PTMOnlineTeacherOption[] | null>("ptm_online_teacher_options", {
        _as_role: hat,
      });
      return rows ?? [];
    },
    enabled: enabled && !!hat,
    // Picker furniture: staff lists change rarely.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** One row of ptm_teacher_busy_windows(_date, _teacher_ids, _exclude_ptm):
 *  a PTM that holds a teacher on that day. `starts_at` and `ends_at` are
 *  timestamptz (the end includes the slot gap). */
export interface PTMBusyWindow {
  teacher_id: string;
  ptm_id: string;
  mode: string;
  title: string;
  starts_at: string;
  ends_at: string;
  is_own: boolean;
}

/**
 * Every PTM holding any teacher in the caller's scope on `date`, so the
 * picker can grey the busy ones. One bounded call per day (the server caps
 * at 500 rows); `excludePtmId` leaves out the PTM being edited.
 */
export function usePTMTeacherBusyWindows(
  date: string | null,
  excludePtmId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ptmKeys.busyWindows(date, excludePtmId),
    queryFn: async (): Promise<PTMBusyWindow[]> => {
      if (!date) return [];
      const rows = await callPtmRpc<PTMBusyWindow[] | null>("ptm_teacher_busy_windows", {
        _date: date,
        _teacher_ids: null,
        _exclude_ptm: excludePtmId,
      });
      return rows ?? [];
    },
    enabled: enabled && !!date,
    // Other staff schedule PTMs while this sheet is open; a minute is the
    // floor CLAUDE.md 23 allows, and the server refuses a clash anyway.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** One row of ptm_online_pick_options(_ptm_id, _teacher_id): a student of a
 *  class the teacher teaches, and which other teachers of this PTM have
 *  picked them too. */
export interface PTMOnlinePickRow {
  student_id: string;
  full_name: string;
  class_id: string;
  class_name: string;
  class_section: string | null;
  /** `mine` is already on the caller's list. `taken` (on another teacher's
   *  list, not tickable) comes only from a server that still allows one
   *  teacher per student; since spec 2026-10-09 such a row is `free` and
   *  `with_teachers` names them instead. */
  state: "free" | "mine" | "taken";
  taken_by_name: string | null;
  /** The PTM's other teachers who have this student (spec 2026-10-09);
   *  absent on an older server. */
  with_teachers?: string[] | null;
  /** The student has an active booking with the caller on this PTM. */
  booked: boolean;
}

/**
 * Who the calling teacher may pick for `ptmId`. NULL is the create flow
 * (no PTM yet, everyone free). Bounded by the teacher's own classes.
 */
export function usePTMOnlinePickOptions(ptmId: string | null, enabled = true) {
  return useQuery({
    queryKey: ptmKeys.onlinePickOptions(ptmId),
    queryFn: async (): Promise<PTMOnlinePickRow[]> => {
      const rows = await callPtmRpc<PTMOnlinePickRow[] | null>("ptm_online_pick_options", {
        _ptm_id: ptmId,
        _teacher_id: null,
      });
      return rows ?? [];
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The same list per CLASS SESSION (probe level `sessions`): a teacher in
 * several class sessions of one PTM picks each class's students separately,
 * and the server scopes the rows to that class. One bounded RPC per session,
 * cached under its own key, so a save on one does not refetch the others.
 */
export function usePTMOnlinePickOptionsBySession(ptmId: string | null, classSessionIds: string[]) {
  const results = useQueries({
    queries: classSessionIds.map((classSessionId) => ({
      queryKey: ptmKeys.onlinePickOptions(ptmId, classSessionId),
      queryFn: async (): Promise<PTMOnlinePickRow[]> => {
        if (!ptmId) return [];
        const rows = await callPtmRpc<PTMOnlinePickRow[] | null>("ptm_online_pick_options", {
          _ptm_id: ptmId,
          _teacher_id: null,
          _class_session_id: classSessionId,
        });
        return rows ?? [];
      },
      enabled: !!ptmId,
      staleTime: 60_000,
    })),
  });
  const byId: Record<string, { data: PTMOnlinePickRow[] | undefined; isLoading: boolean; isError: boolean; refetch: () => Promise<PTMOnlinePickRow[] | undefined> }> = {};
  classSessionIds.forEach((id, i) => {
    const r = results[i];
    byId[id] = {
      data: r?.data,
      isLoading: !!r?.isLoading,
      isError: !!r?.isError,
      refetch: async () => (r ? (await r.refetch()).data : undefined),
    };
  });
  return byId;
}

/** One row of ptm_online_sessions(_ptm_id): a participating teacher and how
 *  far their session has got. */
export interface PTMOnlineSession {
  teacher_id: string;
  teacher_name: string;
  has_google_email: boolean;
  student_count: number;
  booked_count: number;
  attended_count: number;
  /** Slots whose Meet room could not be made after every retry. */
  meet_failed_count: number;
  is_me: boolean;
  /** This teacher's own hours when narrower than the meeting's (2026-10-06);
   *  absent or null = the whole window. Optional until the server returns it. */
  start_time?: string | null;
  end_time?: string | null;
  /** Class sessions (spec 2026-10-06, probe level `sessions`): the class
   *  this row belongs to. Absent on today's server and on teacher-made PTMs. */
  class_session_id?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  class_section?: string | null;
}

export function usePTMOnlineSessions(ptmId: string | null, enabled = true) {
  return useQuery({
    queryKey: ptmKeys.onlineSessions(ptmId),
    queryFn: async (): Promise<PTMOnlineSession[]> => {
      if (!ptmId) return [];
      const rows = await callPtmRpc<PTMOnlineSession[] | null>("ptm_online_sessions", {
        _ptm_id: ptmId,
      });
      return rows ?? [];
    },
    enabled: enabled && !!ptmId,
    staleTime: 60_000,
  });
}

/** One row of ptm_online_booking_grid(_ptm_id, _teacher_id). As the
 *  in-person grid, plus the class and the Meet link (students get the link
 *  on their own row only; staff for the whole session). */
export interface PTMOnlineSlotRow extends PTMSlotRow {
  class_id: string | null;
  class_name: string | null;
  class_section: string | null;
  meet_uri: string | null;
  meet_ready: boolean;
  /** The slot's bounds in the school's timezone (timestamptz), so the Join
   *  window does not depend on the phone's clock setting. */
  slot_starts_at: string;
  slot_ends_at: string;
}

/**
 * True while some booked slot has no room yet but is inside the window the
 * cron makes rooms in (status note item 19: slots starting within the next
 * 60 minutes, kept until the slot ends). A page left open then polls every
 * minute so Join turns live without a reload (Tushar's review, 2026-10-07:
 * "the room never appears until the page is reloaded"). 60s is the cron's
 * own cadence, above the 30s floor of CLAUDE.md section 23.
 */
export function roomsPending(
  rows: { booking_id?: string | null; meet_uri?: string | null; slot_starts_at?: string | null; slot_ends_at?: string | null }[] | undefined,
  now: number = Date.now(),
): boolean {
  if (!rows) return false;
  const soon = now + 65 * 60_000;
  return rows.some((r) => {
    if (!r.booking_id || r.meet_uri) return false;
    const start = r.slot_starts_at ? new Date(r.slot_starts_at).getTime() : Number.NaN;
    const end = r.slot_ends_at ? new Date(r.slot_ends_at).getTime() : start;
    if (!Number.isFinite(start)) return false;
    return start <= soon && now <= end + 20 * 60_000;
  });
}
const ROOM_POLL_MS = 60_000;

async function fetchOnlineGrid(ptmId: string, teacherId: string | null, classSessionId: string | null): Promise<PTMOnlineSlotRow[]> {
  const rows = await callPtmRpc<PTMOnlineSlotRow[] | null>("ptm_online_booking_grid", {
    _ptm_id: ptmId,
    _teacher_id: teacherId,
    // Probe level `sessions`: sent only when known, so today's server sees
    // the call it knows.
    ...(classSessionId ? { _class_session_id: classSessionId } : {}),
  });
  return rows ?? [];
}

/**
 * The slot grid of one teacher's session. `teacherId` NULL means "the
 * caller's own teacher", which is how a student asks for it; staff always
 * name the teacher.
 */
export function usePTMOnlineBookingGrid(
  ptmId: string | null,
  teacherId: string | null,
  enabled = true,
  /** Probe level `sessions`: the class session. */
  classSessionId: string | null = null,
) {
  return useQuery({
    queryKey: ptmKeys.onlineGrid(ptmId, teacherId, classSessionId),
    queryFn: () => (ptmId ? fetchOnlineGrid(ptmId, teacherId, classSessionId) : Promise.resolve([] as PTMOnlineSlotRow[])),
    enabled: enabled && !!ptmId,
    // Slots change hands while families book; the booking RPC reports a
    // taken slot anyway.
    staleTime: 60_000,
    // 60s poll only while a booked slot's room is still being made (see
    // roomsPending); off otherwise.
    refetchInterval: (query) => (roomsPending(query.state.data) ? ROOM_POLL_MS : false),
  });
}

function combineGrids(results: UseQueryResult<PTMOnlineSlotRow[]>[]) {
  return {
    data: results.map((r) => r.data),
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    refetch: () => {
      for (const r of results) void r.refetch();
    },
  };
}

/**
 * The grids of several teachers at once, for the Bookings tab's everyone
 * view (Naman, 2026-10-09: "show all the booked meetings and then if any
 * filter is applied"). One bounded RPC per (teacher, class session), under
 * the same keys as the single-grid hook so the two share the cache. The
 * fan-out is bounded by the PTM's teacher count, on a staff page opened
 * now and then. PERF-DEBT: one `ptm_online_bookings(_ptm_id)` read would
 * make this a single call for a PTM with many teachers (NEEDS DB).
 */
export function usePTMOnlineBookingGrids(
  ptmId: string | null,
  scopes: { teacherId: string; classSessionId: string | null }[],
) {
  return useQueries({
    queries: scopes.map((s) => ({
      queryKey: ptmKeys.onlineGrid(ptmId, s.teacherId, s.classSessionId),
      queryFn: () => (ptmId ? fetchOnlineGrid(ptmId, s.teacherId, s.classSessionId) : Promise.resolve([] as PTMOnlineSlotRow[])),
      enabled: !!ptmId,
      staleTime: 60_000,
      // As the single grid: poll each minute only while a room is due.
      refetchInterval: (query: { state: { data?: PTMOnlineSlotRow[] } }) =>
        roomsPending(query.state.data) ? ROOM_POLL_MS : false,
    })),
    combine: combineGrids,
  });
}

/** One row of ptm_online_my_sessions(): one teacher the calling student is
 *  with on an online PTM, and their booking with that teacher if any. A
 *  student with several teachers on one PTM gets several rows (spec
 *  2026-10-09); an older server returns one per PTM. */
export interface PTMOnlineMySession {
  ptm_id: string;
  teacher_id: string;
  teacher_name: string;
  class_id: string;
  booking_id: string | null;
  slot_time: string | null;
  meet_uri: string | null;
  meet_ready: boolean;
  booking_closes_at: string;
  can_change: boolean;
  /** The booked slot's bounds in the school's timezone; null without a booking. */
  slot_starts_at: string | null;
  slot_ends_at: string | null;
  /** The teacher's own hours when narrower than the meeting's (2026-10-06);
   *  absent or null = the meeting's window. Optional until the server returns it. */
  teacher_start_time?: string | null;
  teacher_end_time?: string | null;
  /** Class sessions (probe level `sessions`): the family's session hours. */
  class_session_id?: string | null;
  session_start_time?: string | null;
  session_end_time?: string | null;
}

/** Every online PTM the student is a participant of (recent and upcoming,
 *  the server bounds it to 50). One call for the whole list. */
export function usePTMOnlineMySessions(enabled = true) {
  return useQuery({
    queryKey: ptmKeys.onlineMySessions,
    queryFn: async (): Promise<PTMOnlineMySession[]> => {
      const rows = await callPtmRpc<PTMOnlineMySession[] | null>("ptm_online_my_sessions", {
        _ptm_id: null,
      });
      return rows ?? [];
    },
    enabled,
    staleTime: 60_000,
    // As the grid: poll each minute only while my booked slot's room is due.
    refetchInterval: (query) => (roomsPending(query.state.data) ? ROOM_POLL_MS : false),
  });
}

export interface CreateOnlinePTMInput {
  institutionId: string;
  hat: PTMHat;
  title: string;
  description: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  slotBufferMinutes: number;
  bookingCutoffMinutes: number;
  feedbackEditDays: number;
  /** Admin or coordinator: the participating teachers. Null for a teacher,
   *  who is the one teacher of their own PTM. */
  teacherIds: string[] | null;
  /** Admin or coordinator: teachers whose hours are narrower than the
   *  meeting's (Naman, 2026-10-06: "Meera 12:00 to 3:00, Ravi 3:00 to 6:00").
   *  Only the teachers with their own hours; the rest run the whole window.
   *  Sent as `_teacher_windows` only when non-empty, so a PTM without custom
   *  hours calls the RPC exactly as before (NEEDS DB for the parameter). */
  teacherWindows?: { teacherId: string; startTime: string; endTime: string }[];
  /** Teacher: the students they picked. Admin or coordinator: null (each
   *  teacher picks their own afterwards). */
  studentIds: string[] | null;
  /** Admin or coordinator (2026-10-06, class sessions): one entry per chosen
   *  class with its hours and teachers. Sent as `_class_sessions` ONLY at
   *  probe level `sessions`; below it the sheet flattens the boxes into
   *  `teacherIds` / `teacherWindows` (`flattenForLegacyServer`), so today's
   *  server gets the call it knows. */
  classSessions?: ClassSessionPayloadRow[];
}

/** One row of `_class_sessions` (spec 2026-10-06, section 5.2). */
export interface ClassSessionPayloadRow {
  class_id: string;
  start_time: string | null;
  end_time: string | null;
  teacher_ids: string[];
  student_ids: string[];
}

/**
 * Create an online PTM: the schedule row, its teachers and (for a teacher
 * creator) their students, in ONE server transaction. The busy-teacher
 * guard and the invitation fan-out run inside it. Single-flight through
 * `isPending` on the sheet's button.
 */
export function useCreateOnlinePTM() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOnlinePTMInput): Promise<string> =>
      callPtmRpc<string>("create_online_ptm", {
        _institution_id: input.institutionId,
        _title: input.title.trim(),
        _description: input.description.trim() || null,
        _scheduled_date: input.scheduledDate,
        _start_time: input.startTime,
        _end_time: input.endTime,
        _slot_duration_minutes: input.slotDurationMinutes,
        _slot_buffer_minutes: input.slotBufferMinutes,
        _as_role: input.hat,
        _teacher_ids: input.teacherIds,
        _student_ids: input.studentIds,
        _booking_cutoff_minutes: input.bookingCutoffMinutes,
        _feedback_edit_days: input.feedbackEditDays,
        ...(input.classSessions ? { _class_sessions: input.classSessions } : {}),
        ...(input.teacherWindows && input.teacherWindows.length > 0
          ? {
              _teacher_windows: input.teacherWindows.map((w) => ({
                teacher_id: w.teacherId,
                start_time: w.startTime,
                end_time: w.endTime,
              })),
            }
          : {}),
      }),
    onSuccess: (_id, input) => {
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-teacher-busy-windows"] });
      toast.success(
        input.hat === "teacher"
          ? "Online PTM scheduled. The families you picked have been notified."
          : "Online PTM scheduled. Each teacher has been asked to pick their students.",
      );
    },
    onError: (e: Error, input) => {
      // The class-session parameters go up only when the probe saw the table,
      // so PGRST202 here means the RPC lags the table (a half-applied
      // migration). Name it rather than show the generic line.
      if (input.classSessions && (e as { code?: string }).code === "PGRST202") {
        toastError(new Error("Class sessions aren't available on the server yet. Try again after the next update."), {
          fallback: "Couldn't schedule the online PTM.",
          context: "createOnlinePTM",
        });
        return;
      }
      toastError(e, { fallback: "Couldn't schedule the online PTM.", context: "createOnlinePTM" });
    },
  });
}

/** What set_ptm_online_teachers did. `refused` names each teacher it could
 *  not add or remove and why (`no_google_email`, `not_a_teacher`,
 *  `out_of_scope`, `busy`, `has_bookings`). */
export interface SetOnlineTeachersResult {
  added: number;
  removed: number;
  kept: number;
  refused: { teacher_id: string; full_name: string; reason: string }[];
}

const TEACHER_REFUSAL: Record<string, string> = {
  // no_google_email is gone from the server since 20261006120000; kept so an
  // older deploy still reads well.
  no_google_email: "no Google account set for them",
  not_a_teacher: "not a teacher here",
  out_of_scope: "outside the classes you cover",
  busy: "in another PTM at that time",
  has_bookings: "families have booked with them",
  // 20261006140000: new hours would leave a booked family outside them.
  hours_has_bookings: "families have booked slots outside those hours",
  not_in_class: "does not teach that class",
  double_booked: "in two of these classes at the same time",
};

/**
 * Replace the participating teachers of an admin-made online PTM. One
 * server transaction diffs the list: a teacher whose families have booked
 * is kept and named, a busy or Google-less teacher is not added and named.
 * A teacher-made PTM refuses any change (its one teacher is fixed).
 */
export function useSetPTMOnlineTeachers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ptmId: string; teacherIds: string[] }) => {
      const result = await callPtmRpc<SetOnlineTeachersResult | null>("set_ptm_online_teachers", {
        _ptm_id: input.ptmId,
        _teacher_ids: input.teacherIds,
      });
      return result ?? { added: 0, removed: 0, kept: 0, refused: [] };
    },
    onSuccess: (result, input) => {
      queryClient.invalidateQueries({ queryKey: ptmKeys.onlineSessions(input.ptmId) });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-grid", input.ptmId] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-teacher-busy-windows"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-feedback-summary"] });
      toast.success(`Teachers saved: ${result.added} added, ${result.removed} removed.`);
      if (result.refused.length > 0) {
        const lines = result.refused
          .slice(0, 5)
          .map((r) => `${r.full_name}: ${TEACHER_REFUSAL[r.reason] ?? r.reason}`);
        const more = result.refused.length - lines.length;
        toastWarning(
          `${result.refused.length} ${result.refused.length === 1 ? "change was" : "changes were"} not made`,
          `${lines.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`,
        );
      }
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save the teachers.", context: "setPTMOnlineTeachers" }),
  });
}

/** What set_ptm_online_class_sessions did (spec 2026-10-06, section 5.2). */
export interface SetOnlineClassSessionsResult {
  added: number;
  removed: number;
  kept: number;
  hours_changed: number;
  refused: { class_id: string; class_name: string | null; teacher_id: string | null; full_name: string | null; reason: string }[];
}

/**
 * Replace the class sessions of an admin-made online PTM: classes, their
 * hours and their teachers, diffed by the server in ONE transaction. A class
 * or teacher with bookings, or hours that would strand a booking, is kept
 * and named. Students are not part of this call (set_ptm_online_students).
 * Only reachable at probe level `sessions`.
 */
export function useSetPTMOnlineClassSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ptmId: string; classSessions: ClassSessionPayloadRow[] }) => {
      const result = await callPtmRpc<SetOnlineClassSessionsResult | null>("set_ptm_online_class_sessions", {
        _ptm_id: input.ptmId,
        _class_sessions: input.classSessions,
      });
      return result ?? { added: 0, removed: 0, kept: 0, hours_changed: 0, refused: [] };
    },
    onSuccess: (result, input) => {
      queryClient.invalidateQueries({ queryKey: ptmKeys.onlineSessions(input.ptmId) });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-grid", input.ptmId] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-teacher-busy-windows"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-feedback-summary"] });
      const parts = [`${result.added} added`, `${result.removed} removed`];
      if (result.hours_changed > 0) parts.push(`hours changed for ${result.hours_changed}`);
      toast.success(`Classes and teachers saved: ${parts.join(", ")}.`);
      if (result.refused.length > 0) {
        const lines = result.refused
          .slice(0, 5)
          .map((r) => `${[r.class_name, r.full_name].filter(Boolean).join(", ")}: ${TEACHER_REFUSAL[r.reason] ?? r.reason}`);
        const more = result.refused.length - lines.length;
        toastWarning(
          `${result.refused.length} ${result.refused.length === 1 ? "change was" : "changes were"} not made`,
          `${lines.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`,
        );
      }
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save the classes and teachers.", context: "setPTMOnlineClassSessions" }),
  });
}

/** What swap_ptm_online_teacher did. */
export interface SwapOnlineTeacherResult {
  moved_students: number;
  moved_bookings: number;
  /** Participants the new teacher does not teach; they keep their slot. */
  out_of_scope_students: number;
}

/**
 * Hand one teacher's whole session to another (admin only). The students,
 * their bookings and the slots carry over in one transaction; the families
 * are told; the Meet rooms are made again with the new teacher as co-host.
 */
export function useSwapPTMOnlineTeacher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ptmId: string; fromTeacherId: string; toTeacherId: string; toName: string }) => {
      const result = await callPtmRpc<SwapOnlineTeacherResult | null>("swap_ptm_online_teacher", {
        _ptm_id: input.ptmId,
        _from_teacher: input.fromTeacherId,
        _to_teacher: input.toTeacherId,
      });
      return result ?? { moved_students: 0, moved_bookings: 0, out_of_scope_students: 0 };
    },
    onSuccess: (result, input) => {
      queryClient.invalidateQueries({ queryKey: ptmKeys.onlineSessions(input.ptmId) });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-grid", input.ptmId] });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-pick-options"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-teacher-busy-windows"] });
      toast.success(
        `Moved ${result.moved_students} ${result.moved_students === 1 ? "student" : "students"} and ${result.moved_bookings} ${result.moved_bookings === 1 ? "booking" : "bookings"} to ${input.toName}.`,
      );
      if (result.out_of_scope_students > 0) {
        toastWarning(
          `${result.out_of_scope_students} ${result.out_of_scope_students === 1 ? "student is" : "students are"} not in a class ${input.toName} teaches`,
          "They keep their slot; check the list is still right.",
        );
      }
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't swap the teacher.", context: "swapPTMOnlineTeacher" }),
  });
}

/** What set_ptm_online_students did, so the sheet can say it. */
export interface SetOnlineStudentsResult {
  added: number;
  removed: number;
  kept: number;
  cancelled_bookings: number;
  refused: { student_id: string; full_name: string; reason: string }[];
}

const STUDENT_REFUSAL: Record<string, string> = {
  // Gone once a student may be with several teachers (spec 2026-10-09);
  // kept so an older server still reads well.
  taken: "already with another teacher",
  not_your_class: "not in a class you teach",
  not_a_student: "not a student here",
  no_single_class: "in more than one class, so the PTM cannot place them",
};

/**
 * Replace the calling teacher's student list for one online PTM. The
 * server diffs the list in one transaction, names anyone it refuses,
 * cancels the booking (with this teacher) of anyone removed, and notifies
 * the newcomers. A student may be on several teachers' lists (spec
 * 2026-10-09); an older server still refuses the second teacher as `taken`.
 */
export function useSetPTMOnlineStudents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ptmId: string; studentIds: string[]; classSessionId?: string | null }) => {
      const result = await callPtmRpc<SetOnlineStudentsResult | null>("set_ptm_online_students", {
        _ptm_id: input.ptmId,
        _student_ids: input.studentIds,
        _teacher_id: null,
        // Probe level `sessions`: which class session's list this is; sent
        // only when known, so the flat server sees the call it knows.
        ...(input.classSessionId ? { _class_session_id: input.classSessionId } : {}),
      });
      return result ?? { added: 0, removed: 0, kept: 0, cancelled_bookings: 0, refused: [] };
    },
    onSuccess: (result, input) => {
      queryClient.invalidateQueries({ queryKey: ptmKeys.onlineSessions(input.ptmId) });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-pick-options"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-online-grid", input.ptmId] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-feedback-summary"] });
      const parts = [`${result.added} added`, `${result.removed} removed`];
      if (result.cancelled_bookings > 0) {
        parts.push(
          `${result.cancelled_bookings} ${result.cancelled_bookings === 1 ? "booking" : "bookings"} cancelled`,
        );
      }
      toast.success(`Student list saved: ${parts.join(", ")}.`);
      if (result.refused.length > 0) {
        const named = result.refused.slice(0, 5).map((r) => `${r.full_name}: ${STUDENT_REFUSAL[r.reason] ?? r.reason}`);
        const more = result.refused.length - named.length;
        toastWarning(
          `${result.refused.length} ${result.refused.length === 1 ? "student was" : "students were"} not added`,
          `${named.join("; ")}${more > 0 ? ` and ${more} more` : ""}.`,
        );
      }
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save the student list.", context: "setPTMOnlineStudents" }),
  });
}
