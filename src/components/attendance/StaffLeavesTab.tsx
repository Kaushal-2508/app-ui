import { useState } from "react";
import { CalendarX2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeaveReviewList } from "@/components/attendance/LeaveReviewList";
import { useScopedLeaveRequests, useReviewLeave, type LeaveStatus } from "@/hooks/useStudentLeave";
import { useScopedAttendanceClasses } from "@/hooks/useClassAttendance";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { formatClassName } from "@/lib/utils";

const FILTERS: { value: LeaveStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export function StaffLeavesTab() {
  const [status, setStatus] = useState<LeaveStatus | "all">("pending");
  const [classId, setClassId] = useState<string>("all");
  const { data: classes, isLoading: classesLoading } = useScopedAttendanceClasses();
  const { hasDualRole } = useActiveRole();
  // RLS returns the union of every role the account holds. For a dual-role
  // user, "All classes" means the ACTIVE view's classes (which
  // useScopedAttendanceClasses already resolves), not both views merged.
  const viewClassIds = hasDualRole ? (classes ?? []).map((c) => c.id) : null;
  const list = useScopedLeaveRequests({
    classId: classId === "all" ? null : classId,
    classIds: classId === "all" ? viewClassIds : null,
    status,
    page: 0,
    enabled: !hasDualRole || !classesLoading,
  });
  const review = useReviewLeave();
  const act = (id: string, decision: "approved" | "rejected") => review.mutate({ requestId: id, decision });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MobileTabs
          value={status}
          onValueChange={(v) => setStatus(v as LeaveStatus | "all")}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        />
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {(classes ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {formatClassName(c.name, c.section)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.isLoading || (hasDualRole && classesLoading) ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState
          tone="rose"
          icon={<CalendarX2 className="h-5 w-5" />}
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
          emptyLabel="No leave requests"
        />
      )}
    </div>
  );
}
