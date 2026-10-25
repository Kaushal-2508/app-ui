# Prompt: Jira-style Board view for /tasks

Paste everything below the line into Claude Code inside this repo (salci-eco-core).
It is written against the code as it stands on 2026-09-09 and ports the board that
already ships in the SALCI House LMS (harmony-ops, `src/components/lms/board/`),
translated to this project's task model. Verify every "as it stands" claim with a
targeted read before relying on it (CLAUDE.md §5).

---

# Build a Jira-style Kanban Board view for /tasks

Read CLAUDE.md first, then invoke these skills BEFORE writing code: `salci-design-system`,
`high-concurrency-patterns`, `ui-invariants`, `salci-module-notes` (tasks section).
Change files under `src/` and `docs/` only. Never touch `supabase/`, never write SQL,
never run a database command. Anything that needs a schema change gets a
`NEEDS DB: <what and why>` line in the commit message and is skipped.

## Goal

Add a **Board** view to `src/pages/TasksPage.tsx`: five status columns, drag-and-drop
between them, a compact Jira-style card, a per-card actions menu, and the existing
`TaskDetailPanel` opened from a card. The board is a second way to LOOK at the list the
active tab already produces (My Tasks / Assigned by me / Awaiting approval / Supervising
/ All Tasks, after `TaskDateFilter`). It changes no backend contract, adds no table, and
reuses every hook that exists.

## The task model here (read, do not assume)

- `Task` from `src/hooks/useTasks.ts` = `Tables<"tasks">` + `assignment`, `assigner_profile`,
  `assignee_profile`, `supervisors`, `evidence`, `links`.
- `task_status` enum: `open | in_progress | done_pending_approval | completed | rejected`.
  There is no legacy status. **Cancellation is an overlay, not a status** (`cancelled_at`;
  `isTaskCancelled()`): a cancelled task keeps the status it was frozen at, and the DB
  rejects every transition on it.
- **Multi-assignee is FAN-OUT**: one instruction for N people is N `tasks` rows sharing
  `task_group_id`, each with its OWN status (`create_task_group`, spec
  `docs/superpowers/specs/2026-08-06-multi-assignee-tasks-design.md`). `groupTasks()`
  collapses them for the grid. **On the board a column IS a status, and a group's members
  can sit in different statuses, so the board renders ONE CARD PER TASK ROW, never one per
  group.** A member card carries a small group chip ("Group · 2 of 3 done", computed from
  `groupTasks()` over the same list) so it is not mistaken for an unrelated task.
- `priority` is `number | null`. **The write side is the truth**: `CreateTaskDialog`
  and `AISuggestedTasksCard` use `1 = Low, 2 = Medium, 3 = High`. `TaskCard`,
  `TaskGroupCard`, `TaskDetailPanel` and `MultiAssigneeTaskDetail` all render
  `priority === 1` as "High Priority", which contradicts the writer. Use the writer's
  scale on the board (3 = High). Do NOT sweep the four readers in this task; report the
  discrepancy in your summary so it can be fixed deliberately.
- There is no `task_number`. Deep links use the uuid: `/tasks?task=<id>`. There is no
  "Copy key" action.
- **There is no reassign path** (no RPC, `task_assignments.task_id` is `NOT NULL UNIQUE`,
  RLS on the table). The board shows the assignee read-only via `UserAvatar`; do NOT build
  an assignee picker. If one is wanted later it is a `NEEDS DB`.
- `useUpdateTaskStatus()` is the ONLY status writer and the DB trigger
  `validate_task_state_transition` (the live trigger; older docs say `enforce_task_status_transition`) is the backstop. The trigger's body is not in this
  repo's migrations; the allowed moves are the ones the existing UI offers (mirror
  `TaskCard.tsx` lines ~55-65 and the equivalent block in `TaskDetailPanel.tsx`):

  | drop | who | from → to |
  |---|---|---|
  | In Progress | assignee | open → in_progress, rejected → in_progress |
  | In Review | assignee | in_progress → done_pending_approval (NOT for Salci Support tasks: `useSupportInstitutionId()` match) |
  | Done | assigner (and whoever `TaskDetailPanel` lets approve, e.g. school admin via `useUserRole().isSchoolAdmin`; read it, mirror it exactly) | done_pending_approval → completed |
  | Rejected | same as Done | done_pending_approval → rejected |
  | To Do | nobody | there is no way back to open; refuse |

  Every other drop is refused CLIENT-SIDE with a plain sentence and no network call. The
  server still enforces; the client just stops PostgREST's wording reaching a toast.
  If `TaskDetailPanel` collects a rejection reason before rejecting, a drop on Rejected
  must open the same prompt rather than bypass it.

## Files

```
src/lib/taskBoard.ts                               columns, labels, sort, permission text
src/components/tms/board/TaskBoardView.tsx         container: toolbar, lanes, DndContext
src/components/tms/board/BoardColumn.tsx
src/components/tms/board/BoardTaskCard.tsx
src/components/tms/board/CardActionsMenu.tsx
src/components/tms/board/TaskBoardView.test.tsx
```
Modify: `src/pages/TasksPage.tsx` (view toggle + wiring), `src/hooks/useTasks.ts`
(`useUpdateTaskStatus` becomes optimistic). `@dnd-kit/core` is already installed; use it
and nothing else for drag and drop.

## 1. src/lib/taskBoard.ts

```ts
export type BoardColumnId = "todo" | "in_progress" | "in_review" | "done" | "rejected";
export interface BoardColumnDef { id: BoardColumnId; label: string; status: TaskStatus }
export const BOARD_COLUMNS: BoardColumnDef[] = [
  { id: "todo",        label: "To Do",       status: "open" },
  { id: "in_progress", label: "In Progress", status: "in_progress" },
  { id: "in_review",   label: "In Review",   status: "done_pending_approval" },
  { id: "done",        label: "Done",        status: "completed" },
  { id: "rejected",    label: "Rejected",    status: "rejected" },
];
export const PRIORITY_META: Record<number, { label: string; rank: number }> = {
  3: { label: "High", rank: 0 }, 2: { label: "Medium", rank: 1 }, 1: { label: "Low", rank: 2 },
};  // null priority sorts with Medium
export type BoardSortKey = "priority" | "newest";
export const BOARD_SORTS = [
  { value: "priority", label: "Highest priority first" },
  { value: "newest",   label: "Newest first" },
];
// priority: rank asc, then due_date asc with nulls LAST, then created_at asc
// newest:   created_at desc, tie-broken by id so two rows created in the same
//           second (a create_task_group fan-out) never reorder between renders
export function taskComparator(key: BoardSortKey): (a: Task, b: Task) => number

/** The one place a drag is judged. Returns null when allowed, else the sentence to toast. */
export function dropRefusal(task: Task, target: TaskStatus, ctx: {
  userId: string | undefined; canApprove: boolean; isSupportTask: boolean;
}): string | null
export const TASK_MOVE_DENIED    = "Only the person this task is assigned to can move it.";
export const TASK_APPROVE_DENIED = "Only the task assigner or a school admin can approve or reject a task.";
export const TASK_CANCELLED      = "This task is paused. Nothing can be changed until it is resumed.";
export const TASK_BAD_TRANSITION = "A task cannot move from {from} to {to}.";  // fill with column labels
export function taskDeepLink(id: string) { return `${window.location.origin}/tasks?task=${id}`; }
```
No em-dashes anywhere in these strings (CLAUDE.md UI rules).

## 2. TaskBoardView.tsx

Props: `{ tasks: Task[]; isLoading: boolean; error: unknown; onOpen: (sel: TaskSelection) => void }`.
The PAGE owns fetching, tabs and the date filter; the board only arranges.
**Render the error state BEFORE the empty state** (CLAUDE.md §6): a failed list must not
show five empty columns.

**Toolbar** (`flex flex-wrap gap-2`): search Input ("Search cards", matches title,
description, assignee name, assigner name); Group-by Select (`none | assignee | type |
priority`, session state); Sort Select (`BOARD_SORTS`, PERSISTED in localStorage
`salci.tasks.board-sort`, default `priority` — reading order is a standing preference,
search and grouping are not).

**Lanes** (`useMemo`): `assignee` → one lane per `assignee_profile.full_name` (sorted),
trailing "Unassigned" only if non-empty; `type` → one lane per `task_type` in enum order
using `TaskTypeBadge`'s labels; `priority` → High / Medium / Low (null → Medium).

**Layout**
- `groupBy === "none"`: `flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory` with one
  `<BoardColumn>` per column, class
  `snap-start shrink-0 w-[80vw] max-w-[300px] sm:w-auto sm:max-w-none sm:min-w-[240px] sm:flex-1`
  (phone: one column per swipe; desktop: five equal columns), `scrollBody`.
- grouped: shared header row `grid grid-cols-[repeat(5,minmax(250px,1fr))] gap-3` with
  label + count, then per lane a collapsible ghost Button (`aria-expanded`, chevron,
  `UserAvatar` when grouping by assignee, count) over a 5-cell grid of
  `<BoardColumn showHeader={false} droppableId={`${lane.key}::${col.id}`}>`.
  Collapsed keys in a `Set`. Nothing matches → `EmptyState` from `shared/surfaces`.
- Loading: five `<Skeleton className="h-72 w-[260px] shrink-0 rounded-2xl" />`.

**Drag and drop**
```ts
const sensors = useSensors(
  useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
);
```
- `onDragStart`: `suppressClickRef.current = true; setActiveTask(active.data.current.task)`.
- `onDragEnd` and `onDragCancel`: `setActiveTask(null)`, then release the ref in
  `setTimeout(..., 150)` — the browser fires a click right after the drop and it must not
  open the detail panel.
- `onDragEnd` order: (1) resolve task and `over.data.current.status`, bail if missing;
  (2) **no-op if `task.status === target`** (dropped back where it lives);
  (3) `const why = dropRefusal(...)`; if set, `toastWarning(why)` and return;
  (4) `updateStatus.mutate({ taskId, status: target })` — errors route through the hook's
  own `onError`, which must use `toastError(err, { fallback, context })` (§19).
- `<DragOverlay dropAnimation={null}>{activeTask && <BoardCardContent task={activeTask} isOverlay />}</DragOverlay>`.

**The detail panel is NOT rendered by the board or by a card.** `TasksPage` already holds
`selection` + `detailOpen` and renders ONE `<TaskDetailPanel>` at page level; the board
only calls `onOpen({ taskId: task.id, groupId: null })` (a board card is one person's
row, so it opens the single-task view; the group chip's title names the group). Keep it
that way for a structural reason: a card lives in exactly one status column, so a status
change unmounts it, and a Radix Sheet/Dialog torn down that way leaves
`pointer-events: none` stuck on `<body>` and freezes the page until reload. This bit the
LMS board and is the regression the test below guards.

## 3. BoardColumn.tsx

Props: `column, tasks, droppableId, suppressClickRef, onOpen, groupMeta, sortBy,
showHeader = true, scrollBody = false, canCreate, className`.
- `useDroppable({ id: droppableId, data: { status: column.status } })`.
- Wrapper `flex flex-col rounded-2xl bg-muted/50 transition-colors`, plus
  `ring-2 ring-primary/50 bg-primary/5` while `isOver`.
- Header: uppercase `text-xs font-semibold tracking-wide text-muted-foreground` label,
  tabular count. **Only the To Do column gets a "+"** (opens `CreateTaskDialog`; a task
  is always born `open`, so seeding another column's status is not possible here), and
  only when the page's `canAssignTasks` is true.
- Body: `setNodeRef`, `space-y-2 px-2 pb-2 min-h-[60px]`, and when `scrollBody`
  `overflow-y-auto max-h-[calc(100dvh-320px)]`. Sort with `taskComparator(sortBy)`.

## 4. BoardTaskCard.tsx (two exports)

`BoardCardContent({ task, isOverlay, groupMeta, interactive })` — pure presentation,
also used by the DragOverlay with `interactive = false` so the overlay carries no menu:
- `<Card className="group/card relative px-3 py-2.5 space-y-2.5 rounded-xl">`; overlay
  adds `shadow-lg rotate-1`, otherwise `shadow-sm hover:shadow-md`. Cancelled → `opacity-75`.
- Row 1: title `text-sm leading-snug line-clamp-3 pr-7`; top-right absolute
  `<CardActionsMenu>` — `opacity-100 md:opacity-0 group-hover/card:opacity-100
  focus-within:opacity-100` (always visible on touch, hover-revealed on desktop).
- Overdue chip only when `due_date` is past and status is not `completed` and not
  cancelled: `bg-destructive/10 text-destructive`, Clock icon + `format(due, "d MMM")`.
- Cancelled chip: "Paused" (reuse `TaskStatusBadge cancelled` if it fits, otherwise a
  neutral Badge).
- Row 2 left (`min-w-0 overflow-hidden`): `<TaskTypeBadge>`; group chip when
  `task.task_group_id` and `groupMeta` (Users icon, "2/3", `title="Group task: 2 of 3 done"`);
  evidence count chip when `task.evidence?.length`; supervisor Eye icon with
  `aria-label` when `supervisors.length`.
- Row 2 right (`shrink-0`): priority icon — `ChevronUp text-destructive` High,
  `Minus text-muted-foreground` Medium/null, `ChevronDown text-muted-foreground` Low, each
  with `aria-label` — then `<UserAvatar name email className="h-6 w-6">` for the
  assignee, or a muted `CircleUserRound` when `assignee_profile` is hidden by RLS.
- Colours only from tokens. Do NOT copy `TaskStatusBadge`'s `bg-blue-100`-style classes
  onto the board.

`BoardTaskCard({ task, suppressClickRef, groupMeta, onOpen })`:
```tsx
const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
  id: task.id, data: { task }, disabled: isTaskCancelled(task),   // frozen rows do not drag
});
<div ref={setNodeRef} {...attributes} {...listeners}
  style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
  className={cn("touch-manipulation rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    isTaskCancelled(task) ? "cursor-default" : "cursor-grab active:cursor-grabbing",
    isDragging && "opacity-40")}
  onClick={() => { if (suppressClickRef.current) return; onOpen({ taskId: task.id, groupId: null }); }}>
  <BoardCardContent task={task} groupMeta={groupMeta} interactive />
</div>
```
(`style` here is the dnd-kit transform, the one inline style the design rules tolerate;
everything else is classes.)

## 5. CardActionsMenu.tsx

Ghost icon Button (`MoreHorizontal`, `aria-label="More actions"`). **Stop propagation on
`onPointerDown` AND `onClick` of the trigger, the menu content and any confirm dialog** —
otherwise dnd-kit starts a drag or the card click opens the panel.
Items, in order, and only the ones that apply:
- `Change status ▸` submenu listing ONLY the moves `dropRefusal` allows for this user and
  this task (an empty submenu is hidden, not disabled); tick on the current status.
- `Copy link` (`taskDeepLink(task.id)`, clipboard, `toastSuccess` / `toastError`).
- `Delete` or `Cancel` per `taskManageMode(task)` and `canManageTask(...)` — reuse
  `TaskManageActions`' confirm copy and mutations (`useDeleteTask` / `useCancelTask`)
  rather than a second implementation. If `TaskManageActions` cannot be embedded, render
  it inside the menu's confirm step; do not fork its wording.

## 6. useUpdateTaskStatus becomes optimistic (src/hooks/useTasks.ts)

Keep `mutationFn` (the update and the `notifications` inserts) as is. Add:
```ts
onMutate: async ({ taskId, status }) => {
  const keys = ["my-tasks","tasks-assigned-by-me","tasks-awaiting-approval","supervising-tasks","institution-tasks"];
  await Promise.all(keys.map(k => queryClient.cancelQueries({ queryKey: [k] })));
  const snapshots = keys.flatMap(k => queryClient.getQueriesData<Task[]>({ queryKey: [k] }));
  const patch = (old?: Task[]) => old?.map(t => t.id === taskId ? { ...t, status } : t);
  keys.forEach(k => queryClient.setQueriesData<Task[]>({ queryKey: [k] }, patch));
  return { snapshots };
},
onError: (err, _vars, ctx) => {
  ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
  toastError(err, { fallback: "Could not update the task", context: "useUpdateTaskStatus" });
},
onSettled: () => { /* the existing invalidations, plus "task-detail" and "task-group-detail" */ },
```
Patch and roll back by PREFIX (`getQueriesData` / `setQueriesData`), never one exact key —
`useInstitutionTasks` embeds the institution id in its key, so several variants can be
cached. The existing `useToast` success toast may stay; the error path must go through
`toastError` (§19, hard rule). No `any`; type the snapshot tuple from `getQueriesData`.
`useTaskRealtime` keeps invalidating on the server echo; that is compatible with the
optimistic patch.

## 7. TasksPage.tsx wiring

- View mode `"cards" | "board"` in localStorage `salci.tasks.view` (default `cards`).
  A `ToggleGroup` beside `TaskDateFilter` in the header actions: `LayoutGrid`
  "Cards", `SquareKanban` "Board", both `aria-label`ed, 44px targets.
- In board mode each `MobileTabs` panel renders
  `<TaskBoardView tasks={dateScopedListForThatTab} isLoading error onOpen={setSelectionAndOpen} />`
  in place of `TaskCollectionGrid`. The tabs stay: they choose WHICH tasks, the board
  shows WHERE they are. On the two status-scoped tabs (Awaiting approval, Completed) the
  board will be mostly one column; that is honest, do not special-case it.
- Deep link: on mount, if `?task=<uuid>` is present, set `selection = { taskId, groupId: null }`
  and open the panel; closing removes the param and keeps the rest of the query string.
- Pass `canAssignTasks` down so the "+" respects the same rule as the FAB.

## 8. Design and accessibility (salci-design-system checklist applies in full)

shadcn primitives only; tokens only (`bg-card`, `bg-muted`, `text-muted-foreground`,
`text-primary`, `text-destructive`); spacing on the 4/8/12/16/24 scale; no inline styles
except dnd-kit's transform; responsive to 375px; skeleton on load; `EmptyState` on empty;
error state first; `toastError` for every failure; no em-dashes in user-facing text;
every icon-only control has an `aria-label`; never colour as the only signal (priority =
icon + label, overdue = icon + date, paused = text). Light and dark both checked.
If you add any Dialog, remember `DialogContent` auto-wraps children in a ScrollArea
(ui-invariants §1): pass plain children, set only `sm:max-w-*`.

## 9. Tests (vitest + @testing-library, `src/components/tms/board/TaskBoardView.test.tsx`)

1. **The panel survives a status change.** Render `TasksPage`-equivalent harness: board +
   one page-level detail panel driven by `selection`. Click a card in To Do → panel open.
   Re-render with the same task now `in_progress`. Assert the panel is STILL open and the
   card now sits under "In Progress". (Mock `useTaskDetail`, `useUpdateTaskStatus`,
   `useCurrentUser`, `useUserRole`, `useSupportInstitutionId`.)
2. A cancelled task renders with "Paused" and `useDraggable` receives `disabled: true`.
3. `dropRefusal`: assignee open→in_progress allowed; assignee open→completed refused with
   `TASK_BAD_TRANSITION`; assigner done_pending_approval→completed allowed; a non-party
   any move refused with `TASK_MOVE_DENIED`; anything on a cancelled task → `TASK_CANCELLED`;
   support task in_progress→done_pending_approval refused.
4. Two rows sharing `task_group_id` each get their own card and both carry the group chip.
5. Sort preference survives a remount (localStorage).

## 10. Definition of done

- `npm run typecheck` → 0 errors; `npx eslint <touched paths>` → 0 errors (no `any`, no
  `eslint-disable`); `npx vite build` → exit 0; the tests above green.
- Mouse drag on desktop and long-press (200 ms) drag on a 375px viewport both move a card;
  the move survives a reload; dropping a card on its own column writes nothing; every
  refused drop produces one plain-sentence toast and NO network request.
- Opening a task from the board, changing its status from the panel, and closing the
  panel leaves the page fully clickable.
- `@dnd-kit` is imported only by the three board components.
- Your summary lists: the priority-scale contradiction (writer 3 = High vs readers
  1 = High) with the four files, and any `NEEDS DB` you hit (a reassign path is the
  obvious one). Commit message ends with the attribution line from CLAUDE.md.
