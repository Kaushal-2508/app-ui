import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

import {
  DEFAULT_ATTENDANCE_SETTINGS,
  type AttendanceSettingsRow,
} from "@/hooks/useAttendance";

export type StaffAttendanceStatus = "present" | "late" | "absent" | "on_leave" | "holiday";

export interface StaffAttendanceRecord {
  id: string;
  institution_id: string;
  staff_id: string;
  date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: StaffAttendanceStatus;
  auto_marked_absent: boolean;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

const todayStr = () => format(new Date(), "yyyy-MM-dd");

/**
 * Convert a "HH:MM:SS" wall-clock window value into a Date for *today*.
 * Used to classify a check-in timestamp against the institution's window.
 */
function windowDateFor(timeStr: string, refDate = new Date()): Date {
  const [h = 0, m = 0, s = 0] = timeStr.split(":").map((n) => parseInt(n, 10) || 0);
  const d = new Date(refDate);
  d.setHours(h, m, s, 0);
  return d;
}

/**
 * True iff current local clock is past `staff_check_in_time + grace`.
 * Used by:
 *   - SchoolAttendancePage  → decide whether to kick the RPC materializer
 *   - useScopedStaffAttendance → decide whether null-status rows should
 *     render as derived "Absent · syncing"
 *
 * Browser local time is fine here: SALCI is India-only and laptops/phones
 * in the field will be IST. The server's authoritative cutoff still runs
 * in institution-local timezone (see tt_run_attendance_pass_for_institution
 * + institutions.timezone). See CLAUDE.md §24.
 */
export function isPastCutoff(
  settings: Pick<
    AttendanceSettingsRow,
    "staff_check_in_time" | "staff_late_check_in_allowed" | "staff_late_grace_minutes"
  > | null,
  ref: Date = new Date(),
): boolean {
  if (!settings) return false;
  const cutoff = windowDateFor(settings.staff_check_in_time, ref);
  if (settings.staff_late_check_in_allowed) {
    cutoff.setMinutes(cutoff.getMinutes() + (settings.staff_late_grace_minutes ?? 0));
  }
  return ref.getTime() > cutoff.getTime();
}

/**
 * Given a check-in timestamp + the effective settings, return the status
 * the row should be stamped with.
 *
 *   present  — checked in by the cutoff
 *   late     — within the grace window after the cutoff (only if late
 *              check-in is allowed)
 *   absent   — past the grace window, OR late check-ins disallowed and
 *              past the cutoff
 */
export function classifyStaffCheckIn(
  checkInAt: Date,
  settings: Pick<
    AttendanceSettingsRow,
    "staff_check_in_time" | "staff_late_check_in_allowed" | "staff_late_grace_minutes"
  >,
): StaffAttendanceStatus {
  const cutoff = windowDateFor(settings.staff_check_in_time, checkInAt);
  if (checkInAt <= cutoff) return "present";
  if (!settings.staff_late_check_in_allowed) return "absent";
  const graceMs = settings.staff_late_grace_minutes * 60 * 1000;
  if (checkInAt.getTime() - cutoff.getTime() <= graceMs) return "late";
  return "absent";
}

const STAFF_ATTENDANCE_COLUMNS =
  "id, institution_id, staff_id, date, check_in_at, check_out_at, status, auto_marked_absent, remarks, created_at, updated_at";

/**
 * Fetch today's staff attendance row for the signed-in user.
 * Returns `null` (not undefined) when the row doesn't exist yet so the
 * card UI can branch on `data === null` without `isLoading` ambiguity.
 *
 * The date is in the key: the query cache is persisted for a day, and the
 * date-less key handed the next morning yesterday's row (with its Check out
 * button, which updated yesterday's row by id) until the refetch landed.
 * Every write still invalidates the ["staff-attendance"] prefix.
 */
export function useTodayStaffAttendance() {
  const { user } = useAuth();
  const today = todayStr();
  return useQuery({
    queryKey: ["staff-attendance", "today", user?.id, today],
    queryFn: async (): Promise<StaffAttendanceRecord | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("staff_attendance_records")
        .select(STAFF_ATTENDANCE_COLUMNS)
        .eq("staff_id", user.id)
        .eq("date", today)
        .maybeSingle();
      if (error) throw error;
      return (data as StaffAttendanceRecord | null) ?? null;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}

/**
 * Insert today's check-in row. Idempotent: PK uniqueness on
 * (staff_id, date) means a duplicate tap raises 23505 — we surface a
 * friendly toast rather than throwing through to the error boundary.
 */
export function useCheckInStaff() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: {
      institutionId: string;
      settings: AttendanceSettingsRow | null;
    }) => {
      if (!user?.id) throw new Error("You must be signed in to check in.");
      const checkInAt = new Date();
      const effective = params.settings ?? {
        ...DEFAULT_ATTENDANCE_SETTINGS,
        institution_id: params.institutionId,
      };
      // Manual check-ins are never classified as "absent". If someone
      // physically shows up and clicks Check In — even very late — the
      // worst outcome is "late". "Absent" is reserved for the auto-mark
      // job that runs when the user never checks in at all.
      const rawStatus = classifyStaffCheckIn(checkInAt, effective);
      const status: StaffAttendanceStatus = rawStatus === "absent" ? "late" : rawStatus;
      const payload = {
        institution_id: params.institutionId,
        staff_id: user.id,
        date: todayStr(),
        check_in_at: checkInAt.toISOString(),
        status,
        auto_marked_absent: false,
      };
      const { data, error } = await supabase
        .from("staff_attendance_records")
        .insert(payload)
        .select(STAFF_ATTENDANCE_COLUMNS)
        .single();
      if (error) throw error;
      return data as StaffAttendanceRecord;
    },
    onSuccess: (row) => {
      // The greeting button reads this row: show the new state now, not after the refetch.
      if (user?.id) queryClient.setQueryData(["staff-attendance", "today", user.id, row.date], row);
      queryClient.invalidateQueries({ queryKey: ["staff-attendance"] });
      toast.success("Checked in");
    },
    onError: (err: Error) => {
      // 23505 = unique violation: today already has a row. It can be this person's own
      // check-in from another tab or device, an admin's mark, or the attendance pass's absent
      // row, so say only that it exists, and re-read it: the cards and the button then show
      // which it is. "You've already checked in" told people marked absent the opposite.
      if (/duplicate key value/i.test(err.message)) {
        queryClient.invalidateQueries({ queryKey: ["staff-attendance"] });
        toast.info("Today's attendance is already recorded.");
        return;
      }
      toastError(err, { fallback: "Couldn't check you in.", context: "staffCheckIn" });
    },
  });
}

/**
 * Stamp `check_out_at = now()` on today's row, only while it is still open. A second
 * check-out (another tab or device, or the greeting button after the dashboard's card) must
 * never move the time already recorded, and a card left over from yesterday (an app resumed
 * the next morning) must never close yesterday's row, so either matches no row and resolves
 * to `null`.
 */
export function useCheckOutStaff() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (recordId: string): Promise<StaffAttendanceRecord | null> => {
      if (!user?.id) throw new Error("You must be signed in to check out.");
      const payload: { check_out_at: string } = { check_out_at: new Date().toISOString() };
      const { data, error } = await supabase
        .from("staff_attendance_records")
        .update(payload)
        .eq("id", recordId)
        .eq("staff_id", user.id)
        .eq("date", todayStr())
        .is("check_out_at", null)
        .select(STAFF_ATTENDANCE_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return (data as StaffAttendanceRecord | null) ?? null;
    },
    onSuccess: (row) => {
      // The greeting button reads this row: show the new state now, not after the refetch.
      if (row && user?.id) queryClient.setQueryData(["staff-attendance", "today", user.id, row.date], row);
      queryClient.invalidateQueries({ queryKey: ["staff-attendance"] });
      // No row: already checked out, or an admin changed today's record; the refetch shows which.
      if (row) toast.success("Checked out");
      else toast.info("Today's attendance was already updated.");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't check you out.", context: "staffCheckOut" }),
  });
}

/**
 * Admin override — upsert today's `staff_attendance_records` row for an
 * arbitrary staff member. `auto_marked_absent` is forced to false so the
 * card UI knows the row is admin-set. Passing `status: null` deletes the
 * row (Clear status).
 *
 * Flipping a previously-absent teacher to present/late automatically
 * cancels their pending `tt_substitutions` via the existing trigger
 * `tt_substitutions_cancel_on_late_checkin_trg`.
 */
export function useUpsertStaffAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      institutionId: string;
      staffId: string;
      status: StaffAttendanceStatus | null;
      remarks?: string;
    }) => {
      const today = todayStr();
      if (params.status === null) {
        const { error } = await supabase
          .from("staff_attendance_records")
          .delete()
          .eq("staff_id", params.staffId)
          .eq("date", today);
        if (error) throw error;
        return null;
      }
      const payload: {
        institution_id: string;
        staff_id: string;
        date: string;
        status: string;
        auto_marked_absent: boolean;
        check_in_at: string | null;
        remarks: string | null;
      } = {
        institution_id: params.institutionId,
        staff_id: params.staffId,
        date: today,
        status: params.status,
        auto_marked_absent: false,
        check_in_at:
          params.status === "present" || params.status === "late"
            ? new Date().toISOString()
            : null,
        remarks: params.remarks ?? null,
      };
      const { data, error } = await supabase
        .from("staff_attendance_records")
        .upsert(payload, { onConflict: "staff_id,date" })
        .select()
        .single();
      if (error) throw error;
      return data as StaffAttendanceRecord;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-list"] });
      queryClient.invalidateQueries({ queryKey: ["substitutions"] });
      queryClient.invalidateQueries({ queryKey: ["staff-attendance"] });
      toast.success("Attendance updated");
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't update attendance.",
        context: "upsertStaffAttendance",
      }),
  });
}
