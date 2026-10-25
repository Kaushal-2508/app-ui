import * as React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
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
import { TaskStatusBadge } from "./TaskStatusBadge";
import { TaskTypeBadge } from "./TaskTypeBadge";
import { EvidenceSection } from "./EvidenceSection";
import { TaskComments } from "./TaskComments";
import { TaskManageActions } from "./TaskManageActions";
import {
  isTaskCancelled,
  taskAssignerName,
  useUpdateTaskStatus,
  type Task,
  type TaskStatus,
} from "@/hooks/useTasks";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle,
  ChevronDown,
  Eye,
  User,
  XCircle,
} from "lucide-react";
import { format, isPast } from "date-fns";
import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Human roll-up of who is where, skipping states nobody is in. */
function progressSummary(members: Task[]): string {
  const order: { status: TaskStatus; label: string }[] = [
    { status: "completed", label: "completed" },
    { status: "done_pending_approval", label: "awaiting approval" },
    { status: "in_progress", label: "in progress" },
    { status: "rejected", label: "in rework" },
    { status: "open", label: "not started" },
  ];

  return order
    .map(({ status, label }) => {
      const count = members.filter((m) => m.status === status).length;
      return count > 0 ? `${count} ${label}` : null;
    })
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// One assignee
// ---------------------------------------------------------------------------
function AssigneeRow({
  member,
  sharedTitle,
  currentUserId,
  defaultOpen,
}: {
  member: Task;
  /** The title every member shares, or null when people have their own. */
  sharedTitle: string | null;
  currentUserId?: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const updateStatus = useUpdateTaskStatus();

  const name = member.assignee_profile?.full_name ?? "Unknown";
  const isAssigner = currentUserId === member.assignment?.assigner_id;
  // Whole list, not the legacy single column.
  const isSupervisor = Boolean(
    currentUserId &&
      ((member.supervisors ?? []).some((s) => s.id === currentUserId) ||
        member.assignment?.supervisor_id === currentUserId),
  );
  const cancelled = isTaskCancelled(member);
  const canDecide =
    isAssigner && member.status === "done_pending_approval" && !cancelled;
  const canComment = isAssigner || isSupervisor;

  /**
   * Why there is nothing to click. The DB trigger
   * `validate_task_state_transition` only lets the assigner act on
   * `done_pending_approval`, so an empty row is correct, not broken. Say so
   * rather than rendering silence.
   */
  const evidenceCount = member.evidence?.length ?? 0;

  const waitingHint = (() => {
    if (!isAssigner || canDecide) return null;
    if (cancelled) {
      return `Paused. Everything ${name} did is kept, and nothing moves until you resume it.${
        member.cancel_reason ? ` Reason: ${member.cancel_reason}` : ""
      }`;
    }
    switch (member.status) {
      case "open":
        return `${name} hasn't started yet. You'll be able to approve once they mark it as done.`;
      case "in_progress":
        // Evidence on its own does NOT advance the status. Saying "working on
        // it" while their evidence sits right above reads as a broken button,
        // so name the exact missing step.
        return evidenceCount > 0
          ? `${name} has attached evidence but hasn't pressed "Mark as Done" yet. Approval unlocks the moment they do.`
          : `${name} is working on it. You'll be able to approve once they mark it as done.`;
      case "rejected":
        return `Sent back for rework. Waiting for ${name} to resubmit.`;
      case "completed":
        return "Approved and closed. Completed tasks can't be reopened.";
      default:
        return null;
    }
  })();
  const hasOwnBrief = sharedTitle === null;
  const isOverdue = Boolean(
    member.due_date && isPast(new Date(member.due_date)) && member.status !== "completed",
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "rounded-xl border border-border bg-card",
        isOverdue && "border-rose-200",
      )}
    >
      <CollapsibleTrigger className="flex w-full items-start gap-3 p-3 text-left">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="text-xs">{initialsOf(name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-ink-900 truncate">{name}</p>
          {hasOwnBrief && (
            <p className="text-xs text-ink-500 line-clamp-2">{member.title}</p>
          )}
          {isOverdue && (
            <p className="inline-flex items-center gap-1 text-xs text-rose-600">
              <AlertTriangle className="h-3 w-3" />
              Overdue
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <TaskStatusBadge status={member.status} cancelled={cancelled} />
          <ChevronDown
            className={cn(
              "h-4 w-4 text-ink-400 transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 border-t border-border px-3 pb-3 pt-3">
        {hasOwnBrief && member.description && (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">
              Their brief
            </p>
            <p className="text-sm text-ink-700">{member.description}</p>
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-ink-700">Evidence</h4>
          <EvidenceSection evidence={member.evidence ?? []} />
        </div>

        {canDecide && (
          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  disabled={updateStatus.isPending}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark as Completed
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mark as Completed</AlertDialogTitle>
                  <AlertDialogDescription>
                    This closes the task for {name} only. Everyone else on this
                    task keeps their own status.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      updateStatus.mutate({ taskId: member.id, status: "completed" })
                    }
                  >
                    Complete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={updateStatus.isPending}>
                  <XCircle className="h-4 w-4 mr-2" />
                  Request Rework
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Request Rework</AlertDialogTitle>
                  <AlertDialogDescription>
                    {name} will need to make changes and resubmit. Nobody else on
                    this task is affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      updateStatus.mutate({ taskId: member.id, status: "rejected" })
                    }
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    Request Rework
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {waitingHint && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-ink-500">
            {waitingHint}
          </p>
        )}

        {/* Acts on this person's row only, never the whole group. */}
        <TaskManageActions task={member} />


        {/* Radix unmounts closed content, so a collapsed row never fetches. */}
        <TaskComments taskId={member.id} canComment={canComment} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// The grouped window
// ---------------------------------------------------------------------------
interface MultiAssigneeTaskDetailProps {
  members: Task[];
  isLoading: boolean;
  isError: boolean;
  currentUserId?: string;
  /** The member whose card was clicked, expanded on open. */
  focusTaskId?: string | null;
}

export function MultiAssigneeTaskDetail({
  members,
  isLoading,
  isError,
  currentUserId,
  focusTaskId,
}: MultiAssigneeTaskDetailProps) {
  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  // Error state renders BEFORE the empty state (§6): a failed read must never
  // read as "nobody is on this task".
  if (isError) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        Failed to load the people on this task
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No assignees on this task
      </div>
    );
  }

  const lead = members[0];
  const total = members.length;
  const completed = members.filter((m) => m.status === "completed").length;
  const percent = Math.round((completed / total) * 100);

  // When everyone kept the main brief there is one shared title. Once anyone
  // customises theirs, no single title speaks for the group, so the header
  // falls back to the first person's and each row shows its own.
  const sharedTitle = members.every((m) => m.title === lead.title) ? lead.title : null;

  const isOverdue = Boolean(
    lead.due_date && isPast(new Date(lead.due_date)) && completed < total,
  );

  const cancelledCount = members.filter(isTaskCancelled).length;

  // Supervisors are chosen once for the whole group at creation, so every
  // member carries the same list; read it off the lead.
  const groupSupervisors = lead.supervisors ?? [];

  /**
   * Which member governs the whole-group action. Someone already working means
   * the group must be cancelled rather than deleted; if nobody has started it
   * can be deleted outright. Cancelled members offer nothing, so if every
   * member is cancelled or completed there is no group action at all. The RPCs
   * re-check each row, so a mixed group still does the right thing per member.
   */
  const active = members.filter((m) => !isTaskCancelled(m));
  const groupRepresentative =
    active.find((m) => m.status !== "open" && m.status !== "completed") ??
    active.find((m) => m.status === "open") ??
    null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-ink-900">
          {sharedTitle ?? lead.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <TaskTypeBadge type={lead.task_type} />
          {lead.priority === 1 && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
              High Priority
            </span>
          )}
          <Badge variant="secondary" className="text-xs">
            {total} assignees
          </Badge>
        </div>
        {sharedTitle === null && (
          <p className="text-xs text-ink-400">
            Each person has their own brief on this task.
          </p>
        )}
      </div>

      {isOverdue && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-rose-700">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">This task is overdue</p>
        </div>
      )}

      {sharedTitle !== null && lead.description && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">
            Description
          </p>
          <p className="text-sm text-ink-700">{lead.description}</p>
        </div>
      )}

      {/* Progress roll-up */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">
            Progress
          </p>
          <p className="text-sm font-medium text-ink-700">
            {completed} of {total} completed
          </p>
        </div>
        <Progress value={percent} className="h-2" />
        <p className="text-xs text-ink-500">
          {progressSummary(members)}
          {cancelledCount > 0 ? ` · ${cancelledCount} paused` : ""}
        </p>
      </div>

      {/* Whole-task action. Each assignee row below has its own. */}
      {groupRepresentative && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">
            Whole task
          </p>
          <TaskManageActions
            task={groupRepresentative}
            applyToGroup
            affectedCount={total}
          />
        </div>
      )}

      {/* Shared meta */}
      <div className="grid grid-cols-1 [@media(min-width:380px)]:grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">
            Assigned By
          </p>
          <p className="inline-flex items-center gap-2 text-sm text-ink-700">
            <User className="h-4 w-4" />
            <span>{taskAssignerName(lead)}</span>
          </p>
        </div>

        {(groupSupervisors.length > 0 || lead.supervisor_profile) && (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">
              {groupSupervisors.length > 1 ? "Supervisors" : "Supervisor"}
            </p>
            <p className="inline-flex items-start gap-2 text-sm text-ink-700">
              <Eye className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {groupSupervisors.length > 0
                  ? groupSupervisors.map((s) => s.full_name).join(", ")
                  : lead.supervisor_profile?.full_name}
              </span>
            </p>
          </div>
        )}

        {lead.due_date && (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">
              Due Date
            </p>
            <p
              className={cn(
                "inline-flex items-center gap-2 text-sm",
                isOverdue ? "text-rose-600" : "text-ink-700",
              )}
            >
              <CalendarDays className="h-4 w-4" />
              <span>{format(new Date(lead.due_date), "MMM d, yyyy")}</span>
            </p>
          </div>
        )}
      </div>

      {/* Per-assignee progress */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-ink-700">Assignees</h4>
        <p className="text-xs text-ink-400">
          Everyone works on their own copy. Approving or returning one person
          does not affect anybody else.
        </p>
        <div className="space-y-2">
          {members.map((member) => (
            <AssigneeRow
              key={member.id}
              member={member}
              sharedTitle={sharedTitle}
              currentUserId={currentUserId}
              defaultOpen={member.id === focusTaskId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
