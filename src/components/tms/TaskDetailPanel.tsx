import * as React from "react";
import {
  useTaskDetail,
  useTaskGroupDetail,
  useUpdateTaskStatus,
  useCurrentUser,
  taskAssignerName,
  isTaskCancelled,
  HIDDEN_ASSIGNMENT_LABEL,
} from "@/hooks/useTasks";
import { MultiAssigneeTaskDetail } from "./MultiAssigneeTaskDetail";
import { TaskManageActions } from "./TaskManageActions";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { TaskTypeBadge } from "./TaskTypeBadge";
import { EvidenceSection } from "./EvidenceSection";
import { SubmitEvidenceForm } from "./SubmitEvidenceForm";
import { TaskComments } from "./TaskComments";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CLOSURE_NOTE_PLACEHOLDER } from "@/components/issues/ClosureNoteSheet";
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
import { MobileSheet } from "@/components/shared/sheets";
import { useUserRole } from "@/hooks/useUserRole";
import {
  useResolveSupportRequest,
  useSupportInstitutionId,
} from "@/hooks/useSupportRequest";
import { useSupportTicketIdForTask } from "@/hooks/useReportedIssues";
import {
  CalendarDays,
  User,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  LifeBuoy,
  MessagesSquare,
} from "lucide-react";
import { Link } from "react-router-dom";
import { format, isPast } from "date-fns";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Local helper — not exported, not promoted to a shared primitive
// ---------------------------------------------------------------------------
function MetaPair({
  label,
  icon,
  value,
  highlight = "default",
}: {
  label: string;
  icon?: React.ReactNode;
  value: React.ReactNode;
  highlight?: "default" | "rose";
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">{label}</p>
      <p
        className={cn(
          "inline-flex items-center gap-2 text-sm",
          highlight === "rose" ? "text-rose-600" : "text-ink-700",
        )}
      >
        {icon}
        <span>{value}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface TaskDetailPanelProps {
  taskId: string | null;
  /**
   * Set by the grouped list card so the multi-assignee window renders without
   * first waiting on `useTaskDetail`. Left undefined on other entry points
   * (notification deep-links, single cards), where the group is derived from
   * the task itself.
   */
  groupId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailPanel({ taskId, groupId, open, onOpenChange }: TaskDetailPanelProps) {
  const { data: fetchedTask, isLoading, error } = useTaskDetail(taskId);
  const { data: currentUser } = useCurrentUser();
  const updateStatus = useUpdateTaskStatus();
  const { data: userRole } = useUserRole();
  const { data: supportInstitutionId } = useSupportInstitutionId();
  const resolveSupport = useResolveSupportRequest();
  // The Ticket Resolution SOP: a closure says what was wrong and what changed.
  // Declared with the other hooks; used by the resolve dialogs further down.
  const [supportNote, setSupportNote] = React.useState("");

  const derivedGroupId = groupId ?? fetchedTask?.task_group_id ?? null;
  const {
    data: groupMembers,
    isLoading: groupLoading,
    isError: groupIsError,
  } = useTaskGroupDetail(derivedGroupId);

  // Hooks must run before any early return, so the support test is recomputed
  // here from `fetchedTask` rather than the derived `task` further down.
  // `reported_issues` SELECT is super-admin-only, so gate the read explicitly
  // instead of letting a denied query resolve as "no ticket".
  const isSupportTicketTask = Boolean(
    supportInstitutionId && fetchedTask?.institution_id === supportInstitutionId,
  );
  const { data: supportTicketId } = useSupportTicketIdForTask(
    taskId,
    isSupportTicketTask && Boolean(userRole?.isSuperAdmin),
  );

  // If the viewer is an assignee on this group, they get their OWN row and the
  // ordinary single-task window: their normal Start / Mark as Done workflow,
  // and no view of teammates. Reading their own assignment row is always
  // permitted, so this test is reliable where an RLS-based one was not.
  const ownMember =
    groupMembers?.find((m) => m.assignment?.assignee_id === currentUser?.id) ?? null;

  // The grouped window needs to name every person in it. `tasks` is readable
  // institution-wide by teachers and coordinators, but `task_assignments` is
  // not — so an observer can see the sibling rows without being able to see
  // who they belong to. Rendering that produced a list of "Unknown".
  const canSeeWholeGroup =
    (groupMembers?.length ?? 0) > 1 &&
    (groupMembers ?? []).every((m) => m.assignment && m.assignee_profile);

  // The task the single window renders: the viewer's own row when they are an
  // assignee here, otherwise whatever they actually clicked.
  const task = ownMember ?? fetchedTask;

  if (!taskId) return null;

  const isGroupView = Boolean(derivedGroupId) && !ownMember && canSeeWholeGroup;
  // Only hold the grouped skeleton when the caller already knows this is a
  // group (a group card was clicked). On the derived path the single view is
  // correct until proven otherwise — gating on `derivedGroupId` here instead
  // made an assignee render single, then skeleton, then single again, because
  // the sibling query only becomes enabled after the task itself resolves.
  const groupUndecided = Boolean(groupId) && groupLoading;

  if (isGroupView || groupUndecided) {
    return (
      <MobileSheet open={open} onOpenChange={onOpenChange} title="Task Details">
        <MultiAssigneeTaskDetail
          members={groupMembers ?? []}
          isLoading={groupLoading}
          isError={groupIsError}
          currentUserId={currentUser?.id}
          focusTaskId={taskId}
        />
      </MobileSheet>
    );
  }

  const isAssignee = currentUser?.id === task?.assignment?.assignee_id;
  const isAssigner = currentUser?.id === task?.assignment?.assigner_id;

  const supervisors = task?.supervisors ?? [];
  // Test the whole list, not the legacy single column, or the second and later
  // supervisors would be treated as outsiders.
  const isSupervisor = Boolean(
    currentUser?.id &&
      (supervisors.some((s) => s.id === currentUser.id) ||
        task?.assignment?.supervisor_id === currentUser.id),
  );
  // Frozen: the DB rejects every status change and every new piece of
  // evidence, so none of those controls should be offered.
  const cancelled = Boolean(task && isTaskCancelled(task));
  const isOverdue = Boolean(
    task?.due_date &&
      isPast(new Date(task.due_date)) &&
      task?.status !== "completed" &&
      !cancelled,
  );

  // A Salci Support ticket. It lives in the SALCI Support institution, which no
  // client can write to, so this is a trustworthy marker rather than a flag.
  //
  // The reporter is the assigner on these, and both a RESTRICTIVE policy and a
  // guard trigger stop them changing, cancelling or deleting the ticket. The
  // controls below are hidden accordingly, so nobody is shown a button that is
  // guaranteed to fail.
  const isSupportTask = Boolean(
    supportInstitutionId && task?.institution_id === supportInstitutionId,
  );
  const isSupportOwner = isSupportTask && Boolean(userRole?.isSuperAdmin);
  const canResolveSupport =
    isSupportOwner && task?.status !== "completed" && !cancelled;

  const canStartTask = isAssignee && task?.status === "open" && !cancelled;
  // Support tickets never use the approval ladder. Their assigner is the
  // reporter, so done_pending_approval would dead-end: approving requires the
  // assigner, and the reporter is blocked from writing any status. SALCI closes
  // them in one step through resolve_support_task instead.
  const canSubmitForApproval =
    isAssignee &&
    task?.status === "in_progress" &&
    (task?.evidence?.length ?? 0) > 0 &&
    !cancelled &&
    !isSupportTask;
  const canRework = isAssignee && task?.status === "rejected" && !cancelled;
  const canApprove =
    isAssigner && task?.status === "done_pending_approval" && !cancelled && !isSupportTask;
  const canReject =
    isAssigner && task?.status === "done_pending_approval" && !cancelled && !isSupportTask;
  const canComment = isAssignee || isAssigner || isSupervisor;

  const handleStartTask = () => {
    if (taskId) updateStatus.mutate({ taskId, status: "in_progress" });
  };

  const handleSubmitForApproval = () => {
    if (taskId) updateStatus.mutate({ taskId, status: "done_pending_approval" });
  };

  const handleApprove = () => {
    if (taskId) updateStatus.mutate({ taskId, status: "completed" });
  };

  const handleReject = () => {
    if (taskId) updateStatus.mutate({ taskId, status: "rejected" });
  };

  // resolve_support_task files the note as a reporter-visible message, so this
  // dialog asks the same question the inbox sheet does. One draft serves both
  // outcomes; the dialogs are never open at once. The note is OPTIONAL and
  // never blocks the button (2026-09-22, see lib/supportSop.ts).
  const handleResolveSupport = (outcome: "completed" | "rejected") => {
    if (taskId && !resolveSupport.isPending) {
      resolveSupport.mutate(
        { taskId, outcome, note: supportNote.trim() || undefined },
        { onSuccess: () => setSupportNote("") },
      );
    }
  };

  const supportNoteField = (
    <div className="grid gap-1.5 pt-2 text-left">
      <Label htmlFor="support-closure-note">What changed (optional)</Label>
      <Textarea
        id="support-closure-note"
        value={supportNote}
        onChange={(e) => setSupportNote(e.target.value)}
        rows={3}
        placeholder={CLOSURE_NOTE_PLACEHOLDER}
        className="resize-none"
      />
      <p className="text-xs text-muted-foreground">
        Sent to the person who raised it.
      </p>
    </div>
  );

  const handleRework = () => {
    if (taskId) updateStatus.mutate({ taskId, status: "in_progress" });
  };

  // Derive the sticky-footer primary action based on current task state.
  // Approve/Reject stay inline because they require AlertDialog confirmation.
  const primaryAction = (() => {
    if (canStartTask) {
      return {
        label: "Start Task",
        onClick: handleStartTask,
        loading: updateStatus.isPending,
      };
    }
    if (canSubmitForApproval) {
      return {
        label: "Mark as Done",
        onClick: handleSubmitForApproval,
        loading: updateStatus.isPending,
      };
    }
    if (canRework) {
      return {
        label: "Start Rework",
        onClick: handleRework,
        loading: updateStatus.isPending,
      };
    }
    return undefined;
  })();

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Task Details"
      primaryAction={primaryAction}
    >
      {isLoading ? (
        <div className="space-y-4 py-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error ? (
        <div className="py-8 text-center text-muted-foreground">
          Failed to load task details
        </div>
      ) : task ? (
        <div className="space-y-5">
          {/* Title + status pill row */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <h3 className="text-xl font-semibold text-ink-900 truncate">{task.title}</h3>
              <div className="flex flex-wrap gap-2">
                <TaskTypeBadge type={task.task_type} />
                {task.priority === 1 && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                    High Priority
                  </span>
                )}
              </div>
            </div>
            <TaskStatusBadge status={task.status} cancelled={cancelled} />
          </div>

          {cancelled && (
            <div className="rounded-xl bg-muted/70 border border-border p-3 space-y-1">
              <p className="text-sm font-medium text-ink-700">This task is paused</p>
              <p className="text-xs text-ink-500">
                It was cancelled, so nothing can move until it is resumed.
                Everything done so far is kept exactly as it was.
                {task.cancel_reason ? ` Reason: ${task.cancel_reason}` : ""}
              </p>
            </div>
          )}

          {/* Owner actions: delete while untouched, cancel once started, resume
              when paused. TaskManageActions self-gates support tickets down to
              SALCI, so every surface that renders it behaves the same. */}
          <TaskManageActions task={task} size="default" />

          {/* Support ticket banner. The reporter can watch but not act. */}
          {isSupportTask && (
            <div className="rounded-xl border border-brand-primary/20 bg-brand-primary/5 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <LifeBuoy className="h-5 w-5 shrink-0 text-brand-primary" />
                <p className="text-sm text-ink-700">
                  {isSupportOwner
                    ? "This is a Salci Support request. Resolving it closes the ticket for the person who raised it."
                    : "This is your Salci Support request. Only the SALCI team can close it, and you will see the status update here."}
                </p>
              </div>
              {/* One home for the thread. The reply history and the internal
                  notes live in the Support Inbox, not half-rendered here. */}
              {isSupportOwner && supportTicketId && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/admin/issues?ticket=${supportTicketId}`}>
                    <MessagesSquare className="h-4 w-4 mr-2" />
                    View conversation
                  </Link>
                </Button>
              )}
            </div>
          )}

          {/* Supervisor badge */}
          {isSupervisor && !isAssigner && !isAssignee && (
            <Badge variant="outline" className="text-purple-600 border-purple-300">
              <Eye className="h-3 w-3 mr-1" />
              Supervisor View
            </Badge>
          )}

          {/* Overdue alert */}
          {isOverdue && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-rose-700">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <p className="text-sm font-medium">This task is overdue</p>
            </div>
          )}

          {/* Description */}
          {task.description && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-ink-400 font-medium">Description</p>
              <p className="text-sm text-ink-700">{task.description}</p>
            </div>
          )}

          {/* Supervisor observer mode notice */}
          {isSupervisor && !isAssigner && !isAssignee && (
            <div className="flex items-center gap-2 text-purple-600">
              <Eye className="h-5 w-5" />
              <span className="font-medium text-sm">Observer Mode: You can view and comment only</span>
            </div>
          )}

          {/* SALCI-only resolution for support tickets. Goes straight to
              completed/rejected through resolve_support_task rather than the
              evidence + approval ladder. */}
          {canResolveSupport && (
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    disabled={resolveSupport.isPending}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark as resolved
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Resolve this support request?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This marks the ticket resolved for the person who raised it. Say
                      what was wrong and what you changed; they read it.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {supportNoteField}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Not yet</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleResolveSupport("completed")}
                    >
                      Resolve
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={resolveSupport.isPending}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Not an issue
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Close without a fix?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Use this when nothing is broken. The ticket is closed and the
                      person who raised it sees why.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {supportNoteField}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it open</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleResolveSupport("rejected")}
                    >
                      Close it
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* Assigner actions (Approve / Reject) stay inline — they need AlertDialog */}
          {(canApprove || canReject) && (
            <div className="flex flex-wrap gap-2">
              {canApprove && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="default" className="bg-green-600 hover:bg-green-700">
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Mark as Completed
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Mark Task as Completed</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to mark this task as completed and close it?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleApprove}>
                        Complete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              {canReject && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <XCircle className="h-4 w-4 mr-2" />
                      Request Rework
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Request Rework</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to request rework on this task? The assignee will need to make changes and resubmit.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleReject}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        Request Rework
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}

          {/* Task completed confirmation */}
          {task.status === "completed" && !isSupervisor && (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Task Completed</span>
            </div>
          )}

          {/* Meta grid — 2-col at ≥ 380 px, 1-col below */}
          <div className="grid grid-cols-1 [@media(min-width:380px)]:grid-cols-2 gap-4">
            <MetaPair
              label="Assigned By"
              icon={<User className="h-4 w-4" />}
              value={taskAssignerName(task)}
            />
            <MetaPair
              label="Assigned To"
              icon={<User className="h-4 w-4" />}
              value={
                task.assignee_profile?.full_name ??
                // The SALCI support owner has no institution, so profiles RLS
                // hides them from the reporter. Name the team, not "Unknown".
                // A missing assignment row means RLS hid it from this viewer
                // (coordinator/teacher on someone else's task): say so.
                (isSupportTask
                  ? "SALCI Support"
                  : task.assignment
                    ? "Unknown"
                    : HIDDEN_ASSIGNMENT_LABEL)
              }
            />
            {(supervisors.length > 0 || task.supervisor_profile) && (
              <MetaPair
                label={supervisors.length > 1 ? "Supervisors" : "Supervisor"}
                icon={<Eye className="h-4 w-4" />}
                value={
                  supervisors.length > 0
                    ? supervisors.map((s) => s.full_name).join(", ")
                    : task.supervisor_profile?.full_name
                }
              />
            )}
            {task.due_date && (
              <MetaPair
                label="Due Date"
                icon={<CalendarDays className="h-4 w-4" />}
                value={format(new Date(task.due_date), "MMM d, yyyy")}
                highlight={isOverdue ? "rose" : "default"}
              />
            )}
            <MetaPair
              label="Created"
              icon={<Clock className="h-4 w-4" />}
              value={format(new Date(task.created_at), "MMM d, yyyy")}
            />
          </div>

          {/* Evidence */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-ink-700">Evidence</h4>
            <EvidenceSection evidence={task.evidence ?? []} />
            {isAssignee && task.status === "in_progress" && !cancelled && (
              <SubmitEvidenceForm taskId={task.id} />
            )}
          </div>

          {/* Comments */}
          <TaskComments taskId={task.id} canComment={canComment} />
        </div>
      ) : null}
    </MobileSheet>
  );
}
