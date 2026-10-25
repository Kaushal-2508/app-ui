import type { QueryClient } from "@tanstack/react-query";
import { DASHBOARD_ACTIONS_KEY } from "@/lib/dashboardActionsKey";

/**
 * Cache invalidation for the two student-leave write paths.
 *
 * A leave reaches the same tables whether the student applied for it
 * (`review_student_leave`) or a teacher marked it from the roster
 * (`save_class_attendance`), so both must refresh the same screens. They used
 * to carry two hand-maintained lists and had already drifted: approving a
 * leave left the "Marked today" chip, the coordinator roster and the per-user
 * history showing pre-decision data for up to their staleTime, while the
 * roster save refreshed them. One list, used by both, is the only way that
 * stays true.
 *
 * Every key below is a real prefix of a live query key — a typo silently
 * invalidates nothing, which is indistinguishable from a stale cache.
 */

/** Caches that read `attendance_records`. */
const ATTENDANCE_KEYS = [
  ["attendance"], // useAttendanceByClassDate — the class-day roster
  ["attendance-mark-status"], // useAttendanceClassMarkers — tile chips + marker lock banner
  ["attendance-list"], // useScopedStudentsAttendance — coordinator/admin roster
  ["attendance-report"], // useAttendanceReports — Reports tab pivot + Excel
  ["attendance-analytics"], // useAttendanceAnalytics — reaches the CBSE PDF
  ["user-attendance-history"], // /school/attendance/user/:id + My Attendance
  ["student-attendance"], // useStudentAttendance
  ["student-month-attendance"], // the student's calendar
  ["student-day-attendance"], // the student's day detail
  ["student-attendance-summary"], // the student's dashboard donut + tiles
] as const;

/** Caches that read `leave_requests`. */
const LEAVE_KEYS = [
  ["scoped-leave-requests"], // ViewLeavesSheet + StaffLeavesTab
  ["pending-leave-count"], // the roster header badge
  ["my-leave-requests"], // the student's own Track Leaves
  ["leave-requests"], // legacy useLeaveRequests, still mounted by useCommandCenter
  DASHBOARD_ACTIONS_KEY, // the dashboard's leave card (useMyDashboardActions)
] as const;

/**
 * Invalidate everything a student-attendance write can change.
 *
 * @param leave pass false only when the write provably touched no leave
 *              record; the default refreshes both planes.
 */
export function invalidateAttendanceCaches(qc: QueryClient, opts?: { leave?: boolean }) {
  for (const queryKey of ATTENDANCE_KEYS) {
    qc.invalidateQueries({ queryKey });
  }
  if (opts?.leave !== false) {
    for (const queryKey of LEAVE_KEYS) {
      qc.invalidateQueries({ queryKey });
    }
  }
}
