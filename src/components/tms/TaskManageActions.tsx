import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Ban, Trash2 } from "lucide-react";
import {
  canManageTask,
  taskManageMode,
  useCancelTask,
  useCurrentUser,
  useDeleteTask,
  type Task,
  type TaskManageMode,
} from "@/hooks/useTasks";
import { useUserRole } from "@/hooks/useUserRole";
import { useSupportInstitutionId } from "@/hooks/useSupportRequest";

interface TaskManageActionsProps {
  task: Task;
  /**
   * Apply to every sibling sharing this task's `task_group_id` rather than
   * just this row. Used by the group-level control in the grouped detail.
   */
  applyToGroup?: boolean;
  /** How many tasks the action will affect, for honest confirmation copy. */
  affectedCount?: number;
  size?: "sm" | "default";
}

/**
 * Which escape hatch the CURRENT VIEWER may use on this task, or null when the
 * controls must stay hidden. Shared by the card buttons and the board menu so
 * the two never disagree.
 */
export function useTaskManageMode(task: Task): TaskManageMode {
  const { data: currentUser } = useCurrentUser();
  const { data: userRole } = useUserRole();
  const { data: supportInstitutionId } = useSupportInstitutionId();

  const isAdmin = Boolean(userRole?.isSchoolAdmin || userRole?.isSuperAdmin);
  if (!canManageTask(task, currentUser?.id, isAdmin)) return null;

  // Salci Support tickets are owned by SALCI, not by whoever raised them.
  // canManageTask() grants these controls to the ASSIGNER, and on a support
  // ticket the assigner is the REPORTER, so without this every reporter saw a
  // Delete button on their own ticket that the guard trigger rejects 100% of
  // the time. Gated here rather than at each call site so TaskCard,
  // TaskGroupCard, MultiAssigneeTaskDetail, TaskDetailPanel and the board menu
  // are all covered.
  const isSupportTask = Boolean(
    supportInstitutionId && task.institution_id === supportInstitutionId,
  );
  if (isSupportTask && !userRole?.isSuperAdmin) return null;

  return taskManageMode(task);
}

interface TaskManageDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applyToGroup?: boolean;
  affectedCount?: number;
}

function subjectFor(affectedCount: number) {
  return affectedCount > 1 ? `all ${affectedCount} people on this task` : "this task";
}

/** Controlled confirm for deleting an untouched task. The RPC re-checks. */
export function TaskDeleteDialog({
  task,
  open,
  onOpenChange,
  applyToGroup = false,
  affectedCount = 1,
}: TaskManageDialogProps) {
  const deleteTask = useDeleteTask();
  const subject = subjectFor(affectedCount);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this task?</AlertDialogTitle>
          <AlertDialogDescription>
            Nobody has started work on this yet, so nothing is lost. This
            removes it for {subject} and can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90"
            disabled={deleteTask.isPending}
            onClick={() => deleteTask.mutate({ taskId: task.id, applyToGroup })}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Controlled confirm for cancelling started work, with the optional reason. */
export function TaskCancelDialog({
  task,
  open,
  onOpenChange,
  applyToGroup = false,
  affectedCount = 1,
}: TaskManageDialogProps) {
  const cancelTask = useCancelTask();
  const [reason, setReason] = useState("");
  const subject = subjectFor(affectedCount);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this task?</AlertDialogTitle>
          <AlertDialogDescription>
            Work has already started, so nothing is deleted. Everything done so
            far is kept and {subject} stops for good: no status changes and no
            new evidence. It moves to the Pending tab, marked Cancelled.
            Cancelling can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2">
          <Label htmlFor={`cancel-reason-${task.id}`} className="text-xs">
            Reason (optional)
          </Label>
          <Textarea
            id={`cancel-reason-${task.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Shown to the assignee in their notification"
            rows={2}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Never mind</AlertDialogCancel>
          <AlertDialogAction
            disabled={cancelTask.isPending}
            onClick={() => cancelTask.mutate({ taskId: task.id, reason, applyToGroup })}
          >
            Cancel the task
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Delete / Cancel for whoever owns a task.
 *
 * Untouched work can just be deleted. Once someone has started, deleting would
 * throw away real work, so it becomes a cancel. Cancelling is terminal: a
 * cancelled task offers nothing further, by product decision. The RPCs
 * re-check both permission and state, so this only decides what to show.
 */
export function TaskManageActions({
  task,
  applyToGroup = false,
  affectedCount = 1,
  size = "sm",
}: TaskManageActionsProps) {
  const mode = useTaskManageMode(task);
  const [open, setOpen] = useState(false);

  if (!mode) return null;

  if (mode === "delete") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          size={size}
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Delete
        </Button>
        <TaskDeleteDialog
          task={task}
          open={open}
          onOpenChange={setOpen}
          applyToGroup={applyToGroup}
          affectedCount={affectedCount}
        />
      </div>
    );
  }

  // mode === "cancel"
  return (
    <div className="flex flex-wrap gap-2">
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <Ban className="h-3.5 w-3.5 mr-1.5" />
        Cancel this task
      </Button>
      <TaskCancelDialog
        task={task}
        open={open}
        onOpenChange={setOpen}
        applyToGroup={applyToGroup}
        affectedCount={affectedCount}
      />
    </div>
  );
}
