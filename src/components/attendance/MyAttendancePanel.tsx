import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AttendanceHistoryView,
} from "@/components/attendance/AttendanceHistoryView";
import { type AttendanceKind } from "@/hooks/useUserAttendanceHistory";

/**
 * Embedded "My Attendance" view used inside the teacher / admin tab
 * strip. Same data block as the standalone detail page, but for the
 * signed-in user. RLS ensures the user only sees their own row.
 */
export function MyAttendancePanel({ kind = "staff" }: { kind?: AttendanceKind }) {
  const { user } = useAuth();
  if (!user) return <Skeleton className="h-64 rounded-card" />;
  return <AttendanceHistoryView userId={user.id} kind={kind} />;
}
