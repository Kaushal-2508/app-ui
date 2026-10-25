import { useMemo, useState, type ReactNode } from "react";
import { Plus, Search, Users } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KanbanBoard, useStoredPreference, type BoardLane } from "@/components/shared/board";
import { EmptyState } from "@/components/shared/surfaces";
import { UserAvatar } from "@/components/shared/UserAvatar";
import type { TaskSelection } from "@/components/tms/TaskCollectionGrid";
import { TASK_TYPE_ORDER, taskTypeLabel } from "@/components/tms/TaskTypeBadge";
import {
  groupTasks,
  useCurrentUser,
  useUpdateTaskStatus,
  type Task,
  type TaskGroupEntry,
  type TaskStatus,
} from "@/hooks/useTasks";
import { useSupportInstitutionId } from "@/hooks/useSupportRequest";
import {
  BOARD_COLUMNS,
  BOARD_GROUPS,
  BOARD_SORTS,
  BOARD_SORT_KEYS,
  TASK_BOARD_SORT_STORAGE_KEY,
  dropRefusal,
  moveNeedsConfirmation,
  priorityMeta,
  taskComparator,
  type BoardGroupKey,
  type BoardSortKey,
  type TaskGroupMeta,
} from "@/lib/taskBoard";
import { toastWarning } from "@/lib/toast";
import { BoardCardContent } from "./BoardTaskCard";

export interface TaskBoardViewProps {
  /** The active tab's list, already date-filtered. The page owns fetching. */
  tasks: Task[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  onOpen: (selection: TaskSelection) => void;
  /** Same rule as the page's Assign Task FAB; gates the "+" on To Do. */
  canAssignTasks: boolean;
  onCreateTask?: () => void;
  /** Tab-specific copy for when the list is empty. */
  emptyState: ReactNode;
}

const GROUP_KEYS: readonly BoardGroupKey[] = ["none", "assignee", "type", "priority"];

const CONFIRM_COPY: Record<"completed" | "rejected", { title: string; body: string; action: string }> = {
  completed: {
    title: "Mark Task as Completed",
    body: "Are you sure you want to mark this task as completed and close it?",
    action: "Complete",
  },
  rejected: {
    title: "Request Rework",
    body: "Are you sure you want to request rework on this task? The assignee will need to make changes and resubmit.",
    action: "Request Rework",
  },
};

function matchesSearch(task: Task, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    task.title,
    task.description ?? "",
    task.assignee_profile?.full_name ?? "",
    task.assigner_profile?.full_name ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Jira-style board over whatever task list the page hands it. One card per
 * TASK, a multi-assignee group included: the group collapses into one card
 * (its earliest member carries it) placed in the column of its least-advanced
 * member, the same rule the tiles and the grid use, so a task given to eight
 * people counts as one everywhere (Naman, 2026-09-28; it used to deal one card
 * per person and the columns read 189 against a badge of 121). Members
 * progress one by one in the group detail, so a group card is not draggable
 * and carries no move menu; opening it lands on the multi-assignee window.
 */
export function TaskBoardView({
  tasks,
  isLoading,
  error,
  onRetry,
  onOpen,
  canAssignTasks,
  onCreateTask,
  emptyState,
}: TaskBoardViewProps) {
  const { data: currentUser } = useCurrentUser();
  const { data: supportInstitutionId } = useSupportInstitutionId();
  const updateStatus = useUpdateTaskStatus();

  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<BoardGroupKey>("none");
  const [sortBy, setSortBy] = useStoredPreference<BoardSortKey>(
    TASK_BOARD_SORT_STORAGE_KEY,
    BOARD_SORT_KEYS,
    "priority",
  );
  const [pendingMove, setPendingMove] = useState<{ task: Task; target: TaskStatus } | null>(
    null,
  );

  const needle = search.trim().toLowerCase();

  // Groups form over the whole list the board shows, so "2 of 3 done"
  // describes the members in this tab's scope; a search then keeps a group
  // when ANY member matches, rather than splitting it into whichever rows
  // happened to match. `items` is what the board deals: one row per single
  // task and the lead row per group, with `groups` keyed by that lead's id.
  const { items, groups } = useMemo(() => {
    const groups = new Map<string, TaskGroupEntry>();
    const items: Task[] = [];
    for (const entry of groupTasks(tasks)) {
      if (entry.kind === "group") {
        if (needle && !entry.members.some((m) => matchesSearch(m, needle))) continue;
        groups.set(entry.lead.id, entry);
        items.push(entry.lead);
      } else {
        if (needle && !matchesSearch(entry.task, needle)) continue;
        items.push(entry.task);
      }
    }
    return { items, groups };
  }, [tasks, needle]);

  const groupMetaOf = (task: Task): TaskGroupMeta | undefined => {
    const group = groups.get(task.id);
    return group ? { done: group.completedCount, total: group.members.length } : undefined;
  };

  const lanes = useMemo<BoardLane<Task>[] | undefined>(() => {
    if (groupBy === "none") return undefined;

    if (groupBy === "assignee") {
      const byName = new Map<string, { profile: Task["assignee_profile"]; items: Task[] }>();
      const shared: Task[] = [];
      const unassigned: Task[] = [];
      for (const task of items) {
        // A group card stands for several people, so it gets a lane of its
        // own rather than the lane of whichever member happens to lead it.
        if (groups.has(task.id)) {
          shared.push(task);
          continue;
        }
        const name = task.assignee_profile?.full_name;
        if (!name) {
          unassigned.push(task);
          continue;
        }
        const bucket = byName.get(name);
        if (bucket) bucket.items.push(task);
        else byName.set(name, { profile: task.assignee_profile, items: [task] });
      }
      const result: BoardLane<Task>[] = [...byName.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, { profile, items }]) => ({
          key: `assignee:${name}`,
          label: name,
          leading: (
            <UserAvatar
              name={name}
              email={profile?.email}
              className="h-6 w-6"
              fallbackClassName="text-[10px]"
            />
          ),
          items,
        }));
      if (shared.length > 0) {
        result.push({
          key: "assignee:shared",
          label: "Several people",
          leading: <Users className="h-5 w-5 text-ink-400" aria-hidden />,
          items: shared,
        });
      }
      if (unassigned.length > 0) {
        result.push({ key: "assignee:unassigned", label: "Unassigned", items: unassigned });
      }
      return result;
    }

    if (groupBy === "type") {
      return TASK_TYPE_ORDER.map((type) => ({
        key: `type:${type}`,
        label: taskTypeLabel(type),
        items: items.filter((t) => t.task_type === type),
      })).filter((lane) => lane.items.length > 0);
    }

    // priority: High / Medium / Low, null counted as Medium
    return [0, 1, 2]
      .map((rank) => {
        const laneItems = items.filter((t) => priorityMeta(t.priority).rank === rank);
        const label = ["High", "Medium", "Low"][rank];
        return { key: `priority:${label}`, label, items: laneItems };
      })
      .filter((lane) => lane.items.length > 0);
  }, [groupBy, items, groups]);

  const comparator = useMemo(() => taskComparator(sortBy), [sortBy]);

  const requestMove = (task: Task, target: TaskStatus) => {
    if (task.status === target) return;
    const isSupportTask = Boolean(
      supportInstitutionId && task.institution_id === supportInstitutionId,
    );
    const why = dropRefusal(task, target, {
      userId: currentUser?.id,
      canApprove: false,
      isSupportTask,
    });
    if (why) {
      toastWarning(why);
      return;
    }
    if (moveNeedsConfirmation(target)) {
      setPendingMove({ task, target });
      return;
    }
    updateStatus.mutate({ taskId: task.id, status: target });
  };

  const confirmMove = () => {
    if (!pendingMove || updateStatus.isPending) return;
    updateStatus.mutate({ taskId: pendingMove.task.id, status: pendingMove.target });
    setPendingMove(null);
  };

  const confirmCopy =
    pendingMove && (pendingMove.target === "completed" || pendingMove.target === "rejected")
      ? CONFIRM_COPY[pendingMove.target]
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cards"
            aria-label="Search cards"
            className="h-10 rounded-lg bg-surface-card pl-9 shadow-card-sm"
          />
        </div>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as BoardGroupKey)}>
          <SelectTrigger className="h-10 w-[calc(50%-0.25rem)] bg-surface-card shadow-card-sm sm:w-[180px]" aria-label="Group by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOARD_GROUPS.filter((g) => GROUP_KEYS.includes(g.value)).map((g) => (
              <SelectItem key={g.value} value={g.value}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as BoardSortKey)}>
          <SelectTrigger className="h-10 w-[calc(50%-0.25rem)] bg-surface-card shadow-card-sm sm:w-[180px]" aria-label="Sort cards">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOARD_SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <KanbanBoard<Task, TaskStatus>
        columns={BOARD_COLUMNS}
        items={items}
        getId={(t) => t.id}
        // A group sits in the column of its least-advanced member.
        getStatus={(t) => groups.get(t.id)?.rollupStatus ?? t.status}
        canDrag={(t) => !t.cancelled_at && !groups.has(t.id)}
        sortItems={comparator}
        lanes={lanes}
        renderCard={(task, { isOverlay }) => (
          <BoardCardContent
            task={task}
            isOverlay={isOverlay}
            interactive={!isOverlay}
            groupMeta={groupMetaOf(task)}
            onRequestMove={requestMove}
          />
        )}
        onOpen={(task) =>
          onOpen({ taskId: task.id, groupId: groups.get(task.id)?.groupId ?? null })
        }
        onDrop={requestMove}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        errorTitle="Couldn't load tasks"
        errorFallback="Something went wrong fetching your tasks. Please try again."
        emptyState={
          needle ? (
            <EmptyState
              icon={<Search className="h-7 w-7" />}
              title="No cards match"
              description="Try a different search, or clear it to see every card."
              reason="noResults"
            />
          ) : (
            emptyState
          )
        }
        columnAction={(column) =>
          column.id === "todo" && canAssignTasks && onCreateTask ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Assign a task"
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-ink-900"
              onClick={onCreateTask}
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : null
        }
      />

      <AlertDialog
        open={Boolean(pendingMove)}
        onOpenChange={(open) => {
          if (!open) setPendingMove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmMove}
              className={
                pendingMove?.target === "rejected"
                  ? "bg-destructive hover:bg-destructive/90"
                  : undefined
              }
            >
              {confirmCopy?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
