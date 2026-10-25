import { Skeleton } from "@/components/ui/skeleton";
import {
  useMyTasks,
  useTasksAwaitingApproval,
  useSupervisingTasks,
  useTasksAssignedByMe,
  useInstitutionTasks,
  useTaskStatusCounts,
  countTaskEntries,
  dedupeTasksById,
  isTaskCancelled,
  type Task,
  type TaskCountScope,
} from "@/hooks/useTasks";
import { useTaskRealtime } from "@/hooks/useTaskRealtime";
import {
  TaskCollectionGrid,
  type TaskSelection,
} from "@/components/tms/TaskCollectionGrid";
import { TaskDetailPanel } from "@/components/tms/TaskDetailPanel";
import { CreateTaskDialog } from "@/components/tms/CreateTaskDialog";
import { TaskDateFilter } from "@/components/tms/TaskDateFilter";
import { TaskBoardView } from "@/components/tms/board/TaskBoardView";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import {
  Inbox,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  Ban,
  Eye,
  Plus,
  Building2,
  Users,
  ClipboardList,
  MessageSquareWarning,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import { ViewModeToggle, useViewMode } from "@/components/shared/board";
import { TASK_VIEW_STORAGE_KEY } from "@/lib/taskBoard";
import { formatNumber } from "@/lib/formatNumber";
import { translateError } from "@/lib/errorMessages";
import { isNativePlatform } from "@/lib/native";
import { cn } from "@/lib/utils";
import {
  DEFAULT_FILTER,
  filterTasksByDate,
  formatDateScopeSuffix,
  resolveDateRange,
  type DateFilterState,
} from "@/lib/taskDateFilter";

/**
 * What the stat row is counting, in the user's words. Keyed by the EFFECTIVE
 * scope the RPC returns, which includes "none" for a signed-out read.
 *
 * "Your tasks" rather than "Assigned to you": the mine scope covers work
 * assigned to you, work you assigned, and work you supervise, so the narrower
 * phrase would undersell it.
 */
const SCOPE_LABEL: Record<TaskCountScope | "none", string> = {
  institution: "Across your school",
  wing: "Across your wing",
  mine: "Your tasks",
  none: "Your tasks",
};

/**
 * A tile shows a skeleton until the count arrives, never 0. Rendering 0 while
 * loading makes a busy school look empty for the length of the round trip, and
 * the number then jumps, which reads as a bug.
 */
function tileValue(n: number | undefined) {
  return n === undefined ? <Skeleton className="h-8 w-14" /> : formatNumber(n);
}

interface TabView {
  tasks: Task[];
  /**
   * What the Board view shows for this tab. A board column IS a status, so the
   * board needs the tab source's whole lifecycle (open, in progress, in review,
   * rejected, completed) or its columns can never fill and a dragged card
   * vanishes the moment it changes status. Cards view keeps `tasks`, the tab's
   * own slice. Absent means the board shows `tasks` as-is.
   */
  boardTasks?: Task[];
  showAssigner: boolean;
  showAssignee: boolean;
  /** First failed source feeding this tab, for the board's error state. */
  error: unknown;
  onRetry: () => void;
  empty: { icon: ReactNode; title: string; description: string };
}

export default function TasksPage() {
  // Enable real-time updates for tasks
  useTaskRealtime();

  const myTasksQuery = useMyTasks();
  const approvalQuery = useTasksAwaitingApproval();
  const supervisingQuery = useSupervisingTasks();
  const assignedByMeQuery = useTasksAssignedByMe();
  const { data: myTasks, isLoading: myTasksLoading } = myTasksQuery;
  const { data: awaitingApproval, isLoading: approvalLoading } = approvalQuery;
  const { data: supervisingTasks, isLoading: supervisingLoading } = supervisingQuery;
  const { data: assignedByMe, isLoading: assignedByMeLoading } = assignedByMeQuery;
  const { data: userRole } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const institutionId = userRole?.institutionId || null;
  const isSchoolAdmin = userRole?.isSchoolAdmin || false;
  const isCoordinator = userRole?.isCoordinator || false;
  // Which hat this page is worn under. Dual-role scopes stay strictly separate
  // and switch on activeViewRole (CLAUDE.md §25); the app bar has carried the
  // real switcher since 2026-09-09. A pure coordinator has no switcher and
  // activeViewRole idles at its "teacher" default, so the view test applies
  // only when there is a choice to make. Never an isXOnly gate: that shape is
  // false for every dual-role user (the ExamsPage 35-of-356 bug).
  const coordinatorView =
    isCoordinator && (!hasDualRole || activeViewRole === "coordinator");
  // Admin wins when both hats are held: every server gate is an admin-first
  // OR-union, and the toggle cannot narrow what an admin may read.
  const showInstitutionView = isSchoolAdmin || coordinatorView;
  const wingScoped = coordinatorView && !isSchoolAdmin;
  // The DB's can_create_tasks() excludes super_admins, and a SALCI admin has no
  // institution to create a task in. They open this page to work support
  // tickets, so the assign controls are hidden rather than left to fail.
  const canAssignTasks = Boolean(institutionId) && !userRole?.isSuperAdmin;

  // Institution-wide list for admins, and for coordinators in coordinator
  // view. In teacher view a teacher+coordinator gets what a plain teacher
  // gets: their own tasks and no Overview tab.
  const institutionQuery = useInstitutionTasks(showInstitutionView ? institutionId : null);
  const { data: institutionTasks, isLoading: institutionTasksLoading } = institutionQuery;

  // A click carries the group id when it came from a collapsed group card, so
  // the detail panel can render the multi-assignee window without first
  // round-tripping through the single task.
  const [selection, setSelection] = useState<TaskSelection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const openTask = useCallback((next: TaskSelection) => {
    setSelection(next);
    setDetailOpen(true);
  }, []);

  // Deep link: /tasks?task=<uuid> opens the single-task panel (board "Copy
  // link" and notifications point here). Closing drops only that param.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkId = searchParams.get("task");
  const deepLinkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkId || deepLinkedRef.current === deepLinkId) return;
    deepLinkedRef.current = deepLinkId;
    openTask({ taskId: deepLinkId, groupId: null });
  }, [deepLinkId, openTask]);

  const handleDetailOpenChange = (open: boolean) => {
    setDetailOpen(open);
    if (open) return;
    setSelection(null);
    deepLinkedRef.current = null;
    if (searchParams.has("task")) {
      const next = new URLSearchParams(searchParams);
      next.delete("task");
      setSearchParams(next, { replace: true });
    }
  };

  // Controlled state for CreateTaskDialog so both the desktop
  // "Create Task" button (in PageHeader.primaryAction) and the
  // MobileFab open the same dialog. The dialog itself is rendered once
  // — see the `fab` prop on PageShell below.
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const navigate = useNavigate();

  // Inside the app the page is a phone screen: the six stat tiles (two
  // screens of 2x2 grid before the first task) and the Cards/Board toggle
  // are web furniture, so they step aside and the tab counts carry the
  // numbers. The website keeps all of it (2026-09-18 phone test).
  const native = isNativePlatform();

  // Cards or board. A standing preference, so it persists per browser.
  const [viewMode, setViewMode] = useViewMode(TASK_VIEW_STORAGE_KEY);
  const isBoard = !native && viewMode === "board";

  // Page-level date filter. Resets to "all" on every mount — no persistence
  // (matches the existing tab-default behavior). The resolved DateRange is
  // memoized so it's stable across renders that don't change the filter.
  const [dateFilter, setDateFilter] = useState<DateFilterState>(DEFAULT_FILTER);
  const dateRange = useMemo(() => resolveDateRange(dateFilter), [dateFilter]);
  const scopeSuffix = useMemo(() => formatDateScopeSuffix(dateFilter), [dateFilter]);

  // Which population the stat row counts, by role: an admin sees the whole
  // school, a coordinator their wing, everyone else their own work. This is a
  // REQUEST -- task_status_counts() re-derives the caller's authority server
  // side and silently downgrades a scope they do not hold, so the row is
  // labelled from `statusCounts.scope` (the answer) and never from this.
  const countScope: TaskCountScope = isSchoolAdmin
    ? "institution"
    : wingScoped
      ? "wing"
      : "mine";

  // Counted in the database, not here. The tiles used to be .length over
  // useInstitutionTasks(), which is .range(0, 999): Alliance has 1,548 task
  // rows, so every tile silently understated the school (Completed read 338
  // against 778 real). CLAUDE.md §23 forbids fetching rows to count them.
  const countsQuery = useTaskStatusCounts(countScope, dateRange);
  const statusCounts = countsQuery.data;

  const isLoading = myTasksLoading || approvalLoading || supervisingLoading || assignedByMeLoading ||
    (showInstitutionView && institutionTasksLoading);

  // A cancelled task is paused, not in flight. It keeps its underlying status
  // (that is how resuming restores it), so every "what is happening now" list
  // has to exclude it explicitly; it surfaces in Pending instead, marked
  // Cancelled.
  const isLive = (t: Task) => !isTaskCancelled(t);

  // Status-derived arrays — pre-filter; date filter wraps each one below.
  // Completed tasks use updated_at as the date field (the moment the task
  // was marked completed); everything else uses created_at as a proxy for
  // "when the task entered visibility for the user".
  const openTasks = useMemo(
    () => filterTasksByDate(myTasks?.filter((t) => t.status === "open" && isLive(t)) ?? [], dateRange, "created_at"),
    [myTasks, dateRange],
  );
  const inProgressTasks = useMemo(
    () => filterTasksByDate(myTasks?.filter((t) => t.status === "in_progress" && isLive(t)) ?? [], dateRange, "created_at"),
    [myTasks, dateRange],
  );
  // Sent back for rework. The assignee is the one who has to act, so this is
  // "Assigned TO Me" work exactly like open and in-progress rows. Before this
  // list existed, a rejected task sat on no tab at all (13 in prod, 2026-09-09).
  const rejectedTasks = useMemo(
    () => filterTasksByDate(myTasks?.filter((t) => t.status === "rejected" && isLive(t)) ?? [], dateRange, "created_at"),
    [myTasks, dateRange],
  );
  const pendingApprovalTasks = useMemo(
    () =>
      filterTasksByDate(
        // A cancelled task keeps whatever status it froze at, so one paused at
        // done_pending_approval is NOT awaiting approval: nobody can approve
        // it. It belongs in the cancelled bucket below, and counting it in
        // both is what rendered it twice.
        myTasks?.filter((t) => t.status === "done_pending_approval" && isLive(t)) ?? [],
        dateRange,
        "created_at",
      ),
    [myTasks, dateRange],
  );
  // Completed covers BOTH halves: work assigned to me, and work I handed to
  // someone else that they finished. Built from myTasks alone, anything you
  // assigned dropped out of sight the moment it was completed — it is excluded
  // from "Assigned BY Me" (which keeps only live rows) and was never in this
  // list either. Salci Support tickets made that obvious: the reporter is the
  // assigner, so a resolved ticket vanished from their Tasks tab entirely.
  const completedTasks = useMemo(
    () =>
      filterTasksByDate(
        dedupeTasksById(
          [...(myTasks ?? []), ...(assignedByMe ?? [])].filter(
            (t) => t.status === "completed",
          ),
        ),
        dateRange,
        "updated_at",
      ),
    [myTasks, assignedByMe, dateRange],
  );
  const activeSupervisingTasks = useMemo(
    () =>
      filterTasksByDate(
        supervisingTasks?.filter((t) => t.status !== "completed" && isLive(t)) ?? [],
        dateRange,
        "created_at",
      ),
    [supervisingTasks, dateRange],
  );
  const activeAssignedByMe = useMemo(
    () =>
      filterTasksByDate(
        assignedByMe?.filter((t) => t.status !== "completed" && isLive(t)) ?? [],
        dateRange,
        "created_at",
      ),
    [assignedByMe, dateRange],
  );
  // Pending = needs a decision. That is anything awaiting approval, plus
  // everything paused, which is exactly where a cancelled task should surface.
  const cancelledTasks = useMemo(
    () =>
      filterTasksByDate(
        dedupeTasksById(
          [...(myTasks ?? []), ...(assignedByMe ?? [])].filter(isTaskCancelled),
        ),
        dateRange,
        "updated_at",
      ),
    [myTasks, assignedByMe, dateRange],
  );

  // Board lifecycles. Each is one tab's source with every live status plus
  // that source's completed rows, so the board's five columns are all
  // reachable from the tab (Task 11). Completed rows date on updated_at like
  // the Completed tab; live rows on created_at like everything else. Pure
  // re-slices of lists already in memory: no query is added.
  const myLifecycleTasks = useMemo(
    () =>
      dedupeTasksById([
        ...openTasks,
        ...inProgressTasks,
        ...pendingApprovalTasks,
        ...rejectedTasks,
        ...filterTasksByDate(
          myTasks?.filter((t) => t.status === "completed") ?? [],
          dateRange,
          "updated_at",
        ),
      ]),
    [openTasks, inProgressTasks, pendingApprovalTasks, rejectedTasks, myTasks, dateRange],
  );
  const assignedByMeLifecycle = useMemo(
    () =>
      dedupeTasksById([
        ...activeAssignedByMe,
        ...filterTasksByDate(
          assignedByMe?.filter((t) => t.status === "completed") ?? [],
          dateRange,
          "updated_at",
        ),
      ]),
    [activeAssignedByMe, assignedByMe, dateRange],
  );
  const supervisingLifecycle = useMemo(
    () =>
      dedupeTasksById([
        ...activeSupervisingTasks,
        ...filterTasksByDate(
          supervisingTasks?.filter((t) => t.status === "completed") ?? [],
          dateRange,
          "updated_at",
        ),
      ]),
    [activeSupervisingTasks, supervisingTasks, dateRange],
  );

  // Three sources, and a task can legitimately satisfy more than one, so the
  // merge has to dedupe.
  const combinedPending = useMemo(
    () =>
      dedupeTasksById([
        ...pendingApprovalTasks,
        ...filterTasksByDate(
          (awaitingApproval ?? []).filter(isLive),
          dateRange,
          "created_at",
        ),
        ...cancelledTasks,
      ]),
    [pendingApprovalTasks, awaitingApproval, dateRange, cancelledTasks],
  );

  // Institution-wide arrays — same per-field mapping. activeInstitutionTasks
  // and the status breakdowns all use created_at; completedInstitutionTasks
  // uses updated_at.
  // In coordinator view the wing is the scope, and the server already draws
  // that line: since migration 20260909150000 a coordinator can read a
  // task_assignments row exactly when the task involves their wing's staff
  // (helper coordinator_covers_task), or is their own or supervised. A pure
  // coordinator therefore never receives a task without its assignment row.
  // A teacher+coordinator does, because the teacher role's institution-wide
  // `tasks` policy (deliberately kept, spec item 4) lets every task in the
  // school through with its people hidden. That is what printed 174 cards
  // reading "Not visible to you" on Alliance's coordinator Overview. Dropping
  // the rows whose assignment is hidden leaves precisely the pure-coordinator
  // set. This narrows a list that is already bounded by TASK_LIST_RANGE; the
  // counters below were computed client-side over this list before.
  const allInstitutionTasks = useMemo(() => {
    const rows = institutionTasks ?? [];
    return wingScoped ? rows.filter((t) => Boolean(t.assignment)) : rows;
  }, [institutionTasks, wingScoped]);
  const activeInstitutionTasks = useMemo(
    () =>
      filterTasksByDate(
        allInstitutionTasks.filter((t) => t.status !== "completed" && isLive(t)),
        dateRange,
        "created_at",
      ),
    [allInstitutionTasks, dateRange],
  );
  const completedInstitutionTasks = useMemo(
    () =>
      filterTasksByDate(
        allInstitutionTasks.filter((t) => t.status === "completed"),
        dateRange,
        "updated_at",
      ),
    [allInstitutionTasks, dateRange],
  );
  // The per-status institution slices that used to feed the stat tiles are
  // gone: those counts come from task_status_counts() now, which sees all
  // 1,548 rows instead of the 1,000 this list is capped at. Each was a full
  // filter pass over that array on every render, so removing them is a
  // straight win. The tabs' own counters below still run client-side because
  // they must match the list the tab renders, cap and all.

  // Same lifecycle shape for the Overview board: active plus completed, so the
  // Done column fills for admins and coordinators too.
  const institutionLifecycle = useMemo(
    () => dedupeTasksById([...activeInstitutionTasks, ...completedInstitutionTasks]),
    [activeInstitutionTasks, completedInstitutionTasks],
  );

  // A task given to several people is ONE item of work, so every counter
  // collapses groups exactly the way the grid, the board and the tiles do.
  // With the live list now complete, an admin's All Tasks badge equals the
  // tiles' To Do + In Progress + Needs Rework + Awaiting Approval. (A
  // coordinator's wing is drawn by RLS on the list and by a set-based
  // predicate in task_status_counts, so theirs agree closely, not exactly.)
  const counts = useMemo(
    () => ({
      activeInstitution: countTaskEntries(activeInstitutionTasks),
      myActive: countTaskEntries([...inProgressTasks, ...rejectedTasks, ...openTasks]),
      assignedByMe: countTaskEntries(activeAssignedByMe),
      supervising: countTaskEntries(activeSupervisingTasks),
      pending: countTaskEntries(combinedPending),
    }),
    [
      activeInstitutionTasks,
      inProgressTasks,
      rejectedTasks,
      openTasks,
      activeAssignedByMe,
      activeSupervisingTasks,
      combinedPending,
    ],
  );

  const [activeTab, setActiveTab] = useState<string>(showInstitutionView ? "all-tasks" : "my-tasks");

  // The tab follows the hat. Switching INTO the coordinator or admin view lands
  // on the Overview, which is what that view is for (it used to stay on
  // "Assigned TO Me", Naman 2026-09-28); switching OUT of it removes that tab,
  // so land on "Assigned TO Me" rather than on a strip with nothing selected.
  // The ref makes this fire only when the view actually changes, so every tab
  // stays free to click while the view holds.
  const wasInstitutionViewRef = useRef(showInstitutionView);
  useEffect(() => {
    const was = wasInstitutionViewRef.current;
    wasInstitutionViewRef.current = showInstitutionView;
    if (showInstitutionView && !was) {
      setActiveTab("all-tasks");
    } else if (!showInstitutionView && activeTab === "all-tasks") {
      setActiveTab("my-tasks");
    }
  }, [showInstitutionView, activeTab]);

  const tabs: MobileTabOption[] = useMemo(() => {
    const base: MobileTabOption[] = [];
    if (showInstitutionView) {
      base.push({
        value: "all-tasks",
        label: `${isSchoolAdmin ? "All Tasks" : "Wing Overview"}${scopeSuffix}`,
        icon: <Building2 className="h-4 w-4" />,
        count: counts.activeInstitution || undefined,
      });
    }
    base.push(
      {
        value: "my-tasks",
        label: `Assigned TO Me${scopeSuffix}`,
        icon: <Inbox className="h-4 w-4" />,
        count: counts.myActive || undefined,
      },
      {
        value: "assigned-by-me",
        label: `Assigned BY Me${scopeSuffix}`,
        icon: <Users className="h-4 w-4" />,
        count: counts.assignedByMe || undefined,
      },
      {
        value: "supervising",
        label: `Supervising${scopeSuffix}`,
        icon: <Eye className="h-4 w-4" />,
        count: counts.supervising || undefined,
      },
      {
        value: "pending",
        label: `Pending${scopeSuffix}`,
        icon: <AlertCircle className="h-4 w-4" />,
        count: counts.pending || undefined,
      },
      {
        value: "completed",
        label: `Completed${scopeSuffix}`,
        icon: <CheckCircle2 className="h-4 w-4" />,
      },
    );
    return base;
  }, [showInstitutionView, isSchoolAdmin, scopeSuffix, counts]);

  // What each tab shows, in both views. The tabs choose WHICH tasks; the view
  // chooses how they are arranged.
  const tabViews: Record<string, TabView> = {
    "all-tasks": {
      tasks: activeInstitutionTasks,
      boardTasks: institutionLifecycle,
      showAssigner: true,
      showAssignee: true,
      error: institutionQuery.error,
      onRetry: () => void institutionQuery.refetch(),
      empty: {
        icon: <Building2 className="h-7 w-7" />,
        title: `No active tasks${scopeSuffix}`,
        description: scopeSuffix
          ? "No active tasks in this window."
          : isSchoolAdmin
          ? "No active tasks in your institution."
          : "No active tasks in your wing.",
      },
    },
    "my-tasks": {
      // Rework sits between in-progress and open: it is the most urgent thing
      // on the list after what is already underway.
      tasks: [...inProgressTasks, ...rejectedTasks, ...openTasks],
      boardTasks: myLifecycleTasks,
      showAssigner: true,
      showAssignee: false,
      error: myTasksQuery.error,
      onRetry: () => void myTasksQuery.refetch(),
      empty: {
        icon: <CheckCircle2 className="h-7 w-7" />,
        title: `No pending tasks${scopeSuffix}`,
        description: scopeSuffix
          ? "No tasks assigned to you in this window."
          : "You're all caught up! No tasks assigned to you.",
      },
    },
    "assigned-by-me": {
      tasks: activeAssignedByMe,
      boardTasks: assignedByMeLifecycle,
      showAssigner: true,
      showAssignee: true,
      error: assignedByMeQuery.error,
      onRetry: () => void assignedByMeQuery.refetch(),
      empty: {
        icon: <Inbox className="h-7 w-7" />,
        title: `No tasks assigned by you${scopeSuffix}`,
        description: scopeSuffix
          ? "No tasks were assigned by you in this window."
          : "Tasks you assign to others will appear here.",
      },
    },
    supervising: {
      tasks: activeSupervisingTasks,
      boardTasks: supervisingLifecycle,
      showAssigner: true,
      showAssignee: true,
      error: supervisingQuery.error,
      onRetry: () => void supervisingQuery.refetch(),
      empty: {
        icon: <Eye className="h-7 w-7" />,
        title: `No tasks to supervise${scopeSuffix}`,
        description: scopeSuffix
          ? "No tasks under your supervision in this window."
          : "Tasks where you are tagged as supervisor will appear here.",
      },
    },
    pending: {
      tasks: combinedPending,
      showAssigner: true,
      showAssignee: true,
      error: myTasksQuery.error ?? approvalQuery.error ?? assignedByMeQuery.error,
      onRetry: () => {
        void myTasksQuery.refetch();
        void approvalQuery.refetch();
        void assignedByMeQuery.refetch();
      },
      empty: {
        icon: <AlertCircle className="h-7 w-7" />,
        title: `No pending tasks${scopeSuffix}`,
        description: scopeSuffix
          ? "No tasks were pending in this window."
          : "Tasks awaiting approval or pending action will appear here.",
      },
    },
    completed: {
      tasks: showInstitutionView ? completedInstitutionTasks : completedTasks,
      showAssigner: showInstitutionView,
      showAssignee: showInstitutionView,
      error: showInstitutionView
        ? institutionQuery.error
        : myTasksQuery.error ?? assignedByMeQuery.error,
      onRetry: () => {
        if (showInstitutionView) void institutionQuery.refetch();
        else {
          void myTasksQuery.refetch();
          void assignedByMeQuery.refetch();
        }
      },
      empty: {
        icon: <CheckCircle2 className="h-7 w-7" />,
        title: `No completed tasks${scopeSuffix}`,
        description: scopeSuffix
          ? "No tasks were completed in this window."
          : "Completed tasks will appear here.",
      },
    },
  };

  const activeView = tabViews[activeTab] ?? tabViews["my-tasks"];

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell
      fab={
        // A SALCI super admin belongs to no institution, and can_create_tasks()
        // excludes them anyway, so offering "Assign Task" would only produce an
        // RLS error. They reach this page for support tickets only.
        canAssignTasks ? (
          <CreateTaskDialog
            institutionId={institutionId}
            open={createTaskOpen}
            onOpenChange={setCreateTaskOpen}
            trigger={
              <MobileFab
                label="Assign Task"
                icon={<Plus className="h-6 w-6" />}
                onClick={() => setCreateTaskOpen(true)}
              />
            }
          />
        ) : undefined
      }
    >
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title="Tasks"
        // Says which hat the page is worn under, so the switch in the app bar
        // has a visible consequence here and not only in the tab strip.
        subtitle={
          isSchoolAdmin
            ? "Manage your assigned tasks and approvals"
            : coordinatorView
              ? "Follow up on tasks across your wing, plus your own"
              : "Tasks assigned to you, assigned by you, or under your supervision"
        }
        primaryAction={
          canAssignTasks
            ? {
                label: "Assign Task",
                icon: <Plus className="h-4 w-4" />,
                onClick: () => setCreateTaskOpen(true),
              }
            : undefined
        }
        // The header keeps only navigation and the one primary act. The view
        // toggle and the date filter used to sit up here too, five controls
        // in three different button styles at the top-right; they now live
        // beside the tab strip, which is what they act on.
        secondaryActions={[
          ...(showInstitutionView
            ? [
                {
                  label: "Workforce Overview",
                  icon: <Users className="h-4 w-4" />,
                  onClick: () => navigate("/school/workforce"),
                },
              ]
            : []),
          // Hidden for a super admin, matching the sidebar footer: SALCI
          // receives support requests, it does not raise them. Their queue is
          // /admin/issues. Goes to /support, the same destination as the
          // sidebar footer entry, so a request raised from here has a thread
          // to come back to.
          ...(!userRole?.isSuperAdmin
            ? [
                {
                  label: "Salci Support",
                  icon: <MessageSquareWarning className="h-4 w-4" />,
                  onClick: () => navigate("/support"),
                },
              ]
            : []),
        ]}
      />

      {/* Website only. On a phone this row pushed the actual task list below
          the fold, so the app opens straight on the work (Naman, 2026-09-21).
          His version hid the OLD client-counted tiles; the tiles themselves
          have since been rebuilt on the task_status_counts RPC (six disjoint
          server-side counts, plus the error state below), so the wrapper is
          re-applied here rather than his block being taken wholesale. */}
      {!native && (
        <>
        {/* Scope caption. The row counts ONE population, named once here rather
            than suffixed onto every tile: the old labels carried the date window
            ("Opened This Week") which made them long while still never saying
            WHOSE tasks were being counted. Read back from the server's answer,
            never from countScope, so the caption cannot claim a scope the numbers
            do not actually have. */}
        <p className="eyebrow mt-4">
          {SCOPE_LABEL[statusCounts?.scope ?? countScope]}
          {scopeSuffix}
          {statusCounts ? ` · ${formatNumber(statusCounts.total)} tasks` : ""}
        </p>

        {/* Error BEFORE the tiles (§6). A failed count resolving to six zeros
            reads as "this school has no work", which is the worst possible lie
            for this surface. The lists below run off separate queries, so they
            are unaffected and the copy says so. */}
        {countsQuery.error ? (
          <div className="mt-2 surface-card frosted-shadow rounded-card border-ink-400/50">
            <EmptyState
              icon={<AlertTriangle className="h-7 w-7" />}
              tone="rose"
              reason="error"
              title="Couldn't load task counts"
              description="Something went wrong fetching the totals. The task lists below are unaffected."
              action={{
                label: countsQuery.isFetching ? "Retrying..." : "Retry",
                icon: (
                  <RefreshCw className={cn("h-4 w-4", countsQuery.isFetching && "animate-spin")} />
                ),
                onClick: () => {
                  if (!countsQuery.isFetching) void countsQuery.refetch();
                },
              }}
            />
          </div>
        ) : (
          /* Six DISJOINT buckets: every task lands in exactly one, so the row
             sums to the total in the caption. The old row could not reconcile --
             it mixed a status partition (Open, In Progress) with a cross-cutting
             slice (Supervising, which overlaps all of them) and a fused bucket
             (Pending = awaiting approval + cancelled, where cancelled was also
             excluded from "All Tasks"). Supervising is still one click away as a
             tab, which carries its own count. */
          <StatTileGrid mdCols={3} lgCols={6} className="mt-2">
            <StatTile
              label="To Do"
              value={tileValue(statusCounts?.to_do)}
              icon={<Inbox className="h-5 w-5" />}
              tone="teal"
            />
            <StatTile
              label="In Progress"
              value={tileValue(statusCounts?.in_progress)}
              icon={<Clock className="h-5 w-5" />}
              tone="sky"
            />
            <StatTile
              label="Needs Rework"
              value={tileValue(statusCounts?.needs_rework)}
              icon={<RotateCcw className="h-5 w-5" />}
              tone="rose"
            />
            <StatTile
              label="Awaiting Approval"
              value={tileValue(statusCounts?.awaiting_approval)}
              icon={<AlertCircle className="h-5 w-5" />}
              tone="peach"
            />
            <StatTile
              label="Completed"
              value={tileValue(statusCounts?.completed)}
              icon={<CheckCircle2 className="h-5 w-5" />}
              tone="mint"
            />
            <StatTile
              label="Cancelled"
              value={tileValue(statusCounts?.cancelled)}
              icon={<Ban className="h-5 w-5" />}
              tone="violet"
            />
          </StatTileGrid>
        )}
        </>
      )}

      {/* Tab strip on the left, the controls that act on it on the right:
          date window and Cards/Board. Stacks on a phone. In the app the date
          filter sits on the tab row itself and the strip scrolls with the
          page (native-unpin, index.css); other pages keep their strip pinned. */}
      <div
        className={cn(
          "sticky top-[var(--app-bar-offset,var(--app-bar-height,61px))] z-20 -mx-4 px-4 py-2 tab-strip-frost shadow-none native-unpin",
          native ? "mt-2" : "mt-6",
        )}
      >
        <div
          className={cn(
            "flex gap-3 lg:flex-row lg:items-center lg:justify-between",
            native ? "flex-row items-center" : "flex-col",
          )}
        >
          <MobileTabs
            value={activeTab}
            onValueChange={setActiveTab}
            options={tabs}
            className="min-w-0 flex-1 lg:flex-1"
          />
          <div className="flex shrink-0 items-center gap-2">
            <TaskDateFilter value={dateFilter} onChange={setDateFilter} />
            {!native && <ViewModeToggle value={viewMode} onChange={setViewMode} />}
          </div>
        </div>
      </div>

      <div className={native ? "mt-3" : "mt-6"}>
        {isBoard ? (
          <TaskBoardView
            tasks={activeView.boardTasks ?? activeView.tasks}
            isLoading={false}
            error={activeView.error}
            onRetry={activeView.onRetry}
            onOpen={openTask}
            canAssignTasks={canAssignTasks}
            onCreateTask={() => setCreateTaskOpen(true)}
            emptyState={
              <EmptyState
                icon={activeView.empty.icon}
                title={activeView.empty.title}
                description={activeView.empty.description}
              />
            }
          />
        ) : activeView.error ? (
          /* Error BEFORE empty (§6). Cards is the DEFAULT view and it was the
             one branch that never checked: the failure was already computed
             and handed to the Board above, just never to this side, so a dead
             query rendered "You're all caught up" over a list that never
             loaded. Same icon, copy and affordance as KanbanBoard's error so
             the two views cannot drift apart. */
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Couldn't load tasks"
            description={
              translateError(
                activeView.error,
                "Something went wrong fetching your tasks. Please try again.",
              ).title
            }
            tone="rose"
            reason="error"
            action={{ label: "Try again", onClick: activeView.onRetry }}
          />
        ) : activeView.tasks.length > 0 ? (
          <TaskCollectionGrid
            tasks={activeView.tasks}
            onOpen={openTask}
            showAssigner={activeView.showAssigner}
            showAssignee={activeView.showAssignee}
          />
        ) : (
          <EmptyState
            icon={activeView.empty.icon}
            title={activeView.empty.title}
            description={activeView.empty.description}
          />
        )}
      </div>

      {/* ONE detail panel at page level. A board card lives in exactly one
          status column, so a status change unmounts it; a Sheet owned by the
          card would be torn down mid-transition and leave pointer-events:none
          stuck on <body>. */}
      <TaskDetailPanel
        taskId={selection?.taskId ?? null}
        groupId={selection?.groupId ?? null}
        open={detailOpen}
        onOpenChange={handleDetailOpenChange}
      />

    </PageShell>
  );
}


function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
