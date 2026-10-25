import { format, isPast } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
  CircleUserRound,
  Clock,
  Eye,
  Paperclip,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { TaskTypeBadge } from "@/components/tms/TaskTypeBadge";
import { isTaskCancelled, type Task, type TaskStatus } from "@/hooks/useTasks";
import { priorityMeta, type TaskGroupMeta } from "@/lib/taskBoard";
import { cn } from "@/lib/utils";
import { CardActionsMenu } from "./CardActionsMenu";

interface BoardCardContentProps {
  task: Task;
  isOverlay?: boolean;
  groupMeta?: TaskGroupMeta;
  /** False on the drag overlay so the floating copy carries no menu. */
  interactive?: boolean;
  onRequestMove?: (task: Task, target: TaskStatus) => void;
}

// Only the exceptions get a glyph. Medium is the default for most cards, and
// a dash on every one of them was noise that said nothing.
function PriorityIcon({ priority }: { priority: number | null }) {
  const meta = priorityMeta(priority);
  const label = `${meta.label} priority`;
  if (meta.rank === 0) {
    return <ChevronUp className="h-4 w-4 text-destructive" aria-label={label} role="img" />;
  }
  if (meta.rank === 2) {
    return <ChevronDown className="h-4 w-4 text-ink-400" aria-label={label} role="img" />;
  }
  return null;
}

/**
 * Pure presentation of one board card. Also rendered inside the DragOverlay,
 * so it must not mount anything that owns state across a status change.
 */
export function BoardCardContent({
  task,
  isOverlay = false,
  groupMeta,
  interactive = true,
  onRequestMove,
}: BoardCardContentProps) {
  const cancelled = isTaskCancelled(task);
  const due = task.due_date ? new Date(task.due_date) : null;
  const isOverdue = Boolean(due && isPast(due) && task.status !== "completed" && !cancelled);
  const evidenceCount = task.evidence?.length ?? 0;
  const supervisorCount = task.supervisors?.length ?? 0;

  return (
    <Card
      className={cn(
        "group/card relative space-y-2.5 rounded-xl border-surface-stroke bg-card px-3 py-2.5",
        isOverlay ? "rotate-1 shadow-card-lg" : "shadow-card transition-shadow hover:shadow-card-lg",
        cancelled && "opacity-75",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 pr-7 text-sm font-medium leading-snug text-ink-900 line-clamp-3">
          {task.title}
        </p>
        {/* A group card stands for several people's rows, which move one by
            one in the group detail, so it offers no move menu of its own. */}
        {interactive && !isOverlay && !groupMeta && (
          <div className="absolute right-1.5 top-1.5 opacity-100 focus-within:opacity-100 group-hover/card:opacity-100 md:opacity-0">
            <CardActionsMenu task={task} onRequestMove={onRequestMove} />
          </div>
        )}
      </div>

      {/* Footer: what the task is (type, due, group progress, paused) on the
          left, who is on it (evidence, supervision, priority, assignee) as a
          tight muted cluster pushed right. Both may wrap; when the chips need
          the width the icon cluster drops to its own right-aligned line
          instead of a chip being clipped mid-number ("0/7" read "0/"). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <TaskTypeBadge type={task.task_type} className="h-5 shrink-0 px-1.5 text-[11px]" />
          {isOverdue && due && (
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
              <Clock className="h-3 w-3" aria-hidden />
              {format(due, "d MMM")}
            </span>
          )}
          {task.task_group_id && groupMeta && (
            <span
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-ink-400/10 px-1.5 py-0.5 text-[11px] font-medium text-ink-600"
              title={`Assigned to ${groupMeta.total} people, ${groupMeta.done} done`}
            >
              <Users className="h-3 w-3" aria-hidden />
              {groupMeta.done}/{groupMeta.total}
            </span>
          )}
          {cancelled && (
            <Badge variant="secondary" className="h-5 shrink-0 rounded-md px-1.5 text-[11px] font-medium">
              Paused
            </Badge>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 text-ink-500">
          {evidenceCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums"
              aria-label={`${evidenceCount} evidence ${evidenceCount === 1 ? "file" : "files"}`}
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              {evidenceCount}
            </span>
          )}
          {supervisorCount > 0 && (
            <Eye
              className="h-3.5 w-3.5"
              role="img"
              aria-label={`${supervisorCount} ${supervisorCount === 1 ? "supervisor" : "supervisors"}`}
            />
          )}
          <PriorityIcon priority={task.priority} />
          {groupMeta ? (
            // One card for several people: a single avatar would name only
            // the first of them.
            <Users
              className="h-6 w-6 text-ink-400"
              role="img"
              aria-label={`${groupMeta.total} people`}
            />
          ) : task.assignee_profile ? (
            <UserAvatar
              name={task.assignee_profile.full_name}
              email={task.assignee_profile.email}
              className="h-6 w-6"
              fallbackClassName="text-[10px]"
            />
          ) : (
            <CircleUserRound
              className="h-6 w-6 text-ink-400"
              role="img"
              aria-label="Assignee hidden"
            />
          )}
        </div>
      </div>
    </Card>
  );
}

// The draggable shell (useDraggable, transform, click-vs-drag guard) is owned
// by KanbanBoard via BoardDraggable, so this file exports content only.
// Wrapping it a second time here would register two draggables per card.