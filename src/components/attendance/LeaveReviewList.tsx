import { format } from "date-fns";
import { CalendarDays, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces";
import { LeaveStatusChip } from "@/components/attendance/LeaveStatusChip";
import { LEAVE_TYPE_LABEL, type LeaveRequestRow, type ScopedLeaveRow } from "@/hooks/useStudentLeave";
import { formatClassName } from "@/lib/utils";

function fmtRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (start === end) return format(s, "d MMM yyyy");
  return `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
}

export function LeaveReviewList({
  rows, variant, onApprove, onReject, onCancel, busyId, emptyLabel,
}: {
  rows: (LeaveRequestRow | ScopedLeaveRow)[];
  variant: "student" | "staff";
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onCancel?: (id: string) => void;
  busyId?: string | null;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState size="sm" icon={<CalendarDays className="h-4 w-4" />}
        title={emptyLabel ?? "No leave requests"}
        description={variant === "student" ? "Your leave requests will appear here." : "No requests to review right now."} />
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const scoped = "studentName" in r ? (r as ScopedLeaveRow) : null;
        const busy = busyId === r.id;
        return (
          <li key={r.id} className="surface-card frosted-shadow rounded-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {scoped && (
                  <>
                    <p className="text-sm font-medium text-ink-900 truncate">{scoped.studentName ?? "Student"}</p>
                    {/* The class comes with the row (Naman, 2026-10-07: "there is
                        no mention of classes in leaves"); a reviewer of several
                        classes needs it beside the roll number. */}
                    {(scoped.className || scoped.studentRoll) && (
                      <p className="text-xs text-ink-600">
                        {scoped.className ? formatClassName(scoped.className, scoped.classSection) : null}
                        {scoped.className && scoped.studentRoll ? " · " : null}
                        {scoped.studentRoll ? `Roll ${scoped.studentRoll}` : null}
                      </p>
                    )}
                  </>
                )}
                <p className="text-sm text-ink-800">{fmtRange(r.start_date, r.end_date)}</p>
                <p className="text-xs text-ink-500">
                  {LEAVE_TYPE_LABEL[r.leave_type] ?? r.leave_type} leave
                  {r.source === "staff" && (
                    <span className="text-ink-400"> · marked by the school</span>
                  )}
                </p>
              </div>
              <LeaveStatusChip status={r.status} />
            </div>
            <p className="mt-1.5 text-xs text-ink-600 whitespace-pre-wrap">{r.reason}</p>
            {r.reviewer_notes && (
              <p className="mt-1 text-xs text-ink-500 italic">Reviewer: “{r.reviewer_notes}”</p>
            )}

            {/* Pending: both decisions. Reviewed: only the OPPOSITE decision, so a
                reviewer can overturn (review_student_leave accepts any status) but
                never re-submits the decision the chip already shows. */}
            {variant === "staff" && (onApprove || onReject) && (
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
            {variant === "student" && r.status === "pending" && onCancel && (
              <div className="mt-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCancel(r.id)} className="text-ink-500">
                  Withdraw
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
