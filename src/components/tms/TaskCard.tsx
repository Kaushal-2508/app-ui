import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { TaskTypeBadge } from "./TaskTypeBadge";
import { useUpdateTaskStatus, useCurrentUser, isTaskCancelled } from "@/hooks/useTasks";
import type { Task } from "@/hooks/useTasks";
import { TaskManageActions } from "./TaskManageActions";
import { useSupportInstitutionId } from "@/hooks/useSupportRequest";
import { CalendarDays, User, Clock, Play, Send, CheckCircle, XCircle } from "lucide-react";
import { formatDistanceToNow, format, isPast, isThisYear } from "date-fns";
import { cn } from "@/lib/utils";
import { isNativePlatform } from "@/lib/native";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  showAssigner?: boolean;
  showAssignee?: boolean;
}

export function TaskCard({ task, onClick, showAssigner = true, showAssignee = false }: TaskCardProps) {
  const { data: currentUser } = useCurrentUser();
  const updateStatus = useUpdateTaskStatus();
  const { data: supportInstitutionId } = useSupportInstitutionId();

  const cancelled = isTaskCancelled(task);

  // Salci Support tickets never use the approval ladder: their assigner is the
  // reporter, so done_pending_approval dead-ends (approving needs the assigner,
  // who is blocked from writing any status). SALCI closes them in one step from
  // the detail sheet instead.
  const isSupportTask = Boolean(
    supportInstitutionId && task.institution_id === supportInstitutionId,
  );

  const isOverdue = task.due_date && isPast(new Date(task.due_date)) &&
    task.status !== "completed" && !cancelled;

  const isAssignee = currentUser?.id === task.assignment?.assignee_id;
  const isAssigner = currentUser?.id === task.assignment?.assigner_id;

  // A cancelled task is frozen: the DB rejects every transition, so offering
  // the buttons would only produce errors.
  const canStartTask = isAssignee && task.status === "open" && !cancelled;
  const canMarkDone =
    isAssignee && task.status === "in_progress" && !cancelled && !isSupportTask;
  const canRework = isAssignee && task.status === "rejected" && !cancelled;
  const canComplete =
    isAssigner && task.status === "done_pending_approval" && !cancelled && !isSupportTask;
  const canReject =
    isAssigner && task.status === "done_pending_approval" && !cancelled && !isSupportTask;

  const handleStartTask = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateStatus.mutate({ taskId: task.id, status: "in_progress" });
  };

  const handleMarkDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateStatus.mutate({ taskId: task.id, status: "done_pending_approval" });
  };

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateStatus.mutate({ taskId: task.id, status: "completed" });
  };

  const handleReject = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateStatus.mutate({ taskId: task.id, status: "rejected" });
  };

  const handleRework = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateStatus.mutate({ taskId: task.id, status: "in_progress" });
  };

  const hasStatusActions = canStartTask || canMarkDone || canRework || canComplete || canReject;

  // In the app a card is a glanceable row: title, status, who and when, and
  // the one next step. The labels ("From:", "Assigned to:"), the "Updated ...
  // ago" line and the owner's manage buttons stay on the web card; in the app
  // they live in the detail sheet the tap opens (2026-09-18 phone test).
  const native = isNativePlatform();
  const dueLabel = task.due_date
    ? format(new Date(task.due_date), isThisYear(new Date(task.due_date)) ? "MMM d" : "MMM d, yyyy")
    : null;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md hover:border-primary/20",
        isOverdue && "border-destructive/50",
        cancelled && "opacity-75",
      )}
      onClick={onClick}
    >
      <CardHeader className={native ? "p-4 pb-1.5" : "pb-2"}>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-medium line-clamp-2">
            {task.title}
          </CardTitle>
          <TaskStatusBadge status={task.status} cancelled={cancelled} />
        </div>
      </CardHeader>
      <CardContent className={native ? "space-y-2 p-4 pt-0" : "space-y-3"}>
        <div className="flex flex-wrap gap-2">
          <TaskTypeBadge type={task.task_type} />
          {task.priority === 1 && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
              High Priority
            </span>
          )}
        </div>

        {task.description && (
          <p className={cn("text-sm text-muted-foreground", native ? "line-clamp-1" : "line-clamp-2")}>
            {task.description}
          </p>
        )}

        {cancelled && (
          <p className="rounded-lg bg-muted/60 px-2 py-1.5 text-xs text-ink-500">
            Paused. Everything done so far is kept.
            {task.cancel_reason ? ` Reason: ${task.cancel_reason}` : ""}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {showAssigner && task.assigner_profile && (
            <div className="flex min-w-0 items-center gap-1">
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {native ? `From ${task.assigner_profile.full_name}` : `From: ${task.assigner_profile.full_name}`}
              </span>
            </div>
          )}

          {showAssignee && task.assignee_profile && (
            <div className="flex min-w-0 items-center gap-1">
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {native ? `To ${task.assignee_profile.full_name}` : `Assigned to: ${task.assignee_profile.full_name}`}
              </span>
            </div>
          )}

          {dueLabel && (
            <div className={cn(
              "flex items-center gap-1",
              isOverdue && "text-destructive font-medium"
            )}>
              <CalendarDays className="h-3 w-3 shrink-0" />
              <span>{native ? (isOverdue ? `Overdue ${dueLabel}` : `Due ${dueLabel}`) : `Due: ${dueLabel}`}</span>
            </div>
          )}

          {!native && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>
                Updated {formatDistanceToNow(new Date(task.updated_at), { addSuffix: true })}
              </span>
            </div>
          )}
        </div>

        {/* Owner actions: delete while untouched, cancel once started, resume
            when paused. Web only on the card; the app offers them in the
            detail sheet, where TaskDetailPanel already mounts them. */}
        {!native && (
          <div className="pt-2" onClick={(e) => e.stopPropagation()}>
            <TaskManageActions task={task} />
          </div>
        )}

        {/* Action Buttons */}
        {hasStatusActions && (
          <div className="flex flex-wrap gap-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
            {canStartTask && (
              <Button size="sm" onClick={handleStartTask} disabled={updateStatus.isPending}>
                <Play className="h-3 w-3 mr-1" />
                Start Task
              </Button>
            )}

            {canMarkDone && (
              <Button size="sm" onClick={handleMarkDone} disabled={updateStatus.isPending}>
                <Send className="h-3 w-3 mr-1" />
                Mark as Done
              </Button>
            )}

            {canRework && (
              <Button size="sm" onClick={handleRework} disabled={updateStatus.isPending}>
                <Play className="h-3 w-3 mr-1" />
                Start Rework
              </Button>
            )}

            {canComplete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Mark as Completed
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Mark Task as Completed</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to mark this task as completed and close it?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleComplete}>
                      Complete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {canReject && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Request Rework
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Request Rework</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to request rework on this task?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReject} className="bg-destructive hover:bg-destructive/90">
                      Request Rework
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
