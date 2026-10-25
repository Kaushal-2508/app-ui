# Multi-assignee tasks — design

**Date:** 2026-08-06
**Area:** Task Management System (`src/components/tms/`, `src/hooks/useTasks.ts`, `tasks` / `task_assignments`)

## Problem

"Assign New Task" allows exactly one assignee. Users want to assign one instruction to several
people at once, give each person their own title and description where the work differs, and then
track everyone's progress from a single place.

## Requirements

1. A `+` control in the Assign To section adds another assignee dropdown.
2. Once a second assignee exists, each row exposes a per-person editor with its own **title** and
   **description**. Left blank, the person inherits the main title and description.
3. An assignee sees a normal task with the normal workflow. They never see their teammates' rows.
4. The creator opens the task and sees every assignee with their individual progress. A
   single-assignee task keeps the current detail window unchanged.
5. In the creator's list, the group collapses into one card.

## Data model — fan-out with a group key

### Why not one task with many assignments

The obvious shape (1 `tasks` row, N `task_assignments` rows) is blocked by the existing schema:

- `task_assignments.task_id` is `NOT NULL UNIQUE` — one assignment per task, by construction.
- `get_task_assignee(_task_id)` returns a single `UUID` and is referenced by **six RLS policies**
  across `tasks`, `task_evidence` and `task_comments`, plus the `enforce_task_status_transition`
  trigger ("Only the assignee can start a task" / "…submit task for approval").
- `tasks.status` is a single column, so one shared row cannot express per-person progress.

Adopting it means dropping the constraint, rewriting the security core of the module, and *still*
adding a per-assignee status column. It buys nothing the fan-out does not already give.

### Chosen shape

**One `tasks` row per assignee**, linked by a new nullable `tasks.task_group_id`.

| Requirement | How the fan-out satisfies it |
|---|---|
| Per-assignee title / description | Each row already owns `title` and `description` |
| Assignee sees a normal task | The row *is* a normal task; existing RLS hides siblings |
| Creator sees everyone's progress | Sibling rows fetched by `task_group_id` |

```sql
ALTER TABLE public.tasks ADD COLUMN task_group_id UUID;
CREATE INDEX idx_tasks_task_group_id ON public.tasks (task_group_id)
  WHERE task_group_id IS NOT NULL;
```

`NULL` means single-assignee — every task that exists today is untouched. A group id is stamped
**only when there is more than one assignee**, so the single-assignee path never changes shape.

### `create_task_group` RPC

All inserts go through one `SECURITY DEFINER` RPC rather than a client-side loop:

- §23 / enterprise rule 6: two or more dependent writes are one RPC, never sequential client calls.
  A three-person assignment would otherwise be nine round trips.
- Assignment becomes all-or-nothing. A partial failure can never leave two of three people assigned.

Because `SECURITY DEFINER` bypasses RLS, the function re-checks what the `INSERT` policy checks:
caller is authenticated, `p_institution_id = get_user_institution(auth.uid())`, and the caller holds
`school_admin`, `coordinator` or `teacher`. It additionally rejects self-assignment (mirroring the
`no_self_assignment` CHECK), duplicate assignees, an empty list, and more than 200 assignees.

The 200 ceiling is sized from real data: the largest institution on prod has **94** assignable
members (Alliance), so it is headroom rather than a limit anyone meets. `MAX_GROUP_ASSIGNEES` in
`useTasks.ts` must stay equal to it, since it also bounds `useTaskGroupDetail`'s `.range()`.

### Assign to everyone (admins only)

The Assign To dropdown carries a pinned **"Assign to everyone (N people)"** option, rendered only
when `useUserRole()` reports `isSchoolAdmin || isSuperAdmin`. Coordinators and teachers keep the
one-at-a-time picker; the option simply does not exist for them. Choosing it expands into one row
per member (keyed by member id) rather than setting a hidden "all" flag, so the admin can still
remove someone or give an individual their own title and description. Per-person text already typed
survives the expansion. A **Clear all** link next to the count undoes it.

**Grant gotcha.** Supabase's `ALTER DEFAULT PRIVILEGES` grants `EXECUTE` to `anon` on every new
function in `public`, and `REVOKE ... FROM PUBLIC` does **not** remove that explicit role grant. The
first apply left `anon=EXECUTE` on a `SECURITY DEFINER` function. The migration now revokes from
`anon` by name. Any future `SECURITY DEFINER` RPC must do the same and verify with
`information_schema.routine_privileges`.

Signature:

```
create_task_group(
  p_institution_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_task_type task_type,
  p_priority INTEGER,
  p_due_date TIMESTAMPTZ,
  p_supervisor_id UUID,
  p_assignees JSONB   -- [{ assignee_id, title, description }]
) RETURNS TABLE (task_id UUID, assignee_id UUID, task_group_id UUID)
```

Per assignee it writes one `tasks` row (`COALESCE(override, main)` for title and description), one
`task_assignments` row, and one `task_assigned` notification. The supervisor, if any, gets a single
notification for the whole group.

## Create dialog

> **Superseded 2026-09-28 (Naman, frontend only).** The row-per-person layout below and the
> per-person title/description editor are gone from the dialog. Assign To is now one
> `SearchableMultiSelect` (`src/components/ui/searchable-multi-select.tsx`): a searchable list with
> a round tick per person that stays open while people are ticked, the admin-only "Assign to
> everyone" row pinned at the top, the already-ticked people listed first under "Selected" on every
> reopen, and the names in the trigger ("Ishu Pathania and 5 more"). Tag Supervisors uses the same
> control. Every assignee now gets the main title and description; `create_task_group` still
> accepts per-assignee overrides and `useCreateTaskGroup` still forwards them, the dialog just no
> longer offers them (`AssigneesField.tsx`, `SupervisorsField.tsx`). Everything below this note
> describes the 2026-08-06 build for the record.

Assign To becomes a list of rows. Row one is today's dropdown; `+ Add another assignee` sits below.

```
Assign To *
┌────────────────────────────────┬───┬───┐
│ Teacher2                     ⌄ │ ✎ │ × │
└────────────────────────────────┴───┴───┘
┌────────────────────────────────┬───┬───┐
│ Salci Coordinator            ⌄ │ ✎ │ × │   ← Custom
└────────────────────────────────┴───┴───┘
   ┌──────────────────────────────────────┐
   │ Title for Salci Coordinator          │
   │ Description for this person          │
   │ Leave blank to use the main task     │
   └──────────────────────────────────────┘
+ Add another assignee
```

- The pencil toggle and the `×` remove control appear only once a second row exists. With one
  assignee the dialog is visually identical to today.
- A row with a non-empty override shows a **Custom** chip.
- Removing a row discards its override.
- Already-selected people are filtered out of the other dropdowns and out of the supervisor list.
- Shared across the group: task type, priority, due date, supervisor. Per person: title,
  description. Nothing else.
- Submit is single-flight on `isPending`.

## Assignee experience

Unchanged. One task carrying their title and description, and the normal
`open → in_progress → evidence → done_pending_approval → completed` flow.

> **Corrected 2026-08-06 after a bug report.** The original design assumed RLS would give assignees
> a sibling count of 1 and therefore the single-task window "for free". **That was wrong.** Prod has
> policies absent from the migration this design was read from:
>
> ```
> tasks | SELECT | "Teachers can view all tasks in their institution"
> tasks | SELECT | "Coordinators can view all tasks in their institution"
> ```
>
> while `task_assignments` SELECT remains participant-only plus school admins. So an assignee reads
> **every sibling `tasks` row but only their own `task_assignments` row**. Measured on a real prod
> group: assignee sees `2 tasks / 1 assignment`; assigner sees `2 / 2`.
>
> The consequences were: assignees got the grouped window; teammates rendered as **"Unknown"**; and
> `taskAssignerName` read the missing assignment as "no assigner" and printed **"SALCI System
> (auto-generated)"** on a human-assigned task.
>
> **The view is now chosen explicitly, not inferred from RLS:**
> 1. Viewer is an assignee of any member → the single-task window on **their own** row, full normal
>    workflow. Reading one's own assignment row is always permitted, so this test is reliable.
> 2. Otherwise, grouped window only if every member's `assignment` **and** `assignee_profile` are
>    readable. Incomplete data falls back to the single window rather than rendering "Unknown".
> 3. `groupTasks` applies the same completeness rule, so list cards and the detail window agree.
>    This also prevents a coordinator's Overview tab collapsing tasks into a group of unnamed people.
>
> `taskAssignerName` now only claims "auto-generated" when an assignment row is genuinely visible
> and its `assigner_id` is null.

## Creator's list — grouped card

List results are grouped by `task_group_id` in the client (the rows are already fetched; this is
presentation, not aggregation-by-fetching). A group of more than one renders a single card:

- main title (the group's shared title, falling back to the earliest row's title)
- a `N assignees` badge
- a roll-up: `1 done · 1 in progress · 1 open`
- group status = the **least-advanced** member, so the card reads honestly rather than optimistically

Stat counters treat a group as one item of work.

## Creator's detail — new window

`TaskDetailPanel` branches: a non-null `task_group_id` **and** more than one visible sibling renders
`MultiAssigneeTaskDetail`; anything else renders today's window untouched.

```
Task Details                                    ✕
─────────────────────────────────────────────────
Prepare Term 2 report              [In Progress]
Exam · High Priority
Progress ▓▓▓▓▓▓░░░░░░░░░░░  1 of 3 completed
Due Jun 4, 2026 · Assigned by Salci Admin
─────────────────────────────────────────────────
▸ Teacher2 — Draft the analysis        [Open]
▾ Salci Coordinator — Collect marks    [Done ⏳]
     Description · Evidence (2) · Comments (1)
     [ Mark as Completed ]  [ Request Rework ]
▸ Principal — Prepare Term 2 report    [Open]
```

Each assignee is a collapsed row (name, their title, status badge). Expanding reveals their
description, evidence, comments and the Approve / Request Rework actions **for that person's row
only**. Collapsed-by-default keeps three or more people readable at 375px.

**Why a row often has no buttons.** The prod trigger is `validate_task_state_transition` (not
`enforce_task_status_transition` as the original migration named it). Rule 3 lets the assigner move
a task to `completed` **only** from `done_pending_approval`, and rule 4 likewise for `rejected`. So
the creator genuinely cannot complete a task nobody has submitted; that is a database rule, not a
missing button. Showing an empty row read as broken, so each row now states why it is waiting.

**Evidence does not advance the status.** Submitting evidence leaves the task at `in_progress`; the
assignee must additionally press "Mark as Done" (`in_progress → done_pending_approval`, which the
trigger also gates on evidence existing). Reported as a bug: an admin saw the assignee's evidence
listed but the hint still said "working on it", which read as a broken approval. The hint is now
evidence-aware and names the exact missing step: *"Teacher2 has attached evidence but hasn't
pressed Mark as Done yet. Approval unlocks the moment they do."*

## Deleting and cancelling (added 2026-08-06)

Two escape hatches for the task's creator or a school admin, chosen by whether work has started:

| State | Action | Why |
|---|---|---|
| `open`, untouched | **Delete** | Nothing of value exists. The row goes, children cascade. |
| Started (`in_progress` / `done_pending_approval` / `rejected`) | **Cancel** | Real work exists, so nothing is destroyed. |
| Cancelled | none | Terminal. See below. |
| `completed` | none | The state trigger already forbids touching completed work. |

**Cancelling is terminal** (decided 2026-08-06 after Resume and Delete shipped on cancelled tasks
and were rejected on sight). A cancelled task can be neither resumed nor deleted: it stays in
Pending as the permanent record that the work was stopped, and restarting means assigning a new
task. Enforced on both sides — there is no `resume_task` function, and `delete_task` refuses any
row that is not `status = 'open' AND cancelled_at IS NULL`, so the capability is not reachable by
API either. The known cost is that a cancelled task can never be cleared from the Pending tab.

**Cancellation is an overlay, not a `task_status` value.** `tasks.cancelled_at` / `cancelled_by` /
`cancel_reason` are added; the task keeps the status it was frozen at. That makes "all the progress
is saved" literal — resume restores the exact state instead of reconstructing it — and avoids
adding an enum value that `validate_task_state_transition`, the dashboard RPCs and every exhaustive
frontend switch would have to learn (`ALTER TYPE ... ADD VALUE` also cannot be used in the
transaction that adds it).

**"Everything is paused" is enforced in the database, not just hidden in the UI:**
* `validate_task_state_transition` rejects any status change while `cancelled_at` is set. The
  trigger is `BEFORE UPDATE OF status ... WHEN (old.status IS DISTINCT FROM new.status)`, so it
  never fires on the cancel/resume writes themselves.
* A new `block_evidence_on_cancelled_task` BEFORE INSERT trigger on `task_evidence` rejects new
  evidence.

Two SECURITY DEFINER RPCs (`delete_task`, `cancel_task`) share the `can_manage_task` helper: the
assigner, a school admin of that institution, or a super admin. Auto-generated tasks have
`assigner_id` NULL, so only admins qualify. Each takes `p_apply_to_group` so the grouped detail can
act on one person or on everyone. `delete_task` refuses outright if any targeted row has started or
been cancelled. In the grouped detail the whole-task control disappears once every member is
cancelled or completed, because no group action remains.

Cancelled tasks leave the Open / In Progress / active lists (they are not in flight) and surface in
**Pending**, badged **Cancelled**, which is where a decision is owed.

### Verified on prod (self-rolling-back probes)

| Case | Result |
|---|---|
| delete an OPEN task | deleted, 0 rows left |
| delete a STARTED task | refused: "Cancel it instead of deleting it." |
| cancel a started task | `status=in_progress` **unchanged**, evidence kept, assignee notified |
| status change while cancelled | refused by the trigger |
| add evidence while cancelled | refused by the trigger |
| delete a CANCELLED task | refused (cancelling is terminal) |
| `resume_task` exists on prod | no, dropped |
| cancel whole group | 2 of 2 |
| plain teacher (assignee) delete / cancel / resume | all three refused |
| school admin who is not the assigner | allowed |

**Probe gotcha worth remembering:** `set_config(..., is_local => true)` is *subtransaction* scoped.
A nested block that raises and is caught reverts the JWT claim, so a later case silently runs as the
previous identity. Take 1 of the permission probe reported false passes for exactly this reason.
Set the identity as the first statement of every case, and give each case its own fresh row.

## Multiple supervisors (added 2026-08-06)

`task_assignments.supervisor_id` is a single column, so a task could only ever be observed by one
person. Supervisors move to their own **`task_supervisors`** table (`task_id`, `supervisor_id`,
unique together, both FKs indexed, `ON DELETE CASCADE` on both).

The legacy column is **kept and kept in sync** with the first supervisor. Supervisors are only set
at creation, so the two cannot drift, and anything still reading the column keeps working. A
`mirror_assignment_supervisor` AFTER INSERT/UPDATE trigger copies any legacy write into the new
table, so paths that still use `useCreateTask` (`BulkAssignTaskDialog`, `AISuggestedTasksCard`)
cannot silently produce a supervisor who never appears in their own Supervising tab.

`is_task_supervisor(user, task)` already existed and is the choke point: it now checks the new table
**and** the legacy column, so every consumer became multi-supervisor aware without further change.
The two `task_comments` policies moved off an inline `ta.supervisor_id` comparison (which saw only
the single legacy supervisor, and inlined a cross-table EXISTS against §23) onto that helper, with
semantics otherwise preserved exactly.

**Fixes a pre-existing dead end.** `task_assignments` had no SELECT policy for supervisors, so
`useSupervisingTasks` inner-joined against rows the supervisor could not read and always returned
nothing — which is why the Supervising tab has been showing 0. A policy keyed on
`is_task_supervisor` now grants exactly that read.

`create_task_group` takes `p_supervisor_ids UUID[]` (cap 50). **Both supervisor parameters are
optional and trailing, so the previously deployed frontend — which sends `p_supervisor_id` — keeps
working against the same function.** PostgREST resolves RPCs by parameter name, so the reordering is
invisible to callers and the rollout needs no downtime. Verified by calling the exact old named-arg
shape after the migration.

`useSupervisingTasks` deliberately does two queries (ids from `task_supervisors`, then the tasks)
rather than filtering an embedded `task_supervisors!inner`: the filter would also trim the embed to
just the current user, hiding a task's other supervisors from the card. Bounded at 200 because the
ids go into an `in(...)` URL filter.

### Verified on prod

| Case | Result |
|---|---|
| backfill of existing supervisors | 211 of 211, **0 unmatched** |
| deployed frontend's old call shape | still works, legacy column still set |
| two supervisors | 2 rows written, reported 2 |
| 2nd supervisor reads the assignment | yes, Supervising tab now functional |
| legacy `INSERT` path | mirrored into `task_supervisors`, `is_task_supervisor` true |
| supervisor also an assignee | rejected |
| anon grants on task RPCs | none |

## Files

| File | Change |
|---|---|
| `supabase/migrations/20260806120000_task_groups.sql` | new — column, index, `create_task_group` RPC |
| `src/integrations/supabase/types.ts` | regenerated from prod after the migration applied |
| `src/hooks/useTasks.ts` | `useCreateTaskGroup`, `useTaskGroupDetail`, `groupTasks` / `countTaskEntries`, `staleTime` + `.range()` on touched queries |
| `src/hooks/useTaskRealtime.ts` | invalidate `task-group-detail` on task / assignment / evidence changes |
| `src/components/tms/CreateTaskDialog.tsx` | assignee rows, `+` control, per-person overrides |
| `src/components/tms/AssigneeRowsField.tsx` | new — the repeating Assign To row + override editor |
| `src/components/tms/assigneeRow.ts` | new — the row model, split out so the field file only exports a component |
| `src/components/tms/MultiAssigneeTaskDetail.tsx` | new — grouped detail window |
| `src/components/tms/TaskGroupCard.tsx` | new — collapsed list card |
| `src/components/tms/TaskDetailPanel.tsx` | branch to the grouped window |
| `src/components/tms/TaskCollectionGrid.tsx` | new — groups a `Task[]` and renders cards |
| `src/pages/TasksPage.tsx` | render through `TaskCollectionGrid`, carry `groupId` into the detail panel |

## Scale gate

1. **Pagination** — `.range(0, 499)` added to the list queries this change touches, and
   `useTaskGroupDetail` is bounded by the 25-assignee cap enforced in the RPC. *pass*
2. **Server-side aggregation** — the group roll-up counts rows the list already fetched for display;
   no extra fetch exists to be counted. *pass*
3. **Explicit `staleTime`** — 60_000 on every query touched or added. *pass*
4. **No `select("*")`** — pre-existing `*` in `TASK_JOIN_SELECT` is unchanged and out of scope; no new
   `select("*")` is introduced. *na (pre-existing)*
5. **Idempotent mutations** — one RPC in one transaction, submit gated on `isPending`. *pass*
6. **Dependent writes in one transaction** — that is the entire reason for the RPC. *pass*
7. **FK indexes / RLS helpers** — `task_group_id` is not an FK but is a lookup key, so it gets a
   partial index in the same migration. No RLS policy is added or changed. *pass*
8. **Errors surfaced** — `toastError` on the mutation; the detail panel renders its error state
   before its empty state. *pass*
9. **No JWT-less `getUser()`** — new code reads identity from `useCurrentUser`. *pass*
10. **No sub-30s polling** — none added; realtime continues through the existing
    `useTaskRealtime` channel. *pass*

## Applied and verified on prod (2026-08-06)

Migration applied to `gyymkgohcijeksmrzuyw` via the Management API SQL endpoint
(`scripts/run-sql.ps1`), since the migration ledger is not maintained.

* Column `uuid`, nullable; partial index `idx_tasks_task_group_id ... WHERE task_group_id IS NOT NULL`.
* Function is `SECURITY DEFINER` with `search_path=public`; grants are
  `authenticated, postgres, service_role` (anon revoked, see the grant gotcha above).
* Functional probe as a real `school_admin`: 2 assignees produced 2 tasks + 2 assignments +
  2 notifications; assignee 1 inherited the main title and description, assignee 2 used its
  override. Rolled back via a nested `EXCEPTION` block, leaving zero residue (`tasks` still 748).
* Guard matrix, all rejected with translated messages: self-assignment, duplicate assignee,
  cross-institution, supervisor-is-assignee, empty list, >25 assignees, blank title,
  unauthenticated caller. A **single** assignee leaves `task_group_id` NULL, so pre-existing
  behaviour is unchanged.

Verification note: the Management API returns an **empty body** when a statement errors, so probes
must catch their own exception and return the message as a row rather than relying on `RAISE`.

## Out of scope

- Editing assignees or per-person overrides after creation.
- `BulkAssignTaskDialog` keeps its existing per-person loop.
- Per-assignee due date, priority or supervisor.

## Pre-existing issue found, deliberately not fixed

There is **no supervisor SELECT policy on `tasks`** — only assignee, assigner, `school_admin` and
`super_admin`. `useSupervisingTasks` therefore returns nothing for a user who is only a supervisor.
This predates the feature and is unrelated to it; fixing it means an RLS change that deserves its
own review.
