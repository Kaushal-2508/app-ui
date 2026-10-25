import { cn } from "@/lib/utils";
import type { LeaveStatus } from "@/hooks/useStudentLeave";

const TONE: Record<LeaveStatus, string> = {
  pending:  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
};
const LABEL: Record<LeaveStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

export function LeaveStatusChip({ status }: { status: LeaveStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[status])}>
      {LABEL[status]}
    </span>
  );
}
