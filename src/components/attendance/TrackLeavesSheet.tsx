import { ClipboardList, CalendarX2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { LeaveReviewList } from "@/components/attendance/LeaveReviewList";
import { useMyLeaveRequests, useCancelLeave } from "@/hooks/useStudentLeave";

export function TrackLeavesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const list = useMyLeaveRequests(0);
  const cancel = useCancelLeave();
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Your leave requests"
      subtitle="Track approval status." icon={<ClipboardList className="h-4 w-4" />}>
      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-card" />)}</div>
      ) : list.isError ? (
        <EmptyState size="sm" tone="rose" icon={<CalendarX2 className="h-4 w-4" />} title="Couldn't load your requests" description="Please try again in a moment." />
      ) : (
        <LeaveReviewList rows={list.data ?? []} variant="student"
          onCancel={(id) => cancel.mutate(id)} busyId={cancel.isPending ? cancel.variables ?? null : null} />
      )}
    </MobileSheet>
  );
}
