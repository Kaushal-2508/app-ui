import type { Task, TaskStatus } from "@/hooks/useTasks";
import { isTaskCancelled } from "@/hooks/useTasks";
import type { BoardColumnDef } from "@/components/shared/board";
import { buildAppUrl } from "@/lib/appUrl";

/**
 * Board vocabulary for /tasks. A column IS a status; cancellation is an
 * overlay (`cancelled_at`) and never a column.
 */
export type BoardColumnId = "todo" | "in_progress" | "in_review" | "done" | "rejected";

export interface TaskBoardColumnDef extends BoardColumnDef<TaskStatus> {
  id: BoardColumnId;
}

export const BOARD_COLUMNS: TaskBoardColumnDef[] = [
  { id: "todo", label: "To Do", status: "open" },
  { id: "in_progress", label: "In Progress", status: "in_progress" },
  { id: "in_review", label: "In Review", status: "done_pending_approval" },
  { id: "done", label: "Done", status: "completed" },
  { id: "rejected", label: "Rejected", status: "rejected" },
];

export function columnLabelForStatus(status: TaskStatus): string {
  return BOARD_COLUMNS.find((c) => c.status === status)?.label ?? status;
}

/**
 * The WRITE side is the truth for `tasks.priority`: CreateTaskDialog and
 * AISuggestedTasksCard store 1 = Low, 2 = Medium, 3 = High. Four legacy
 * readers still render `priority === 1` as "High"; the board follows the
 * writer. A null priority sorts with Medium.
 */
export const PRIORITY_META: Record<number, { label: string; rank: number }> = {
  3: { label: "High", rank: 0 },
  2: { label: "Medium", rank: 1 },
  1: { label: "Low", rank: 2 },
};

export function priorityMeta(priority: number | null): { label: string; rank: number } {
  return (priority !== null && PRIORITY_META[priority]) || PRIORITY_META[2];
}

export type BoardSortKey = "priority" | "newest";

export const BOARD_SORT_KEYS: readonly BoardSortKey[] = ["priority", "newest"];

export const BOARD_SORTS: { value: BoardSortKey; label: string }[] = [
  { value: "priority", label: "Highest priority first" },
  { value: "newest", label: "Newest first" },
];

export type BoardGroupKey = "none" | "assignee" | "type" | "priority";

export const BOARD_GROUPS: { value: BoardGroupKey; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "assignee", label: "Group by assignee" },
  { value: "type", label: "Group by type" },
  { value: "priority", label: "Group by priority" },
];

/** localStorage keys. Sort is a standing preference; search and grouping are not. */
export const TASK_BOARD_SORT_STORAGE_KEY = "salci.tasks.board-sort";
export const TASK_VIEW_STORAGE_KEY = "salci.tasks.view";

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);

/**
 * priority: rank asc, then due_date asc with nulls LAST, then created_at asc.
 * newest:   created_at desc, tie-broken by id so two rows created in the same
 *           second (a create_task_group fan-out) never reorder between renders.
 */
export function taskComparator(key: BoardSortKey): (a: Task, b: Task) => number {
  if (key === "newest") {
    return (a, b) => {
      const diff = time(b.created_at) - time(a.created_at);
      if (diff !== 0 && !Number.isNaN(diff)) return diff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    };
  }
  return (a, b) => {
    const rank = priorityMeta(a.priority).rank - priorityMeta(b.priority).rank;
    if (rank !== 0) return rank;
    const dueA = time(a.due_date);
    const dueB = time(b.due_date);
    const hasA = !Number.isNaN(dueA);
    const hasB = !Number.isNaN(dueB);
    if (hasA && hasB && dueA !== dueB) return dueA - dueB;
    if (hasA !== hasB) return hasA ? -1 : 1;
    const created = time(a.created_at) - time(b.created_at);
    if (created !== 0 && !Number.isNaN(created)) return created;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

// Refusal copy. Plain sentences, no em-dashes (CLAUDE.md UI rules).
export const TASK_MOVE_DENIED = "Only the person this task is assigned to can move it.";
export const TASK_APPROVE_DENIED =
  "Only the person who assigned this task can approve or reject it.";
export const TASK_CANCELLED = "This task is paused. Nothing can be changed on it.";
export const TASK_NOT_A_PARTY = "You are not assigned to this task, so you cannot move it.";
export const TASK_NO_WAY_BACK =
  "A task in review or rework cannot go back to To Do. Move it to In Progress instead.";
export const TASK_SUPPORT_NO_REVIEW =
  "Salci Support requests are closed by SALCI from the request itself, not moved here.";
// Mirrors the DB rule: validate_task_state_transition refuses In Progress ->
// In Review while task_has_evidence(id) is false (a bare EXISTS on
// task_evidence). Judged here so the card never moves and the toast is ours.
export const TASK_NEEDS_EVIDENCE = "Attach evidence before sending this for review.";
export const TASK_BAD_TRANSITION = "A task cannot move from {from} to {to}.";

export function badTransitionMessage(from: TaskStatus, to: TaskStatus): string {
  return TASK_BAD_TRANSITION.replace("{from}", columnLabelForStatus(from)).replace(
    "{to}",
    columnLabelForStatus(to),
  );
}

export interface DropContext {
  userId: string | undefined;
  /**
   * Extra approval authority beyond being the assigner. TaskDetailPanel grants
   * approve/reject to the assigner only, so /tasks passes false; it exists so
   * a future admin approval path has one place to plug in.
   */
  canApprove: boolean;
  /** `useSupportInstitutionId()` matches the task's institution. */
  isSupportTask: boolean;
}

/**
 * The one place a drag is judged. Returns null when the move is allowed,
 * otherwise the sentence to toast. Mirrors the DB trigger
 * `validate_task_state_transition`, which remains the backstop: the board
 * offers every move the trigger accepts for this user, which is wider than
 * the card buttons (since 2026-09-16, Naman's call: In Progress may go back
 * to To Do, To Do may go straight to In Review, and the assignee may pull an
 * In Review card back to In Progress). Evidence is required
 * exactly where the trigger requires it: on the In Progress -> In Review
 * path. Naman wants it optional everywhere; that needs the trigger changed.
 *
 * Order matters and is what the tests pin: frozen first, then "are you a
 * party at all", then whether the transition exists, then who may make it.
 */
export function dropRefusal(task: Task, target: TaskStatus, ctx: DropContext): string | null {
  if (isTaskCancelled(task)) return TASK_CANCELLED;

  const from = task.status;
  if (from === target) return null;

  const isAssignee = Boolean(ctx.userId && task.assignment?.assignee_id === ctx.userId);
  const isAssigner = Boolean(ctx.userId && task.assignment?.assigner_id === ctx.userId);
  const canApprove = isAssigner || ctx.canApprove;

  if (!isAssignee && !canApprove) return TASK_NOT_A_PARTY;

  switch (target) {
    case "open":
      // Only from In Progress: a task in review or rework routes back through
      // In Progress, as the card buttons offer. The trigger has no rule
      // against this move; it is the assignee un-starting their own work.
      if (from !== "in_progress") return TASK_NO_WAY_BACK;
      if (!isAssignee) return TASK_MOVE_DENIED;
      return null;

    case "in_progress":
      // From To Do (start), from Rejected (rework), and from In Review (the
      // assignee withdraws a submission before it is judged; the trigger has
      // no rule against it). Completed stays terminal.
      if (from !== "open" && from !== "rejected" && from !== "done_pending_approval") {
        return badTransitionMessage(from, target);
      }
      if (!isAssignee) return TASK_MOVE_DENIED;
      return null;

    case "done_pending_approval":
      if (from !== "in_progress" && from !== "open") return badTransitionMessage(from, target);
      if (ctx.isSupportTask) return TASK_SUPPORT_NO_REVIEW;
      if (!isAssignee) return TASK_MOVE_DENIED;
      // Evidence is required on EVERY path into In Review, which is one step
      // STRICTER than the server on purpose (Tushar, 2026-09-16). The trigger
      // checks it only on the In Progress path, so To Do -> In Review is a
      // one-drag way round a documented rule. The trigger cannot simply be
      // widened: _support_apply_status moves support tasks between these
      // states as a super admin who is neither assignee nor assigner, so a
      // destination-keyed rule would break ticket resolution (see the queue's
      // Tushar list). Until that is untangled, the board holds the line.
      if (!task.evidence?.length) return TASK_NEEDS_EVIDENCE;
      return null;

    case "completed":
    case "rejected":
      if (from !== "done_pending_approval") return badTransitionMessage(from, target);
      if (ctx.isSupportTask) return TASK_SUPPORT_NO_REVIEW;
      if (!canApprove) return TASK_APPROVE_DENIED;
      return null;

    default:
      return badTransitionMessage(from, target);
  }
}

/** Every column this user may move the task to right now, in column order. */
export function allowedMoves(task: Task, ctx: DropContext): TaskBoardColumnDef[] {
  return BOARD_COLUMNS.filter(
    (column) => column.status !== task.status && dropRefusal(task, column.status, ctx) === null,
  );
}

/** Completing or rejecting is terminal for the assignee's work, so both confirm first. */
export function moveNeedsConfirmation(target: TaskStatus): boolean {
  return target === "completed" || target === "rejected";
}

export function taskDeepLink(id: string): string {
  // Canonical app URL, not window.location.origin: inside the native shell the origin is capacitor://localhost.
  return buildAppUrl(`/tasks?task=${id}`);
}

/** Group chip data for one member of a multi-assignee group. */
export interface TaskGroupMeta {
  done: number;
  total: number;
}
