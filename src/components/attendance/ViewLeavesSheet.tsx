import { useState } from "react";
import { ClipboardCheck, CalendarX2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { LeaveReviewList } from "@/components/attendance/LeaveReviewList";
import { useScopedLeaveRequests, useReviewLeave, type LeaveStatus } from "@/hooks/useStudentLeave";
import { MobileTabs } from "@/components/shared/nav";

const FILTERS: { value: LeaveStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export function ViewLeavesSheet({
  open,
  onOpenChange,
  classId,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classId: string;
  className?: string;
}) {
  const [status, setStatus] = useState<LeaveStatus | "all">("pending");
  // Only fetch when the sheet is actually open — this sheet is mounted on every
  // class-roster view, so an always-on query would hit a high-traffic page.
  const list = useScopedLeaveRequests({ classId, status, page: 0, enabled: open });
  const review = useReviewLeave();
  const act = (id: string, decision: "approved" | "rejected") => review.mutate({ requestId: id, decision });

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Leave requests"
      subtitle={className}
      icon={<ClipboardCheck className="h-4 w-4" />}
    >
      <div className="mb-3">
        <MobileTabs
          value={status}
          onValueChange={(v) => setStatus(v as LeaveStatus | "all")}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        />
      </div>
      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState
          size="sm"
          tone="rose"
          icon={<CalendarX2 className="h-4 w-4" />}
          title="Couldn't load leave requests"
          description="Please try again in a moment."
        />
      ) : (
        <LeaveReviewList
          rows={list.data ?? []}
          variant="staff"
          onApprove={(id) => act(id, "approved")}
          onReject={(id) => act(id, "rejected")}
          busyId={review.isPending ? review.variables?.requestId ?? null : null}
        />
      )}
    </MobileSheet>
  );
}
