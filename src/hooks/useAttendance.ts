import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateAttendanceCaches } from "@/lib/attendanceCache";
import type { LeaveType } from "@/hooks/useStudentLeave";

/**
 * Student attendance statuses. Mirrors `attendance_records_status_check`.
 *
 * `leave` (2026-09-03) is an approved day off, written by BOTH leave paths:
 * a teacher marking it straight from the roster, and `review_student_leave`
 * approving a student's application. It is excused, so it sits outside the
 * present/(present+absent) percentage rather than counting either way.
 * `sick`/`casual` predate it and are effectively dead (3 rows in prod).
 */
export type AttendanceStatus = "present" | "absent" | "leave" | "sick" | "casual" | "holiday";
export type AttendanceMethod = "manual" | "biometric" | "facial_recognition" | "mobile_checkin";

export interface AttendanceRecord {
  id: string;
  institution_id: string;
  class_id: string;
  student_id: string;
  date: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  marked_by: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
  substitution_id?: string | null;
}

export interface AttendanceSettingsRow {
  id?: string;
  institution_id: string;
  notify_parents_on_absent: boolean;
  absent_threshold_days: number;
  tracking_methods: string[];
  staff_check_in_time: string;
  staff_check_out_time: string;
  staff_late_check_in_allowed: boolean;
  staff_late_grace_minutes: number;
  staff_substitution_enabled: boolean;
  max_subs_per_teacher_per_day: number;
  coordinators_in_sub_pool: boolean;
  /** Legacy hours-based window — superseded by the days-based window below. */
  student_attendance_edit_window_hours: number;
  /** Teachers can view/edit class attendance dated within this many days back (today included). */
  student_attendance_edit_window_days: number;
}

/**
 * Defaults applied when no `attendance_settings` row exists yet — used by
 * the settings UI so admins see sensible values before their first save,
 * and by Phase 3+ flows that need an "effective" config when reading.
 * Mirrors the column defaults in 20260508100000_attendance_phase1_schema.
 */
export const DEFAULT_ATTENDANCE_SETTINGS: Omit<AttendanceSettingsRow, "institution_id" | "id"> = {
  notify_parents_on_absent: true,
  absent_threshold_days: 3,
  tracking_methods: ["manual"],
  staff_check_in_time: "08:00:00",
  staff_check_out_time: "16:00:00",
  staff_late_check_in_allowed: true,
  staff_late_grace_minutes: 30,
  staff_substitution_enabled: true,
  max_subs_per_teacher_per_day: 2,
  coordinators_in_sub_pool: false,
  student_attendance_edit_window_hours: 12,
  student_attendance_edit_window_days: 2,
};

export function useAttendanceByClassDate(classId: string | null, date: string | null) {
  return useQuery({
    queryKey: ["attendance", classId, date],
    queryFn: async () => {
      if (!classId || !date) return [];
      const { data, error } = await supabase
        .from("attendance_records")
        .select(
          "id, institution_id, class_id, student_id, date, status, method, marked_by, remarks, created_at, updated_at, substitution_id",
        )
        .eq("class_id", classId)
        .eq("date", date)
        .limit(500); // bounded by section size; largest sections are well under this
      if (error) throw error;
      return data as AttendanceRecord[];
    },
    enabled: !!classId && !!date,
    staleTime: 60_000,
  });
}

export function useStudentAttendance(studentId?: string) {
  return useQuery({
    queryKey: ["student-attendance", studentId],
    queryFn: async () => {
      const id = studentId;
      if (!id) return [];
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*")
        .eq("student_id", id)
        .order("date", { ascending: false })
        .limit(90);
      if (error) throw error;
      return data as AttendanceRecord[];
    },
    enabled: !!studentId,
  });
}

/**
 * Remarks stamped on an attendance row whose `leave` came from a teacher
 * marking the roster (as opposed to `'Leave approved'`, which comes from
 * `review_student_leave` approving a student's own application).
 *
 * The literal is duplicated in `save_class_attendance`; keep the two in
 * step. It lets the roster tell the two origins apart from the records it
 * already fetches, with no extra query on a high-traffic screen.
 */
export const TEACHER_LEAVE_REMARK = "Leave marked by teacher";

/** Remarks written by `review_student_leave` when it approves an application. */
export const APPROVED_LEAVE_REMARK = "Leave approved";

export interface ClassAttendanceSaveRow {
  student_id: string;
  status: AttendanceStatus;
  /** Required when status is `leave`; ignored otherwise. */
  leave_type?: LeaveType | null;
  /** Required when status is `leave`; ignored otherwise. */
  reason?: string | null;
}

export interface ClassAttendanceSaveResult {
  marked: number;
  leaves_created: number;
  leaves_updated: number;
  /**
   * Leaves the save deliberately did NOT rewrite: a leave the student applied
   * for themselves, or a multi-day leave. The roster cannot detect either from
   * the records it holds, so the count comes back from the RPC and is
   * surfaced — otherwise a re-typed reason silently vanishes behind a
   * "saved successfully" toast.
   */
  leaves_kept: number;
  leaves_withdrawn: number;
}

/**
 * Saves a whole class-day in ONE transaction via `save_class_attendance`.
 *
 * The roster can now write three statuses, and a `leave` row has to land in
 * `attendance_records` AND `leave_requests` together — two dependent writes,
 * so they belong in a single RPC rather than sequential client calls
 * (CLAUDE.md §9a). The RPC also withdraws a teacher-marked leave when a
 * student is flipped back to present/absent, which no client-side DELETE
 * could do (staff hold no write policy on `leave_requests`).
 *
 * Idempotent: attendance upserts on UNIQUE(class_id, student_id, date) and
 * leave creation reuses an approved row already covering the date, so a
 * double-tap or a retry cannot duplicate anything.
 */
export function useSaveClassAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      classId: string;
      date: string;
      rows: ClassAttendanceSaveRow[];
    }): Promise<ClassAttendanceSaveResult> => {
      const { data, error } = await supabase.rpc("save_class_attendance", {
        p_class_id: input.classId,
        p_date: input.date,
        p_rows: input.rows as unknown as Json,
      });
      if (error) throw error;
      return data as unknown as ClassAttendanceSaveResult;
    },
    onSuccess: (result) => {
      // Shared with useReviewLeave: both leave paths change the same screens,
      // so they refresh through one list (src/lib/attendanceCache.ts).
      invalidateAttendanceCaches(queryClient);
      toast.success("Attendance saved successfully");
      const kept = result?.leaves_kept ?? 0;
      if (kept > 0) {
        toast.info(
          kept === 1
            ? "One student was already on leave for this date. Their existing leave record was kept as it is."
            : `${kept} students were already on leave for this date. Their existing leave records were kept as they are.`,
        );
      }
    },
    onError: (err: Error) => {
      toastError(err, { fallback: "Couldn't save attendance.", context: "saveClassAttendance" });
    },
  });
}

export function useUpsertAttendance() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (records: {
      institution_id: string;
      class_id: string;
      student_id: string;
      date: string;
      status: AttendanceStatus;
      method: AttendanceMethod;
      remarks?: string;
    }[]) => {
      const withMarker = records.map((r) => ({
        ...r,
        marked_by: user?.id,
      }));
      const { error } = await supabase
        .from("attendance_records")
        .upsert(withMarker, { onConflict: "class_id,student_id,date" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success("Attendance saved successfully");
    },
    onError: (err: Error) => {
      toastError(err, { fallback: "Couldn't save attendance.", context: "upsertAttendance" });
    },
  });
}

export function useAttendanceSettings(institutionId: string | null) {
  return useQuery({
    queryKey: ["attendance-settings", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("attendance_settings")
        .select("*")
        .eq("institution_id", institutionId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
    staleTime: 60_000,
  });
}

/**
 * Returns the effective settings: the DB row merged over the column defaults.
 * Use this anywhere a downstream flow (cron, substitution engine, edit-window
 * check) needs *some* value even before an admin has saved the form.
 */
export function useEffectiveAttendanceSettings(
  institutionId: string | null,
): AttendanceSettingsRow | null {
  const { data } = useAttendanceSettings(institutionId);
  if (!institutionId) return null;
  const row = (data ?? {}) as Partial<AttendanceSettingsRow>;
  return {
    institution_id: institutionId,
    ...DEFAULT_ATTENDANCE_SETTINGS,
    ...row,
  };
}

export function useUpsertAttendanceSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Partial<AttendanceSettingsRow> & { institution_id: string }) => {
      const { error } = await supabase
        .from("attendance_settings")
        .upsert(settings, { onConflict: "institution_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance-settings"] });
      toast.success("Settings saved");
    },
    onError: (err: Error) => {
      toastError(err, { fallback: "Couldn't save the settings.", context: "upsertAttendanceSettings" });
    },
  });
}
