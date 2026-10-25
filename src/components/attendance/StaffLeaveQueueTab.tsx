import { useState } from "react";
import { CalendarX2, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
import { StaffLeaveList } from "@/components/attendance/StaffLeaveList";
import {
  useStaffLeaveQueue,
  useReviewStaffLeave,
  useStaffLeaveReviewAvailable,
  useMyStaffRole,
  STAFF_LEAVE_PAGE_SIZE,
} from "@/hooks/useStaffLeaveRequests";
import type { LeaveStatus } from "@/hooks/useStudentLeave";

const FILTERS: { value: LeaveStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const SCOPE_LINE: Record<"coordinator" | "admin", string> = {
  coordinator: "Requests from teachers in your wing.",
  admin: "Requests from every staff member at the school.",
};

/**
 * Staff leave review, for coordinators and school admins on the Workday
 * page. RLS returns only the rows this reviewer may decide (teacher -> wing
 * coordinator or any admin, coordinator -> admin, admin -> another admin),
 * so the list is the queue. Decisions go through review_staff_leave; while
 * that RPC is missing, school admins decide directly (see the hook) and a
 * coordinator is told the wing's requests go to the admin for now.
 */
export function StaffLeaveQueueTab() {
  const [status, setStatus] = useState<LeaveStatus | "all">("pending");
  const [page, setPage] = useState(0);
  const myRole = useMyStaffRole();
  const available = useStaffLeaveReviewAvailable();
  // The RPC is missing, or the probe could not reach the database (which
  // must not read as "approvals exist"): school admins decide directly.
  const rpcMissing = available.data === false || available.isError;
  const canDecide = available.data === true || (rpcMissing && myRole === "admin");
  // Admins see every request under today's RLS, so the queue is real for
  // them. A coordinator's queue is empty by RLS until the SELECT policy
  // lands: skip the fetch rather than show "nothing to review".
  const list = useStaffLeaveQueue({
    status,
    page,
    enabled: available.isFetched && !(rpcMissing && myRole === "coordinator"),
  });
  const review = useReviewStaffLeave();

  const rows = list.data ?? [];
  const hasNext = rows.length === STAFF_LEAVE_PAGE_SIZE;
  const hasPrev = page > 0;
  // `fromStatus` is the status the button was rendered against (see the hook).
  const act = (id: string, decision: "approved" | "rejected") => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    review.mutate({ requestId: id, decision, fromStatus: row.status });
  };

  if (available.isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
    );
  }

  if (rpcMissing && myRole === "coordinator") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-brand-accent/30 bg-brand-accent/10 px-4 py-3 text-sm">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
        <div className="min-w-0">
          <p className="font-medium text-ink-900">Your wing's requests go to the school admin for now</p>
          <p className="mt-0.5 text-ink-600">This tab fills in once the review step is switched on.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rpcMissing && myRole === "admin" && (
        <p className="text-xs text-ink-500">
          Until the review step is switched on, every staff request comes to school admins. An approval is
          not yet written to attendance.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MobileTabs
          value={status}
          onValueChange={(v) => {
            setStatus(v as LeaveStatus | "all");
            setPage(0);
          }}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        />
        {(myRole === "coordinator" || myRole === "admin") && (
          <p className="text-xs text-ink-500">{SCOPE_LINE[myRole]}</p>
        )}
      </div>
      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState
          tone="rose"
          icon={<CalendarX2 className="h-5 w-5" />}
          title="Couldn't load staff leave requests"
          description="Please try again in a moment."
        />
      ) : (
        <div className="space-y-4">
          <StaffLeaveList
            rows={rows}
            variant="queue"
            onApprove={canDecide ? (id) => act(id, "approved") : undefined}
            onReject={canDecide ? (id) => act(id, "rejected") : undefined}
            busyId={review.isPending ? review.variables?.requestId ?? null : null}
            emptyLabel={page > 0 ? "Nothing on this page" : "No staff leave requests"}
          />
          {(hasPrev || hasNext) && (
            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" size="sm" className="rounded-full" disabled={!hasPrev} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Newer
              </Button>
              <span className="text-xs text-ink-500">Page {page + 1}</span>
              <Button variant="outline" size="sm" className="rounded-full" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Older <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
