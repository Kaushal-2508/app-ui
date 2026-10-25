import { useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/surfaces";
import { LeaveStatusChip } from "@/components/attendance/LeaveStatusChip";
import {
  STAFF_LEAVE_TYPE_LABEL,
  STAFF_ROLE_LABEL,
  type StaffLeaveRow,
  type StaffLeaveQueueRow,
} from "@/hooks/useStaffLeaveRequests";

function fmtRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (start === end) return format(s, "d MMM yyyy");
  return `${format(s, "d MMM")} to ${format(e, "d MMM yyyy")}`;
}

function dayCount(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** "Casual leave, 3 to 5 Oct 2026 (3 days)": names the row a confirm will remove (§9a). */
function describeRow(r: StaffLeaveRow | StaffLeaveQueueRow): string {
  const days = dayCount(r.start_date, r.end_date);
  return `${STAFF_LEAVE_TYPE_LABEL[r.leave_type] ?? r.leave_type} leave, ${fmtRange(r.start_date, r.end_date)} (${days} ${days === 1 ? "day" : "days"})`;
}

/**
 * The staff twin of LeaveReviewList. "mine" is the requester's own list with
 * Withdraw on pending rows; "queue" is the reviewer's list with the
 * requester's name and rung, and Approve / Reject. As on the student list, a
 * reviewed row offers only the OPPOSITE decision, so a reviewer can overturn
 * but never re-submit what the chip already shows.
 */
export function StaffLeaveList({
  rows,
  variant,
  onApprove,
  onReject,
  onWithdraw,
  busyId,
  emptyLabel,
  emptyDescription,
}: {
  rows: (StaffLeaveRow | StaffLeaveQueueRow)[];
  variant: "mine" | "queue";
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onWithdraw?: (id: string) => void;
  busyId?: string | null;
  emptyLabel?: string;
  emptyDescription?: string;
}) {
  // Withdraw is a delete (§9a): confirm first, naming the request. The hook
  // sits above the empty-state return so it runs on every render.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmRow = confirmId ? rows.find((r) => r.id === confirmId) ?? null : null;
  if (rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<CalendarDays className="h-4 w-4" />}
        title={emptyLabel ?? "No leave requests"}
        description={
          emptyDescription ??
          (variant === "mine" ? "Your leave requests will appear here." : "No requests to review right now.")
        }
      />
    );
  }
  return (
    <>
      <ul className="space-y-2">
        {rows.map((r) => {
          const queued = "requesterName" in r ? (r as StaffLeaveQueueRow) : null;
          const busy = busyId === r.id;
          const days = dayCount(r.start_date, r.end_date);
          return (
            <li key={r.id} className="surface-card frosted-shadow rounded-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {queued && (
                    <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                      <span className="truncate">{queued.requesterName ?? "Staff member"}</span>
                      {queued.requesterRole && (
                        <span className="shrink-0 rounded-full bg-ink-400/10 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                          {STAFF_ROLE_LABEL[queued.requesterRole]}
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-sm text-ink-800">{fmtRange(r.start_date, r.end_date)}</p>
                  <p className="text-xs text-ink-500">
                    {STAFF_LEAVE_TYPE_LABEL[r.leave_type] ?? r.leave_type} leave · {days} {days === 1 ? "day" : "days"}
                  </p>
                </div>
                <LeaveStatusChip status={r.status} />
              </div>
              {r.reason && <p className="mt-1.5 text-xs text-ink-600 whitespace-pre-wrap">{r.reason}</p>}
              {r.reviewer_notes && (
                <p className="mt-1 text-xs text-ink-500 italic">Reviewer: “{r.reviewer_notes}”</p>
              )}

              {variant === "queue" && (onApprove || onReject) && (
                <div className="mt-2 flex gap-2">
                  {r.status !== "approved" && onApprove && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onApprove(r.id)} className="rounded-full">
                      <Check className="h-3.5 w-3.5 mr-1 text-emerald-700" />
                      {r.status === "rejected" ? "Change to approved" : "Approve"}
                    </Button>
                  )}
                  {r.status !== "rejected" && onReject && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(r.id)} className="rounded-full">
                      <X className="h-3.5 w-3.5 mr-1 text-rose-700" />
                      {r.status === "approved" ? "Change to rejected" : "Reject"}
                    </Button>
                  )}
                </div>
              )}
              {variant === "mine" && r.status === "pending" && onWithdraw && (
                <div className="mt-2">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmId(r.id)} className="text-ink-500">
                    Withdraw
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <AlertDialog open={!!confirmRow} onOpenChange={(o) => { if (!o) setConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this request?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRow ? `${describeRow(confirmRow)}. ` : ""}
              It will be removed and your reviewer will no longer see it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmRow) onWithdraw?.(confirmRow.id);
                setConfirmId(null);
              }}
            >
              Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
