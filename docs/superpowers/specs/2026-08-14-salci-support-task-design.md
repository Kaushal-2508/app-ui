# Salci Support as a Task — Design

**Date:** 2026-08-14
**Status:** Approved design, pending implementation plan
**Touches:** `tasks`, `task_assignments`, `reported_issues`, `institutions`, `notifications`, RLS on `tasks`, `src/components/issues/`, `src/pages/TasksPage.tsx`, `src/components/layout/AppSidebar.tsx`, `src/components/tms/TaskDetailPanel.tsx`, `src/App.tsx`

---

## 1. Goal

The sidebar footer entry (renamed from "Report Issue" to "Salci Support") and the new Tasks page header chip currently open `ReportIssueDialog`, which inserts a row into `reported_issues`. That row lands in an admin triage screen at `/admin/issues` and is invisible to the reporter afterwards.

The new behaviour:

1. Submitting a support request **creates a real `tasks` row** assigned to the SALCI support owner (today bhanu@salci.in).
2. The ticket **appears in the Tasks tab** for both parties.
3. **Only the SALCI support owner can complete it.** The reporter must not be able to close their own ticket.
4. The ticket is **private** to the reporter and SALCI. The reporter's own school admin and colleagues must not see it.

## 2. Why this is not a form redesign

Verified against the production catalog (project `gyymkgohcijeksmrzuyw`) rather than the on-disk migrations, which are stale. Proof of staleness: prod's `task_type` enum has five labels including `general`, but no migration in `supabase/migrations/` creates the fifth.

| # | Constraint | Evidence |
|---|---|---|
| 1 | A client can only create a task inside its own institution | `tasks` INSERT policy: `WITH CHECK ((institution_id = get_user_institution_secure(auth.uid())) AND can_create_tasks(auth.uid()))` |
| 2 | Students and super_admins cannot create tasks at all | `can_create_tasks()` allows only `super_school_admin`, `school_admin`, `coordinator`, `teacher`. 12 of 23 live tickets are from students. |
| 3 | The SALCI admin cannot open the Tasks tab | `src/App.tsx:316` `allowedRoles={["teacher","coordinator","school_admin","super_school_admin"]}`; `ProtectedRoute` has no super_admin bypass |
| 4 | School users cannot read the SALCI admin's profile | `profiles` SELECT requires `institution_id IS NOT NULL AND institution_id = get_user_institution_secure(auth.uid())`; bhanu has NULL |
| 5 | **The reporter would be able to close their own ticket** | `validate_task_state_transition()` is a check-list, not an allow-list. It has rules for `open→in_progress`, `in_progress→done_pending_approval` and `done_pending_approval→completed`, but **no rule for `open→completed`**. Any participant can shortcut straight to completed. |

Constraint 5 is decisive. In the normal task model the reporter is the assigner, the assigner is the approver, and the unguarded shortcut means the reporter could close the ticket. That inverts requirement 3 exactly.

A sixth issue is not a blocker but a confidentiality regression: a task stored in the reporter's own institution is readable by every teacher, coordinator and school admin there, via three institution-wide SELECT policies on `tasks`. Live tickets already reference passwords and named students.

## 3. Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| Who receives tickets | One configured support owner stored in the DB, bhanu@salci.in today | Changing owner is a one-row UPDATE, no deploy. Not resolved by role, not hardcoded. |
| Who else can see a ticket | Nobody. Reporter and SALCI only | Requires parking the task outside the reporter's institution |
| How the reporter tracks it | As the **assigner**, so it appears under "Assigned BY Me" | Requires a RESTRICTIVE UPDATE policy to remove their write authority |
| `reported_issues` | Kept as the intake record, linked by a new `task_id` | `/admin/issues` keeps working, the 23 live rows survive, rollback path preserved |

## 4. Architecture

### 4.1 The SALCI Support institution

One seeded row in `institutions`: `name='SALCI Support'`, `code='SALCI-SUPPORT'`, `is_active=false`, `timezone='Asia/Kolkata'`. Seeded idempotently with `ON CONFLICT (code) DO NOTHING` (`code` is UNIQUE).

It serves two purposes:

- **Privacy boundary.** Support tasks carry this `institution_id`, so the three institution-wide SELECT policies on `tasks` never match them for any school user.
- **Unforgeable authority marker.** No client can INSERT a task with this `institution_id` (constraint 1 above), so "is this a support ticket?" is a property the client cannot fake. `resolve_support_task` uses it as its authority check instead of a client-writable boolean.

Verified safe: production has exactly **one** `user_roles` row platform-wide with `institution_id IS NULL`, and it is the super_admin. `has_role_at_institution()` treats NULL institution as matching every institution, so a NULL-institution school role would be a platform-wide breach. Nobody holds a school role at the support institution, and nobody ever should.

### 4.2 Support owner configuration

```sql
CREATE TABLE public.support_settings (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),   -- single-row table
  owner_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX idx_support_settings_owner ON public.support_settings(owner_id);
```

`ON DELETE RESTRICT` on `owner_id` is deliberate: deleting the support owner's profile must fail loudly rather than silently orphan the support channel. Note `task_assignments.assignee_id` is `ON DELETE CASCADE`, so without RESTRICT a profile deletion would silently wipe every support assignment.

RLS: SELECT for authenticated (needed by nothing on the client directly, but harmless and useful for an admin screen later); UPDATE restricted to `is_super_admin()`. Read access in the RPCs goes through:

```sql
CREATE FUNCTION public.get_support_owner_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT owner_id FROM public.support_settings WHERE id $$;

CREATE FUNCTION public.get_support_institution_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id FROM public.institutions WHERE code = 'SALCI-SUPPORT' $$;
```

### 4.3 `reported_issues` link column

```sql
ALTER TABLE public.reported_issues
  ADD COLUMN task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX idx_reported_issues_task_id ON public.reported_issues(task_id);
CREATE INDEX idx_reported_issues_reporter_created
  ON public.reported_issues(reporter_id, created_at DESC);
```

`ON DELETE SET NULL` follows §21: `task_id` is an authorship-style reference, so deleting the task must leave the intake record standing rather than destroying the reporter's history. The second index backs the throttle lookup in §4.4; the table currently has only its primary key.

### 4.4 `create_support_task()` intake RPC

```
create_support_task(
  p_subject     text,
  p_description text,
  p_category    text,        -- support category, stored in reported_issues + task description
  p_priority    int,         -- 1..3 from the Urgency field
  p_page_url    text         -- where the user was when they hit Support
) RETURNS jsonb              -- { ticket_id, task_id }
```

`plpgsql SECURITY DEFINER SET search_path = public`. Steps:

1. Reject when `auth.uid()` is NULL.
2. **Throttle**: reject when the caller has opened more than 5 tickets in the last 60 minutes, counted off `reported_issues (reporter_id, created_at)`. This RPC is callable by every authenticated user including thousands of students, and it bypasses `can_create_tasks()`. The throttle is not optional.
3. Resolve the support institution and the support owner. **RAISE explicitly if either is missing.** A support channel that silently swallows submissions is worse than one that errors.
4. Snapshot the reporter: full name, email, primary role, institution name, assigned classes. This is baked into the task description as text, so rendering the ticket never requires a cross-tenant `profiles` read and constraint 4 never bites.
5. Insert the `tasks` row: `institution_id` = support institution, `title` = subject, `task_type = 'general'`, `status = 'open'`, `priority` = p_priority.
6. Insert `task_assignments`: `assignee_id` = support owner, `assigner_id` = reporter.
   **Edge case:** if the reporter *is* the support owner, set `assigner_id = NULL` instead. The `no_self_assignment` CHECK (`assigner_id <> assignee_id`) would otherwise reject the row.
7. Insert the `reported_issues` intake row carrying the new `task_id`.
8. Insert one `notifications` row for the owner: `type='task_assigned'`, `link='/tasks'`.
9. Return `{ticket_id, task_id}`.

Then `REVOKE EXECUTE ON FUNCTION public.create_support_task(...) FROM anon;` **by name**, verified via `information_schema.routine_privileges`. Supabase's `ALTER DEFAULT PRIVILEGES` grants anon EXECUTE on every new public function and `REVOKE FROM PUBLIC` does not strip it.

### 4.5 The RESTRICTIVE update policy

This is the mechanism that satisfies "only SALCI can complete it" while the reporter still sees the ticket.

```sql
CREATE POLICY "Only SALCI may update support tasks"
ON public.tasks AS RESTRICTIVE FOR UPDATE TO authenticated
USING (
  institution_id IS DISTINCT FROM public.get_support_institution_id()
  OR public.is_super_admin((SELECT auth.uid()))
);
```

How it composes: PostgreSQL ORs the permissive policies together, then ANDs the restrictive ones. The existing permissive policy is `USING (get_task_assignee(id) = auth.uid() OR get_task_assigner(id) = auth.uid())`.

- **Normal task** (any school institution): first disjunct is true, restrictive passes, behaviour identical to today. All 766 existing tasks are in this branch.
- **Support task, reporter acting**: first disjunct false, `is_super_admin` false, restrictive denies. The reporter cannot write any status.
- **Support task, SALCI acting**: `is_super_admin` true, restrictive passes.

`IS DISTINCT FROM` rather than `<>` is deliberate and load-bearing. If the support institution row is ever missing, `get_support_institution_id()` returns NULL; `<>` would yield NULL (not true) for every row and **deny UPDATE on every task platform-wide**. `IS DISTINCT FROM NULL` yields true, so the failure mode is "support tasks become writable" rather than "the entire tasks module bricks".

`(SELECT auth.uid())` wrapping is the established pattern in this repo for stable per-row calls in RLS, and `is_super_admin` is an existing SECURITY DEFINER helper, so no policy inlines a cross-table EXISTS and the 42P17 recursion trap is avoided.

### 4.6 `resolve_support_task()` RPC

```
resolve_support_task(p_task_id uuid, p_outcome text, p_note text) RETURNS void
```

`SECURITY DEFINER`. Steps: assert `is_super_admin((SELECT auth.uid()))`; assert the task's `institution_id` equals the support institution (authority check on an unforgeable marker); optionally insert `p_note` as a `task_comments` row; `UPDATE tasks SET status = 'completed'|'rejected' WHERE id = p_task_id AND status IN ('open','in_progress')`; mirror the outcome onto `reported_issues.status`. `REVOKE FROM anon` by name.

It deliberately skips the `done_pending_approval` ladder. With the reporter as assigner, `done_pending_approval → completed` requires the assigner and raises "Self-approval is not allowed" for the assignee, which would seat the reporter as approver. Going `open|in_progress → completed` directly is permitted because the trigger has no rule for those pairs.

**Documented dependency:** this relies on `open→completed` and `in_progress→completed` remaining unguarded in `validate_task_state_transition()`. If that trigger is ever hardened with a final `ELSE RAISE`, support resolution breaks. The migration carries a comment saying so, and the fix is to add those pairs to the allow-list.

## 5. Permission matrix

| Actor | See ticket | Change status | Via |
|---|---|---|---|
| Reporter | Yes, "Assigned BY Me" | **No** | permissive SELECT (assigner half); restrictive policy denies UPDATE |
| Reporter's school admin / colleagues | **No** | No | ticket's institution is SALCI Support, so institution-wide policies never match |
| SALCI support owner | Yes, "Assigned TO Me" | Yes | permissive SELECT (assignee half) + `Super admins can view all tasks`; restrictive passes on `is_super_admin` |
| anon | No | No | EXECUTE revoked by name on both RPCs |

## 6. Frontend

### 6.1 `SupportRequestSheet`

Replaces `ReportIssueDialog`. Built on `MobileSheet` per §20, mirroring `CreateTaskDialog`'s field grammar so it reads as the same family:

| Support field | Maps to | Notes |
|---|---|---|
| Subject * | `tasks.title` | same role as "Task Title" |
| Description | `tasks.description` | reporter snapshot appended by the RPC |
| Category * | support taxonomy | Exams, Attendance, Homework, Login and access, Results, Something else |
| Urgency * | `tasks.priority` 1..3 | Low / Medium / High, same as CreateTaskDialog's Priority |

No assignee picker (always SALCI), no due date, no supervisor rows. Auto-captured context (name, school, role, current page) shown as read-only chips so the reporter can see what is being sent.

Submit via `useMutation` calling `supabase.rpc('create_support_task', ...)`, single-flight on `isPending`, `toast.success` on success and `toastError(err, { fallback, context: 'createSupportTask' })` on failure. Drops the current `.from("reported_issues" as any)` cast and the raw `err.message` toast, both of which violate §19 and §5a.

Form sets `data-dirty="true"` while it has input, per the service-worker contract (§17).

### 6.2 Wiring

- Both entry points open the same component: the sidebar footer button (`AppSidebar.tsx:1130-1133`, already renamed to "Salci Support") and the Tasks header chip (`TasksPage.tsx:359-370`).
- The sidebar entry stays unconditional for all roles, including students. It works for them because the RPC is SECURITY DEFINER and bypasses `can_create_tasks()`.
- `src/App.tsx:316`: add `"super_admin"` to `/tasks` `allowedRoles`, otherwise the support owner cannot open the tab.
- `TasksPage`: hide the "Assign Task" primary action and the MobileFab when `!institutionId`. A super_admin cannot create ordinary tasks (`can_create_tasks` excludes them), so the button would only produce an RLS error. `useInstitutionTasks(null)` is already disabled for him; his tickets arrive through `useMyTasks()`, which filters on `assignee_id` with no institution filter.
- `TaskDetailPanel`: add "Resolve" and "Not an issue" actions gated on `isSuperAdmin && isSupportTask && status !== 'completed'`, calling `resolve_support_task`. Suppress the evidence-gated "Mark as Done" path for support tasks, since `done_pending_approval` dead-ends. The reporter's identity renders from the baked-in description, so `profiles` RLS is untouched.

### 6.3 Reporter's view

The ticket appears under "Assigned BY Me" because `useTasksAssignedByMe` filters on `task_assignments.assigner_id` alone with no institution filter (`src/hooks/useTasks.ts:213-232`). The detail panel opens read-only for them: no status buttons, since the restrictive policy would reject the write anyway and a button that always errors is worse than no button.

## 7. Error handling

- RPC raises are user-friendly sentences ("Support is not configured yet. Please contact SALCI."), so `isLikelyUserFriendly()` passes them through `toastError` unmodified.
- Zero support owner configured: RAISE, never a silent no-op.
- Throttle hit: RAISE with a plain-language message naming the limit.
- `/admin/issues` and any new list surface must render the error state **before** the empty state, so an RLS failure never reads as "no tickets".

## 8. Scale gate

| # | Item | Verdict |
|---|---|---|
| 1 | Pagination on list queries | pass. Reuses `TASK_LIST_RANGE`; no new unbounded list. Throttle count is a server-side `count(*)`. |
| 2 | Server-side aggregation | pass. No client-side counting added. |
| 3 | Explicit `staleTime` | pass. New queries reuse `TASK_STALE_TIME` (60s+). |
| 4 | No `select("*")` | pass. Explicit column lists; the existing `/admin/issues` `select("*")` is fixed in the same pass if that file is touched. |
| 5 | Idempotent mutations | pass. Single-flight on `isPending` plus the server-side throttle. |
| 6 | Dependent writes in one transaction | pass. All four inserts happen inside `create_support_task`. |
| 7 | FK indexes in-migration, DEFINER RLS helpers | pass. `idx_reported_issues_task_id`, `idx_support_settings_owner`, plus the missing `idx_reported_issues_reporter_created (reporter_id, created_at DESC)` needed by the throttle. Policy calls `get_support_institution_id()` and `is_super_admin()`. |
| 8 | Errors surfaced | pass. `toastError` on the mutation; error state before empty state. |
| 9 | No JWT-less `getUser()` | pass. Identity from `useAuth`. |
| 10 | No sub-30s polling | na. No new polling or subscriptions. |

## 9. Risks

1. **Trigger hardening dependency** (§4.6). Documented in the migration.
2. **New authenticated-callable task-creation surface.** Mitigated by the hourly per-caller throttle and the anon revoke.
3. **A new `institutions` row** appears in super-admin institution lists and any picker that does not filter on `is_active`. Pickers are not audited; check before shipping.
4. **Single support owner, no backup.** If the configured owner's profile is deleted, `ON DELETE RESTRICT` blocks it loudly rather than breaking support silently.
5. **Reporter sees a task they cannot act on.** Intentional, but the detail panel must make the read-only state obvious rather than showing dead buttons.
6. **Attachments are out of scope.** The `task-evidence` bucket is owner-scoped and was not audited for a cross-tenant reader. Screenshot upload needs its own storage decision.
7. **Stale migration ledger.** Apply via the Management API and verify with `pg_proc` / `information_schema`, never `supabase db push` blind. Regenerate `src/integrations/supabase/types.ts` from prod afterwards.

## 10. Testing

- **DB, against a branch or with explicit rollback:** reporter cannot UPDATE a support task (expect RLS denial); SALCI can via `resolve_support_task`; a school admin at the reporter's institution gets zero rows selecting the support task; a normal task's update path is byte-identical before and after the restrictive policy; `create_support_task` raises when no owner is configured; the throttle trips on the 6th call; the self-report edge case (owner files a ticket) inserts with NULL assigner rather than violating the CHECK.
- **Privileges:** `SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name IN ('create_support_task','resolve_support_task')` shows no `anon`.
- **Frontend:** `npm run typecheck`, `npx eslint <changed>`, `npx vite build` all exit 0. Manual pass at 375px and in dark mode per §20 items 25-26.

## 11. Out of scope

Attachments and screenshots; an SLA or due-date concept for tickets; email notification to SALCI (in-app notification only); a support-agent team model (the single configured owner is deliberate, and the config table extends to a team later without changing the intake shape); reporter-side threaded replies.