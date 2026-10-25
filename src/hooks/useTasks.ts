import { useQuery, useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables, Enums, Json } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast";
import type { DateRange } from "@/lib/taskDateFilter";

/**
 * `task_group_id` (from `Tables<"tasks">`) is set when this task is one member
 * of a multi-assignee assignment — every sibling created by the same
 * `create_task_group` call shares the value. NULL means a single-assignee task,
 * which is every task created before migration 20260806120000.
 */
export interface TaskSupervisor {
  id: string;
  full_name: string;
  email: string;
}

export type Task = Tables<"tasks"> & {
  assignment?: Tables<"task_assignments"> | null;
  links?: Tables<"task_links"> | null;
  evidence?: Tables<"task_evidence">[];
  assigner_profile?: { full_name: string; email: string } | null;
  assignee_profile?: { full_name: string; email: string } | null;
  /**
   * Legacy single supervisor, read from `task_assignments.supervisor_id`. Kept
   * in sync with `supervisors[0]`. Prefer `supervisors`.
   */
  supervisor_profile?: { full_name: string; email: string } | null;
  /** Every observer of this task, from `task_supervisors`. */
  supervisors?: TaskSupervisor[];
};

export type TaskStatus = Enums<"task_status">;
export type TaskType = Enums<"task_type">;

// Shared select string for task joins
const TASK_JOIN_SELECT = `
  *,
  task_assignments!inner(
    *,
    assigner:profiles!task_assignments_assigner_id_fkey(full_name, email),
    assignee:profiles!task_assignments_assignee_id_fkey(full_name, email),
    supervisor:profiles!task_assignments_supervisor_id_fkey(full_name, email)
  ),
  task_evidence(*),
  task_links(*),
  task_supervisors(
    supervisor_id,
    profile:profiles!task_supervisors_supervisor_id_fkey(full_name, email)
  )
`;

// Shape of one task row as returned by TASK_JOIN_SELECT
type ProfileEmbed = { full_name: string; email: string } | null;
type AssignmentJoin = Tables<"task_assignments"> & {
  assigner: ProfileEmbed;
  assignee: ProfileEmbed;
  supervisor: ProfileEmbed;
};
type SupervisorJoin = {
  supervisor_id: string;
  profile: ProfileEmbed;
};
type TaskJoinRow = Tables<"tasks"> & {
  task_assignments?: AssignmentJoin[] | AssignmentJoin | null;
  task_evidence?: Tables<"task_evidence">[] | null;
  task_links?: Tables<"task_links">[] | null;
  task_supervisors?: SupervisorJoin[] | null;
};

/**
 * Explicit upper bound on every task list. PostgREST silently truncates at
 * 1000 rows, so this makes the existing implicit cap visible without changing
 * what any caller sees today (CLAUDE.md §23 — paginate every unbounded list).
 */
const TASK_LIST_RANGE: [number, number] = [0, 999];

/** Shared React Query default for task lists (CLAUDE.md §23 — staleTime floor). */
const TASK_STALE_TIME = 60_000;

/**
 * Cap on the Supervising tab. The ids are sent as an `in(...)` URL filter, so
 * this is bounded by URL length rather than by the PostgREST row cap.
 */
const MAX_SUPERVISING_TASKS = 200;

/** Ceiling the `create_task_group` RPC enforces on supervisors per task. */
export const MAX_TASK_SUPERVISORS = 50;

/**
 * Who assigned a task, for display. Flag-evaluator auto-tasks are created
 * with assigner_id NULL by design (system-generated; user decision
 * 2026-07-24: never display a particular admin on auto-assigned tasks) —
 * label them instead of "Unknown". Manual assignments, including per-flag
 * "Create a task" clicks, show the real assigner.
 */
export function taskAssignerName(task: Task): string {
  if (task.assigner_profile?.full_name) return task.assigner_profile.full_name;
  // Only claim "system" when an assignment row is actually VISIBLE and has no
  // assigner. A missing row means RLS hid it — `task_assignments` is readable
  // only by its participants, supervisors and school admins, while `tasks` is
  // readable by every teacher/coordinator in the institution. Treating
  // "hidden" as "auto-generated" made real, human-assigned tasks claim to be
  // system tasks; calling it "Unknown" read as a data bug to coordinators.
  if (!task.assignment) return HIDDEN_ASSIGNMENT_LABEL;
  if (!task.assignment.assigner_id) return "SALCI System (auto-generated)";
  return "Unknown";
}

/**
 * Label for the assigner/assignee when RLS hid the whole `task_assignments`
 * row from this viewer. Since migration 20260909150000 a coordinator reads the
 * row for every task involving their wing's staff, so this is now reached only
 * through the TEACHER role, whose `tasks` policy is still institution-wide
 * while `task_assignments` is not: a teacher opening a task they neither
 * assigned, received nor supervise. Decision 2026-09-09: teachers are to see
 * only those three, which retires this label once the policy is narrowed. Not
 * a frontend guess either way — see
 * docs/superpowers/specs/2026-09-09-coordinator-task-assignment-visibility.md.
 */
export const HIDDEN_ASSIGNMENT_LABEL = "Not visible to you";

// Normalize joined data to match the Task type
function normalizeTask(raw: unknown): Task {
  const {
    task_assignments: rawAssignments,
    task_evidence,
    task_links,
    task_supervisors,
    ...taskRow
  } = raw as TaskJoinRow;
  const assignment = Array.isArray(rawAssignments)
    ? rawAssignments[0] ?? null
    : rawAssignments ?? null;

  // Rows whose profile embed is hidden by RLS are dropped rather than shown as
  // an unnamed supervisor.
  const supervisors: TaskSupervisor[] = (task_supervisors ?? [])
    .filter((s) => s.profile)
    .map((s) => ({
      id: s.supervisor_id,
      full_name: s.profile!.full_name,
      email: s.profile!.email,
    }));

  return {
    supervisors,
    ...taskRow,
    assignment: assignment ? {
      id: assignment.id,
      task_id: assignment.task_id,
      assigner_id: assignment.assigner_id,
      assignee_id: assignment.assignee_id,
      supervisor_id: assignment.supervisor_id,
      assigned_at: assignment.assigned_at,
    } : null,
    links: task_links?.[0] || null,
    evidence: task_evidence || [],
    assigner_profile: assignment?.assigner || null,
    assignee_profile: assignment?.assignee || null,
    supervisor_profile: assignment?.supervisor || null,
  };
}

// Hook for tasks where user is the supervisor
export function useSupervisingTasks() {
  return useQuery({
    queryKey: ["supervising-tasks"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Two steps on purpose. Filtering an embedded `task_supervisors!inner`
      // would also trim the embed to just this user, hiding a task's other
      // supervisors from the card. Bounded well below the 1000-row cap because
      // the ids go into an `in(...)` URL filter, which has a length limit.
      const { data: rows, error: supError } = await supabase
        .from("task_supervisors")
        .select("task_id")
        .eq("supervisor_id", user.id)
        .range(0, MAX_SUPERVISING_TASKS - 1);

      if (supError) throw supError;

      const taskIds = (rows ?? []).map((r) => r.task_id);
      if (taskIds.length === 0) return [];

      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_JOIN_SELECT)
        .in("id", taskIds)
        .order("created_at", { ascending: false })
        .range(...TASK_LIST_RANGE);

      if (error) throw error;
      return (data || []).map(normalizeTask);
    },
    staleTime: TASK_STALE_TIME,
  });
}

/** Which population the Tasks stat row counts. Mirrors the page's role gates. */
export type TaskCountScope = "institution" | "wing" | "mine";

/**
 * Six disjoint, group-collapsed task counters. They sum to `total`.
 *
 * `scope` is what the server ACTUALLY applied, not what was asked for: the RPC
 * downgrades a scope the caller does not hold (a teacher asking for
 * "institution" gets "mine"). Label the row from this, never from the request,
 * or the caption will claim a scope the numbers do not have.
 */
export interface TaskStatusCounts {
  scope: TaskCountScope | "none";
  to_do: number;
  in_progress: number;
  needs_rework: number;
  awaiting_approval: number;
  completed: number;
  cancelled: number;
  total: number;
}

/**
 * Server-side counters for the Tasks page stat row.
 *
 * Replaces counting client-side over useInstitutionTasks(), which is bounded at
 * .range(0, 999): Alliance has 1,548 task rows, so 548 were never fetched and
 * every tile understated the school (Completed read 338 against 778 real).
 * CLAUDE.md section 23 forbids fetching rows to .length them.
 *
 * `as never` on the name and args is the repo's standing pattern for an RPC the
 * generated types have not caught up with yet (see useBadgeLeaderboard); it
 * keeps the call off `any`, which is a hard lint error here.
 */
export function useTaskStatusCounts(scope: TaskCountScope, range: DateRange | null) {
  return useQuery({
    queryKey: [
      "task-status-counts",
      scope,
      range?.from.toISOString() ?? null,
      range?.to.toISOString() ?? null,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "task_status_counts" as never,
        {
          p_scope: scope,
          p_from: range ? range.from.toISOString() : null,
          p_to: range ? range.to.toISOString() : null,
        } as never,
      );
      if (error) throw error;
      return data as unknown as TaskStatusCounts;
    },
    staleTime: TASK_STALE_TIME,
  });
}

export function useMyTasks() {
  return useQuery({
    queryKey: ["my-tasks"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_JOIN_SELECT)
        .eq("task_assignments.assignee_id", user.id)
        .order("created_at", { ascending: false })
        .range(...TASK_LIST_RANGE);

      if (error) throw error;
      return (data || []).map(normalizeTask);
    },
    staleTime: TASK_STALE_TIME,
  });
}

// Hook for all tasks assigned BY the current user (regardless of status)
export function useTasksAssignedByMe() {
  return useQuery({
    queryKey: ["tasks-assigned-by-me"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_JOIN_SELECT)
        .eq("task_assignments.assigner_id", user.id)
        .order("created_at", { ascending: false })
        .range(...TASK_LIST_RANGE);

      if (error) throw error;
      return (data || []).map(normalizeTask);
    },
    staleTime: TASK_STALE_TIME,
  });
}

export function useTasksAwaitingApproval() {
  return useQuery({
    queryKey: ["tasks-awaiting-approval"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_JOIN_SELECT)
        .eq("task_assignments.assigner_id", user.id)
        .eq("status", "done_pending_approval")
        .order("updated_at", { ascending: false })
        .range(...TASK_LIST_RANGE);

      if (error) throw error;
      return (data || []).map(normalizeTask);
    },
    staleTime: TASK_STALE_TIME,
  });
}

export function useTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: ["task-detail", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      if (!taskId) throw new Error("No task ID");

      const { data, error } = await supabase
        .from("tasks")
        .select(`
          *,
          task_assignments(
            *,
            assigner:profiles!task_assignments_assigner_id_fkey(full_name, email),
            assignee:profiles!task_assignments_assignee_id_fkey(full_name, email),
            supervisor:profiles!task_assignments_supervisor_id_fkey(full_name, email)
          ),
          task_evidence(*),
          task_links(*),
          task_supervisors(
            supervisor_id,
            profile:profiles!task_supervisors_supervisor_id_fkey(full_name, email)
          )
        `)
        .eq("id", taskId)
        .single();

      if (error) throw error;
      return normalizeTask(data);
    },
  });
}

// ---------------------------------------------------------------------------
// Multi-assignee task groups
// ---------------------------------------------------------------------------

/**
 * Matches the ceiling enforced by the `create_task_group` RPC. Sized for
 * "assign to everyone": the largest institution on prod has 94 assignable
 * members, so this is headroom rather than a limit anyone meets. Keep the two
 * in sync — the RPC rejects anything above it.
 */
export const MAX_GROUP_ASSIGNEES = 200;

/**
 * Every sibling task of a multi-assignee group.
 *
 * RLS does the scoping for free: an assignee can only read their own row, so
 * this returns a single task for them and the detail panel falls back to the
 * normal single-assignee window. The assigner (and school admins) read the
 * whole group.
 */
export function useTaskGroupDetail(groupId: string | null) {
  return useQuery({
    queryKey: ["task-group-detail", groupId],
    enabled: !!groupId,
    queryFn: async (): Promise<Task[]> => {
      if (!groupId) return [];

      const { data, error } = await supabase
        .from("tasks")
        .select(`
          *,
          task_assignments(
            *,
            assigner:profiles!task_assignments_assigner_id_fkey(full_name, email),
            assignee:profiles!task_assignments_assignee_id_fkey(full_name, email),
            supervisor:profiles!task_assignments_supervisor_id_fkey(full_name, email)
          ),
          task_evidence(*),
          task_links(*),
          task_supervisors(
            supervisor_id,
            profile:profiles!task_supervisors_supervisor_id_fkey(full_name, email)
          )
        `)
        .eq("task_group_id", groupId)
        .order("created_at", { ascending: true })
        // Bounded by the same ceiling the RPC enforces when creating a group.
        .range(0, MAX_GROUP_ASSIGNEES - 1);

      if (error) throw error;
      return (data || []).map(normalizeTask);
    },
    staleTime: TASK_STALE_TIME,
  });
}

/**
 * Roll-up ordering for a group's headline status: the least-advanced member
 * wins, so a group never reads as further along than its slowest person.
 * `rejected` sorts first because it is the state that needs attention most.
 */
const STATUS_RANK: Record<TaskStatus, number> = {
  rejected: 0,
  open: 1,
  in_progress: 2,
  done_pending_approval: 3,
  completed: 4,
};

export interface TaskGroupEntry {
  kind: "group";
  groupId: string;
  /** Earliest-created member — the group's shared metadata is read from it. */
  lead: Task;
  members: Task[];
  /** Headline status: the least-advanced member. */
  rollupStatus: TaskStatus;
  completedCount: number;
  /** Members that are paused. They keep their underlying status. */
  cancelledCount: number;
  counts: Record<TaskStatus, number>;
}

export type TaskListEntry = { kind: "single"; task: Task } | TaskGroupEntry;

/**
 * Collapse a task list so each multi-assignee group renders as one entry.
 *
 * Order is preserved: a group takes the position of its first member.
 *
 * A group only forms when the viewer can read EVERY member's assignment row.
 * `tasks` is readable institution-wide by teachers, coordinators and admins,
 * but `task_assignments` is readable only by its participants and school
 * admins — so a coordinator can see three sibling task rows while seeing none
 * of their assignees. Collapsing those into one card produced a group of
 * "Unknown" people. When any assignment is hidden, the rows stay as singles.
 */
export function groupTasks(tasks: Task[]): TaskListEntry[] {
  const byGroup = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task.task_group_id) continue;
    const bucket = byGroup.get(task.task_group_id);
    if (bucket) bucket.push(task);
    else byGroup.set(task.task_group_id, [task]);
  }

  const emitted = new Set<string>();
  const entries: TaskListEntry[] = [];

  for (const task of tasks) {
    const groupId = task.task_group_id;
    const members = groupId ? byGroup.get(groupId) : undefined;

    // Needs two or more members AND full visibility of who they are.
    if (
      !groupId ||
      !members ||
      members.length < 2 ||
      !members.every((m) => m.assignment && m.assignee_profile)
    ) {
      entries.push({ kind: "single", task });
      continue;
    }

    if (emitted.has(groupId)) continue;
    emitted.add(groupId);

    const ordered = [...members].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const counts: Record<TaskStatus, number> = {
      open: 0,
      in_progress: 0,
      done_pending_approval: 0,
      completed: 0,
      rejected: 0,
    };
    for (const member of ordered) counts[member.status] += 1;

    const rollupStatus = ordered.reduce<TaskStatus>(
      (worst, member) =>
        STATUS_RANK[member.status] < STATUS_RANK[worst] ? member.status : worst,
      ordered[0].status,
    );

    entries.push({
      kind: "group",
      groupId,
      lead: ordered[0],
      members: ordered,
      rollupStatus,
      completedCount: counts.completed,
      cancelledCount: ordered.filter(isTaskCancelled).length,
      counts,
    });
  }

  return entries;
}

/** Number of list rows a set of tasks occupies once groups are collapsed. */
export function countTaskEntries(tasks: Task[] | undefined): number {
  if (!tasks || tasks.length === 0) return 0;
  return groupTasks(tasks).length;
}

/**
 * First occurrence of each task id, order preserved.
 *
 * Any tab built by concatenating several source lists needs this: a task can
 * satisfy more than one of them at once. A cancelled task still sitting at
 * `done_pending_approval`, for instance, matches both a status-derived list
 * and a cancelled-derived one, and rendered twice until this existed.
 */
export function dedupeTasksById(tasks: Task[]): Task[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
}

// Hook to get coordinators for supervisor selection
export function useCoordinatorsInInstitution(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-coordinators", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      if (!institutionId) return [];
      
      // Get coordinators in this institution
      const { data: coordinatorRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("institution_id", institutionId)
        .eq("role", "coordinator");
      
      if (rolesError) throw rolesError;
      
      const coordinatorIds = coordinatorRoles?.map(r => r.user_id) || [];
      if (coordinatorIds.length === 0) return [];
      
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", coordinatorIds);
      
      if (profilesError) throw profilesError;
      
      return profiles || [];
    },
  });
}

// Hook for task comments
export function useTaskComments(taskId: string | null) {
  return useQuery({
    queryKey: ["task-comments", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      if (!taskId) return [];
      
      const { data, error } = await supabase
        .from("task_comments")
        .select(`
          *,
          profiles:user_id (full_name, email)
        `)
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });
}

export function useAddTaskComment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ taskId, content }: { taskId: string; content: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("task_comments")
        .insert({
          task_id: taskId,
          user_id: user.id,
          content,
        });

      if (error) throw error;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["task-comments", taskId] });
      toast({
        title: "Comment added",
        description: "Your comment has been posted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error adding comment",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

/**
 * Every list key a status change can be sitting in. Patched and rolled back
 * by PREFIX: `useInstitutionTasks` embeds the institution id in its key, so
 * several variants can be cached at once.
 */
const TASK_STATUS_LIST_KEYS = [
  "my-tasks",
  "tasks-assigned-by-me",
  "tasks-awaiting-approval",
  "supervising-tasks",
  "institution-tasks",
] as const;

type TaskListSnapshot = Array<[QueryKey, Task[] | undefined]>;

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    // Optimistic: the board moves the card the instant it is dropped. The
    // server (RLS + the validate_task_state_transition trigger) still decides; on error
    // every patched list is restored from its snapshot.
    onMutate: async ({ taskId, status }) => {
      await Promise.all(
        TASK_STATUS_LIST_KEYS.map((key) => queryClient.cancelQueries({ queryKey: [key] })),
      );
      const snapshots: TaskListSnapshot = TASK_STATUS_LIST_KEYS.flatMap((key) =>
        queryClient.getQueriesData<Task[]>({ queryKey: [key] }),
      );
      const patch = (old?: Task[]) =>
        old?.map((t) => (t.id === taskId ? { ...t, status } : t));
      for (const key of TASK_STATUS_LIST_KEYS) {
        queryClient.setQueriesData<Task[]>({ queryKey: [key] }, patch);
      }
      return { snapshots };
    },
    mutationFn: async ({ taskId, status, rejectionReason }: { taskId: string; status: TaskStatus; rejectionReason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("tasks")
        .update({ status })
        .eq("id", taskId);

      if (error) throw error;

      // Get task details and assignment for notifications
      const { data: task } = await supabase
        .from("tasks")
        .select("title")
        .eq("id", taskId)
        .single();

      const { data: assignment } = await supabase
        .from("task_assignments")
        .select("assignee_id, assigner_id, supervisor_id")
        .eq("task_id", taskId)
        .single();

      if (!task || !assignment) return;

      const taskTitle = task.title;

      // Send notifications based on status change
      if (status === "done_pending_approval") {
        // Notify assigner that task is submitted for approval
        await supabase.from("notifications").insert({
          user_id: assignment.assigner_id,
          type: "task_submitted",
          title: "Task Submitted for Approval",
          message: `Task "${taskTitle}" has been submitted and awaits your approval.`,
          link: `/tasks?task=${taskId}`,
          metadata: { task_id: taskId } as Json,
        });
      } else if (status === "completed") {
        // Notify assignee that task was approved
        await supabase.from("notifications").insert({
          user_id: assignment.assignee_id,
          type: "task_approved",
          title: "Task Approved ✅",
          message: `Your task "${taskTitle}" has been approved.`,
          link: `/tasks?task=${taskId}`,
          metadata: { task_id: taskId } as Json,
        });
      } else if (status === "rejected") {
        // Notify assignee that task was rejected
        await supabase.from("notifications").insert({
          user_id: assignment.assignee_id,
          type: "task_rejected",
          title: "Task Rejected",
          message: `Your task "${taskTitle}" was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
          link: `/tasks?task=${taskId}`,
          metadata: { task_id: taskId } as Json,
        });
      }

      // Notify supervisor on any status change (if exists and not the actor)
      if (assignment.supervisor_id && assignment.supervisor_id !== user.id) {
        await supabase.from("notifications").insert({
          user_id: assignment.supervisor_id,
          type: "task_status_changed",
          title: "Task Status Updated",
          message: `Task "${taskTitle}" status changed to ${status.replace(/_/g, " ")}.`,
          link: `/tasks?task=${taskId}`,
          metadata: { task_id: taskId, new_status: status } as Json,
        });
      }
    },
    onSuccess: () => {
      toast({
        title: "Task updated",
        description: "Task status has been updated successfully.",
      });
    },
    onError: (error: Error, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toastError(error, { fallback: "Could not update the task", context: "useUpdateTaskStatus" });
    },
    onSettled: () => {
      for (const key of TASK_STATUS_LIST_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      queryClient.invalidateQueries({ queryKey: ["task-detail"] });
      // Approving/rejecting one member from the grouped window must refresh
      // the group immediately, not wait on the realtime backstop.
      queryClient.invalidateQueries({ queryKey: ["task-group-detail"] });
    },
  });
}

export function useSubmitEvidence() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      taskId,
      evidenceType,
      notes,
      fileName,
      fileUrl,
      examReferenceId,
    }: {
      taskId: string;
      evidenceType: string;
      notes?: string;
      fileName?: string;
      fileUrl?: string;
      examReferenceId?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("task_evidence").insert({
        task_id: taskId,
        evidence_type: evidenceType,
        notes,
        file_name: fileName,
        file_url: fileUrl,
        exam_reference_id: examReferenceId,
        uploaded_by: user.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task-detail"] });
      queryClient.invalidateQueries({ queryKey: ["task-group-detail"] });
      toast({
        title: "Evidence submitted",
        description: "Your evidence has been added to the task.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error submitting evidence",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      return user;
    },
  });
}

export function useTeachersInInstitution(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-teachers", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      if (!institutionId) return [];
      
      // Get teachers in this institution
      const { data: teacherRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("institution_id", institutionId)
        .eq("role", "teacher");
      
      if (rolesError) throw rolesError;
      
      const teacherIds = teacherRoles?.map(r => r.user_id) || [];
      if (teacherIds.length === 0) return [];
      
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", teacherIds);
      
      if (profilesError) throw profilesError;
      
      return profiles || [];
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      title,
      description,
      taskType,
      priority,
      dueDate,
      assigneeId,
      institutionId,
      wingId,
      supervisorId,
    }: {
      title: string;
      description?: string;
      taskType: TaskType;
      priority: number;
      dueDate?: string;
      assigneeId: string;
      institutionId: string;
      wingId?: string;
      supervisorId?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create task with optional wing_id
      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .insert({
          title,
          description,
          task_type: taskType,
          priority,
          due_date: dueDate,
          institution_id: institutionId,
          wing_id: wingId || null,
          status: "open",
        })
        .select()
        .single();

      if (taskError) throw taskError;

      // Create assignment with optional supervisor
      const { error: assignError } = await supabase
        .from("task_assignments")
        .insert({
          task_id: task.id,
          assigner_id: user.id,
          assignee_id: assigneeId,
          supervisor_id: supervisorId || null,
        });

      if (assignError) throw assignError;

      // Send notification to assignee
      await supabase.from("notifications").insert({
        user_id: assigneeId,
        type: "task_assigned",
        title: "New Task Assigned",
        message: `You have been assigned a new task: "${title}"`,
        link: `/tasks?task=${task.id}`,
        metadata: { task_id: task.id } as Json,
      });

      // Notify supervisor if exists
      if (supervisorId) {
        await supabase.from("notifications").insert({
          user_id: supervisorId,
          type: "task_assigned",
          title: "New Task to Supervise",
          message: `You are supervising a new task: "${title}"`,
          link: `/tasks?task=${task.id}`,
          metadata: { task_id: task.id } as Json,
        });
      }

      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-awaiting-approval"] });
      toast({
        title: "Task created",
        description: "Task has been assigned successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error creating task",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

/** One row of the Assign To list in the create dialog. */
export interface TaskGroupAssigneeInput {
  assigneeId: string;
  /** Blank inherits the group's title. */
  title?: string;
  /** Blank inherits the group's description. */
  description?: string;
}

interface CreateTaskGroupResult {
  task_group_id: string | null;
  task_ids: string[];
  assignee_count: number;
}

type CreateTaskGroupArgs = Database["public"]["Functions"]["create_task_group"]["Args"];

/**
 * Supabase typegen emits every RPC argument as non-nullable, but
 * `create_task_group` accepts NULL for description, due date and supervisor.
 * Model that here so the call site can pass null honestly, and narrow back to
 * the generated shape at the boundary.
 */
type CreateTaskGroupArgsNullable = {
  [K in keyof CreateTaskGroupArgs]: CreateTaskGroupArgs[K] | null;
};

/**
 * Assign one task to one or more people.
 *
 * Every write goes through the `create_task_group` RPC in a single
 * transaction rather than a client-side loop — three assignees would
 * otherwise be nine sequential round trips (CLAUDE.md §23: two or more
 * dependent writes are ONE RPC). It also makes the assignment
 * all-or-nothing, so a mid-loop failure can never leave two of three people
 * assigned.
 *
 * With a single assignee the RPC leaves `task_group_id` NULL, so the task is
 * indistinguishable from one created the old way.
 */
export function useCreateTaskGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      title,
      description,
      taskType,
      priority,
      dueDate,
      institutionId,
      supervisorIds,
      assignees,
    }: {
      title: string;
      description?: string;
      taskType: TaskType;
      priority: number;
      dueDate?: string;
      institutionId: string;
      supervisorIds?: string[];
      assignees: TaskGroupAssigneeInput[];
    }): Promise<CreateTaskGroupResult> => {
      const args: CreateTaskGroupArgsNullable = {
        p_institution_id: institutionId,
        p_title: title,
        p_description: description?.trim() || null,
        p_task_type: taskType,
        p_priority: priority,
        p_due_date: dueDate || null,
        // The legacy single-supervisor parameter stays NULL; the RPC merges
        // both and mirrors the first into task_assignments.supervisor_id.
        p_supervisor_id: null,
        p_supervisor_ids: supervisorIds?.length ? supervisorIds : null,
        p_assignees: assignees.map((a) => ({
          assignee_id: a.assigneeId,
          title: a.title?.trim() || null,
          description: a.description?.trim() || null,
        })),
      };

      const { data, error } = await supabase.rpc(
        "create_task_group",
        args as CreateTaskGroupArgs,
      );

      if (error) throw error;
      // The function is declared RETURNS jsonb, so typegen widens it to Json.
      const result = data as unknown as CreateTaskGroupResult;
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-assigned-by-me"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-awaiting-approval"] });
      queryClient.invalidateQueries({ queryKey: ["supervising-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["institution-tasks"] });

      sonnerToast.success(
        result.assignee_count > 1
          ? `Task assigned to ${result.assignee_count} people`
          : "Task assigned",
      );
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't assign the task.",
        context: "createTaskGroup",
      }),
  });
}

// ---------------------------------------------------------------------------
// Delete / cancel / resume
// ---------------------------------------------------------------------------

/** A cancelled task is frozen: it keeps its status, evidence and comments. */
export function isTaskCancelled(task: Pick<Task, "cancelled_at">): boolean {
  return Boolean(task.cancelled_at);
}

/**
 * Mirrors the `can_manage_task` DB helper for button visibility only. The RPCs
 * re-check server-side, so this never has to be trusted.
 */
export function canManageTask(
  task: Task,
  currentUserId: string | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  return Boolean(currentUserId && task.assignment?.assigner_id === currentUserId);
}

export type TaskManageMode = "delete" | "cancel" | null;

/**
 * Which escape hatch applies right now.
 *
 * Untouched work can simply be deleted. Once someone has started, deleting
 * would throw away real work, so it becomes a cancel.
 *
 * Cancelling is TERMINAL by product decision (2026-08-06): a cancelled task
 * can be neither resumed nor deleted. It stays visible in Pending as a record
 * that the work was stopped. Completed work is likewise closed for good.
 */
export function taskManageMode(task: Task): TaskManageMode {
  if (isTaskCancelled(task)) return null;
  if (task.status === "completed") return null;
  return task.status === "open" ? "delete" : "cancel";
}

/** Every list/detail key that a delete, cancel or resume can invalidate. */
function invalidateAllTaskKeys(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of [
    "my-tasks",
    "tasks-assigned-by-me",
    "tasks-awaiting-approval",
    "supervising-tasks",
    "institution-tasks",
    "task-detail",
    "task-group-detail",
  ]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/** Permanently removes the task. Children cascade; the RPC refuses if work started. */
export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      applyToGroup = false,
    }: {
      taskId: string;
      applyToGroup?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("delete_task", {
        p_task_id: taskId,
        p_apply_to_group: applyToGroup,
      });
      if (error) throw error;
      const result = data as unknown as { deleted: number };
      return result;
    },
    onSuccess: (result) => {
      invalidateAllTaskKeys(queryClient);
      sonnerToast.success(
        result.deleted > 1 ? `${result.deleted} tasks deleted` : "Task deleted",
      );
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't delete the task.", context: "deleteTask" }),
  });
}

/** Freezes the task in place. Nothing is destroyed. */
export function useCancelTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      reason,
      applyToGroup = false,
    }: {
      taskId: string;
      reason?: string;
      applyToGroup?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("cancel_task", {
        p_task_id: taskId,
        p_reason: reason?.trim() || undefined,
        p_apply_to_group: applyToGroup,
      });
      if (error) throw error;
      return data as unknown as { cancelled: number };
    },
    onSuccess: (result) => {
      invalidateAllTaskKeys(queryClient);
      sonnerToast.success(
        result.cancelled > 1
          ? `${result.cancelled} tasks cancelled. All progress is kept.`
          : "Task cancelled. All progress is kept.",
      );
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't cancel the task.", context: "cancelTask" }),
  });
}

// Hook for school admins to view ALL tasks in their institution
export function useInstitutionTasks(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-tasks", institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      if (!institutionId) return [];

      // Use left join (not !inner) so tasks without assignments still show
      const select = () =>
        supabase
          .from("tasks")
          .select(`
            *,
            task_assignments(
              *,
              assigner:profiles!task_assignments_assigner_id_fkey(full_name, email),
              assignee:profiles!task_assignments_assignee_id_fkey(full_name, email),
              supervisor:profiles!task_assignments_supervisor_id_fkey(full_name, email)
            ),
            task_evidence(*),
            task_links(*),
            task_supervisors(
              supervisor_id,
              profile:profiles!task_supervisors_supervisor_id_fkey(full_name, email)
            )
          `)
          .eq("institution_id", institutionId);

      // Two bounded reads, live and completed, instead of one window over
      // everything. The single newest-1,000 window was mostly completed rows
      // (Alliance carries ~1,550 task rows, the large majority finished), so
      // the oldest open tasks were never fetched and the Overview tab, the
      // board and every tab badge quietly understated the live work: To Do
      // read 93 on the board while task_status_counts said 117. Live rows are
      // a few hundred, so their own window holds all of them; completed rows
      // are history and keep a window of the most recently finished, ordered
      // the way the Completed tab dates them.
      const [live, completed] = await Promise.all([
        select()
          .neq("status", "completed")
          .order("created_at", { ascending: false })
          .range(...TASK_LIST_RANGE),
        select()
          .eq("status", "completed")
          .order("updated_at", { ascending: false })
          .range(...TASK_LIST_RANGE),
      ]);

      if (live.error) throw live.error;
      if (completed.error) throw completed.error;
      return [...(live.data || []), ...(completed.data || [])].map(normalizeTask);
    },
    staleTime: TASK_STALE_TIME,
  });
}
