# Coordinator task visibility: wing-scoped tasks with real names

**Status:** SHIPPED. Frontend part on `naman-erp` 2026-09-09 (merged `b4283d32`, honest "Not
visible to you" label). Database part applied to prod 2026-09-09 by Tushar:
`supabase/migrations/20260909150000_coordinator_wing_task_visibility.sql` (helper
`coordinator_covers_task`, wing SELECT policies on `tasks`, `task_assignments`, `task_comments`,
`task_evidence`, plus a supervisor SELECT policy on `tasks` that the narrowing made necessary,
since supervisors only ever saw supervised tasks through the broad role policies). **Item 4
(teachers) is now DECIDED and OPEN: NEEDS DB**, see below. Until it lands a teacher+coordinator
still reads institution-wide tasks through the teacher hat, and the Tasks page hides those rows
client-side in coordinator view (frontend follow-up at the end). Spec written by Naman's session;
contains no SQL by rule (work queue ground rule 2).

## The user-visible problem

A coordinator opens `/coordinator/tasks`, taps a task on the Overview tab, and the detail
sheet shows **Assigned By: Unknown** and **Assigned To: Unknown**. The task "Revision" in the
2026-09-09 screenshot was assigned by an admin to a class teacher in the coordinator's wing;
the coordinator is expected to follow it up and cannot see who owns it.

## Root cause (verified in the migrations, not guessed)

Two tables, two different visibility rules:

| Table | Coordinator can read | Where |
|---|---|---|
| `tasks` | every task in the institution | `20260116101514`, policy "Coordinators can view all tasks in their institution" |
| `task_assignments` | only rows where they are assigner, assignee or supervisor | `20260104113057` (participants, school admins), `20260806160000` (supervisors via `is_task_supervisor()`) |

The Overview query in `src/hooks/useTasks.ts` (`useInstitutionTasks`) embeds
`task_assignments` and its assigner/assignee profiles inside each task. For a task the
coordinator did not assign, receive or supervise, PostgREST returns the task with an empty
`task_assignments` array. `normalizeTask` then sets `assignment`, `assigner_profile` and
`assignee_profile` to null and the panel falls back to a placeholder.

Teachers have the same gap ("Teachers can view all tasks in their institution",
`20260128064058`), so a teacher opening a colleague's task sees the same placeholders.

Profiles RLS is not involved: same-institution profiles are readable.

## Second, related gap: the coordinator Overview is not wing-scoped at all

The tab is labelled "Wing" in the stat tile but the `tasks` policy gives coordinators the
whole institution. `tasks.wing_id` is NULL on every production row (noted in
`20260825122000_coordinator_duties.sql`), so the existing coordinator dashboard RPCs
(`dash_scoped_task_stats`, `dash_scoped_task_queue`) scope tasks **through the assignee**:
a task is in the coordinator's wing when its assignee is a staff member (any
`class_assignments.role` other than student) on one of the classes returned by
`dash_resolve_scoped_classes()`.

That is the scope definition the user asked for ("all the tasks relevant to his wing,
whether teacher related etc"). Reuse it; do not invent a second one.

## What Tushar needs to build (prose, no SQL)

1. **A SECURITY DEFINER helper, `STABLE`, `search_path = public`**, shaped like
   `is_task_supervisor(_user_id, _task_id)` in `20260806160000`, that answers: *is `_user_id` a
   coordinator whose wing covers this task?* True when the task's `task_assignments.assignee_id`
   is a non-student staff member on any class in the caller's wing classes (the
   `wing_assignments` x `wing_class_mappings` x active `classes` join that
   `dash_resolve_scoped_classes()` uses for the coordinator branch). Also true when the
   task's **assigner** is such a staff member, so tasks a wing teacher hands out are visible
   too. Institution must match. `REVOKE EXECUTE FROM anon` by name (CLAUDE.md §26).

2. **A SELECT policy on `task_assignments`** for `authenticated` using that helper with
   `(select auth.uid())` and `task_id`. No inline cross-table EXISTS (CLAUDE.md §23; the old
   school-admin policy on this table does inline EXISTS and should not be copied).

3. **Narrow the coordinator SELECT policy on `tasks`** from "whole institution" to the same
   helper, so the Overview stops showing tasks outside the wing. Keep the participant policy
   ("Users can view tasks they are assigned to") so a coordinator still sees tasks they
   personally assigned or received outside the wing. Keep the school-admin and super-admin
   policies untouched.

4. **Teachers. DECIDED 2026-09-09 (Naman): a teacher sees only the tasks assigned to them,
   assigned by them, or that they supervise. Nothing institution-wide.** NEEDS DB: drop the
   institution-wide teacher SELECT policy on `tasks` ("Teachers can view all tasks in their
   institution", `20260128064058`). Nothing replaces it. The participant policy ("Users can view
   tasks they are assigned to", assignee or assigner through `get_task_assignee` /
   `get_task_assigner`) and the supervisor policy added in `20260909150000` already cover exactly
   those three cases. `task_assignments`, `task_comments` and `task_evidence` carry no
   teacher-wide policy today, so they need no change.

   What it changes, checked against the frontend:
   - The teacher queries on the Tasks page (`useMyTasks`, `useTasksAssignedByMe`,
     `useTasksAwaitingApproval`, `useSupervisingTasks`) already filter on the caller through
     `task_assignments!inner` or `task_supervisors`, so teacher view loses nothing.
   - Multi-assignee groups: the assigner still reads every sibling row (they are a participant
     on each). An assignee reads only their own row, which is what `useTaskGroupDetail` documents
     and `MultiAssigneeTaskDetail` already falls back on.
   - A teacher+coordinator in coordinator view then gets wing + own + supervised straight from
     the server, and the client-side filter in `TasksPage.tsx` becomes a no-op. Leave it in: it
     is cheap and covers the interval before the policy is applied.
   - `useTaskRealtime` delivers fewer change events to teachers (RLS applies to realtime).
   - The "Not visible to you" label stops appearing except on a deep link to a task the viewer
     is not on.
   - Verify as a teacher JWT: count(tasks) equals assigned-to + assigned-by + supervised, and
     every visible task carries a visible `task_assignments` row.

5. **Also check `task_comments` and `task_evidence`.** Their SELECT policies are participant
   only (`20260112111856`, `20260806160000`). If a coordinator is meant to read the comment
   thread on a wing task, those need the same helper. The detail sheet renders "No comments
   yet" today for the same RLS reason; that is not proof of zero comments.

## Verification (prod, via `scripts/run-sql.ps1`, per `prod-operations` skill)

- `pg_policies` on `task_assignments` and `tasks` lists the new policies with the helper in
  `qual`.
- `information_schema.routine_privileges` shows no `anon` EXECUTE on the helper.
- As a coordinator JWT: `useInstitutionTasks` returns only wing tasks, each with a non-empty
  `task_assignments` embed and both profile embeds populated.
- As a teacher JWT, once item 4 is applied: every visible task has a visible `task_assignments`
  row, and the count equals assigned-to + assigned-by + supervised.

## Frontend that already landed (naman-erp, 2026-09-09)

- `src/hooks/useTasks.ts`: `taskAssignerName()` returns `HIDDEN_ASSIGNMENT_LABEL`
  ("Not visible to you") when the assignment row is absent, "SALCI System (auto-generated)"
  when the row is present with a NULL assigner, "Unknown" otherwise.
- `src/components/tms/TaskDetailPanel.tsx`: Assigned To uses the same label when the row is
  absent; the SALCI Support special case is unchanged.

Once the policies land, the label disappears for coordinators on wing tasks with no further
frontend change. No frontend code should ever try to reconstruct the names another way
(for example by calling `dash_scoped_task_queue` and joining client-side): that would be a
second source of truth for who is on a task.

## Frontend follow-up (naman-erp, 2026-09-09, after the migration landed)

The screenshot that prompted this round was taken on `salci.org/coordinator/tasks` AFTER
`20260909150000` was applied: still "Not visible to you", 174 cards in To Do. The account is
teacher+coordinator at Alliance. The teacher policy let every school task through, and
`TasksPage.tsx` never read the Teacher/Coordinator switch: it gated the Overview on the
coordinator role alone, so the chip in the app bar changed nothing on the page.

- `TasksPage.tsx` now switches on `activeViewRole` from `useActiveRole()`, with the same
  `hasDualRole`-then-view rule `AppSidebar` uses, so nav and page agree. Coordinator view: the
  Wing Overview, tiles and board keep only tasks whose `task_assignments` row is visible, which
  is exactly the set the server gives a pure coordinator (wing + own + supervised). Teacher
  view: no Overview tab, no Workforce link, participant tabs only, matching a plain teacher.
  Admins and admin+teachers are untouched (admin first; the toggle never narrows an admin).
- Copy tells the two hats apart: subtitle "Follow up on tasks across your wing, plus your own"
  against "Tasks assigned to you, assigned by you, or under your supervision"; the tab reads
  "Wing Overview"; the coordinator empty state says "in your wing".
- Sibling rows of a multi-assignee task that rendered as duplicate single cards (their people
  hidden) now collapse into one group card or drop out in coordinator view, because only fully
  visible rows remain.

For Tushar, outside Naman's remit: CLAUDE.md §25 and the `teacher-authority-scope` skill both
still call the app-bar chip an inert label. Since `0613acbe` it is the real `RoleSwitcher`
wired to `setActiveViewRole`, so the "mount your own switcher" caveat no longer applies.
