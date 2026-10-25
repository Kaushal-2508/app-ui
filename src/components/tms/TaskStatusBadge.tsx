import { Badge } from "@/components/ui/badge";
import type { TaskStatus } from "@/hooks/useTasks";
import { cn } from "@/lib/utils";

const statusConfig: Record<TaskStatus, { label: string; className: string }> = {
  open: {
    label: "Open",
    className: "bg-muted text-muted-foreground hover:bg-muted/80",
  },
  in_progress: {
    label: "In Progress",
    className: "bg-blue-100 text-blue-700 hover:bg-blue-100/80",
  },
  done_pending_approval: {
    label: "Done",
    className: "bg-yellow-100 text-yellow-700 hover:bg-yellow-100/80",
  },
  completed: {
    label: "Completed",
    className: "bg-green-100 text-green-700 hover:bg-green-100/80",
  },
  // Sent back by the approver: the assignee still has work to do, so the
  // badge names the work, not the verdict. The board column stays "Rejected".
  rejected: {
    label: "Needs Rework",
    className: "bg-red-100 text-red-700 hover:bg-red-100/80",
  },
};

interface TaskStatusBadgeProps {
  status: TaskStatus;
  /**
   * Cancellation is an overlay, not a `task_status` value: the task keeps the
   * status it was frozen at so resuming restores it. The badge shows the
   * pause instead, because that is what governs what anyone can do next.
   */
  cancelled?: boolean;
  className?: string;
}

export function TaskStatusBadge({ status, cancelled = false, className }: TaskStatusBadgeProps) {
  if (cancelled) {
    return (
      <Badge
        variant="secondary"
        className={cn("bg-slate-200 text-slate-700 hover:bg-slate-200/80", className)}
      >
        Cancelled
      </Badge>
    );
  }

  const config = statusConfig[status];

  return (
    <Badge variant="secondary" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
