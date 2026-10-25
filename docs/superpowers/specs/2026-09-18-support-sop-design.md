# Salci Support: Ticket Resolution SOP, design and database handover

**Date:** 2026-09-18
**Status (revised 2026-09-18 evening, Naman):** the workflow is deliberately SIMPLE. A school
user raises a ticket; it lands in the inbox; the super admin sees tickets by priority and can
mark "escalated to" a technical team member as a reminder of who is working on it; the task
itself is raised by hand in Task Management and is not linked. No escalation RPC, no task
trigger, no paused state. Frontend Parts A and C are on `naman-erp`; Part C is dormant behind a
schema probe (`useSupportSopReady` in `src/hooks/useSupportSop.ts`) and appears the moment
Part B (five columns, Tushar) lands, with no frontend deploy. The support measurements (open, in
progress, resolved, turnaround) stay at the top of the inbox itself.

The earlier, fuller design below §4.2 onwards (escalation table, trigger, paused clock,
working-hours stats) is kept for reference only and is NOT requested.
**Source:** "SALCI Support - Ticket Resolution SOP", Standard Operating Procedure, effective
September 2026 (Tushar).
**Builds on:** [2026-08-31-salci-support-workflow-design.md](2026-08-31-salci-support-workflow-design.md)
(the thread, the RPC surface, the one-write-path rule) and the `support-module` skill.
**Branch rule:** Naman ships `src/`, `docs/`, `public/` only. Every item under Part B is a
`NEEDS DB` for Tushar; the names there are proposals, not existing objects.

---

## 1. The SOP in one page

- **Owner:** one Support Executive owns every ticket from open to close. Hours 10:00 to
  18:00, Monday to Saturday. Target: average closure under 24 working hours.
- **Flow:** acknowledge with a next step (60 minutes for staff, same day for students);
  solve it and close with a sentence saying what changed; or **escalate**: create a task
  for the SALCI person who can fix it, linked to the ticket, and tell the reporter it is
  escalated with an expected date. The concerned person closes the task; the Support
  Executive verifies, replies and closes the ticket. **A closed task is never a closed
  ticket.**
- **Priority:** set on what is blocked; role breaks the tie (Admin or Principal, then
  Coordinator, then Teacher, then Student). Levels P1, P2, P3 and Enhancement.
- **Order:** tickets sitting past 24 working hours top the inbox, then P1, P2, P3,
  Enhancement.
- **Rules:** "Fixed" is not a closure; any ticket open past one working day gets a reporter
  update every day; diagnosis and blame go in internal notes; a ticket waiting on the
  reporter is paused, not late.
- **Measurement:** the closure clock runs 10:00 to 18:00 Mon to Sat only and pauses while
  awaiting the reporter. Weekly: average closure time and the 90th percentile, SLA breach
  rate per priority, escalated-task turnaround.

## 2. Decisions (Naman, 2026-09-18)

| Question | Decision | Why |
|---|---|---|
| Who can a ticket be escalated to | The SALCI team only (super admins) | The escalation task lives in the SALCI-SUPPORT container and never appears in a school's task list. Every fixer is a super admin, so the existing RESTRICTIVE policy "Only SALCI may update support tasks" already lets them move it; no policy change. |
| Priority model | Reporter urgency (1..3) stays as intake input; SALCI sets `triage_priority` P1 / P2 / P3 / Enhancement | Two columns, one writer each; the "reporter said High, SALCI said P3" signal survives. Only the SALCI value drives order and SLA. |
| Role tie-break | Derived from `reporter_role` at sort time, never stored | Fully determined by a column already on the row. |
| SLA targets (working hours) | P1 4, P2 8, P3 24, Enhancement none | Keeps the 24-hour average reachable and gives P1 a same-half-day promise. Enhancements are excluded from the breach rate. |
| Awaiting reporter | A paused **flag** (`awaiting_reporter_since`), not a fifth status | The four-value status CHECK is enumerated in eight places (tabs, board columns, three tone maps, counts and stats RPCs, mirror mapping) and the deployed frontend must keep working. The flag is the timestamp the clock needs anyway. |
| Closure sentence | Enforced in the UI first (Part A), then in `_support_apply_status` (Part B) | Enforcing server-side first would break the `/tasks` Resolve dialog, which passed no note before Part A. |
| Percentiles | Median stays the headline; p90 is added, gated at n >= 10 | The SOP asks for it. This reverses the 2026-09-10 "no p90" rule in the `support-module` skill; Tushar updates the skill when Part B lands. |

## 3. Part A: shipped on the frontend (no database change)

- `src/lib/workingHours.ts`: the desk clock. `workingSecondsBetween`, `workingHoursSince`,
  `isPastWorkingHours`, `formatWorkingAge`. 10:00 to 18:00, Mon to Sat, Asia/Kolkata (IST
  has no DST, so a fixed offset is exact; the CLAUDE §24 caveat applies if the desk moves).
  Checked against the SOP's own example: filed 20:30, closed 10:15 the next day is 15
  minutes.
- `src/lib/supportSop.ts`: `SUPPORT_PRIORITIES` with definitions (P1 "Blocks a whole
  school or an exam in progress", P2 "Blocks one person's work today", P3 "Wrong or
  confusing, work can continue", Enhancement "A request for something new"), `roleRank`,
  `taskPriorityFor` (P1 3, P2 2, P3 1, Enhancement 1 in the tasks convention),
  ~~`validateClosureNote`~~ (**REMOVED 2026-09-22**, see the closure-note note below),
  `supportInboxComparator` (overdue first, then P1, untriaged, P2, P3,
  Enhancement, then role, then oldest). The comparator reads `triage_priority` and
  `awaiting_reporter_since` when present, so it needs no change when Part B lands.
- `/admin/issues`: rows sorted by the comparator; live tabs fetched oldest first so the
  200-row page holds the tickets the SOP ranks; each live row shows "Open N working
  hours", an ink-weight chip "Past 24 working hours" when overdue, and "No update for N
  working hours" when nothing has been posted for eight working hours and the reporter is
  not the one waiting (approximate until `last_salci_message_at` exists). The board has a
  "Support SOP order" sort, default on the SALCI side.
- Closure sentence on every path: inline "What changed" field in `IssueDetailSheet` when
  the draft is Resolved or Closed; `ClosureNoteSheet` on a board drop onto those columns;
  the same field on the `/tasks` Mark as resolved and Not an issue dialogs. The note
  travels as the existing `p_note` and is filed as a reporter-visible message by the RPC.
- Notification icons for `support_escalated` and `support_escalation_update`.

## 4. Part B: NEEDS DB (Tushar)

Every name below is a proposal. Grants per the `support-module` skill §3: both
`REVOKE ... FROM PUBLIC` and `FROM anon` by name, `GRANT ... TO authenticated,
service_role`, verified in `pg_proc.proacl`. All RPCs `plpgsql SECURITY DEFINER SET
search_path = public`.

### 4.1 Columns on `reported_issues` (additive). THIS IS THE WHOLE ASK.

| Column | Type | Meaning |
|---|---|---|
| `triage_priority` | `text CHECK IN ('p1','p2','p3','enhancement')`, NULL | SALCI-set priority; NULL is untriaged |
| `triaged_at` | `timestamptz` | when it was last set |
| `escalated_to` | `uuid -> profiles(id) ON DELETE SET NULL` | the technical team member working on it |
| `escalated_to_name` | `text` | snapshot of that person's name (profiles RLS hides rows across institutions) |
| `escalated_at` | `timestamptz` | when the mark was set |

Writes come from the client under the existing super-admin UPDATE policy on
`reported_issues` (`useSetTicketTriage` in `src/hooks/useSupportSop.ts`: a direct UPDATE of
these five columns, re-selected by id so an RLS block reads as an error). No RPC, no thread
row, no notification: neither value is a message to the reporter. If you would rather keep
the one-write-path rule strict, a `set_support_ticket_triage(p_ticket_id, p_priority,
p_escalated_to)` DEFINER RPC with the same effect is fine; the client is one function to
change. Nothing else in §4 is needed for the simple workflow.

Optional later: the working-hours turnaround metrics in §4.4 (`support_inbox_stats` keys) so
the dashboard cards read the SOP's clock instead of calendar hours.

### 4.2 Table `support_escalations`

`id uuid PK`, `ticket_id -> reported_issues ON DELETE CASCADE` (index), `task_id -> tasks
ON DELETE CASCADE UNIQUE`, `assignee_id -> profiles ON DELETE CASCADE` (index),
`assignee_name text NOT NULL` (snapshot: profiles RLS hides rows across institutions),
`opened_by -> profiles ON DELETE SET NULL`, `expected_by date NOT NULL`, `reporter_note
text`, `opened_at timestamptz NOT NULL DEFAULT now()`, `closed_at timestamptz`, `outcome
text CHECK IN ('fixed','not_fixed','withdrawn')`, partial `UNIQUE (ticket_id) WHERE
closed_at IS NULL`. RLS: SELECT `is_super_admin((select auth.uid())) OR assignee_id =
(select auth.uid())`; no client writes. Please verify `task_evidence` and `task_comments`
INSERT policies admit a super-admin assignee of a task in the container institution; the
ladder needs evidence for `done_pending_approval`.

### 4.3 Helper `support_working_seconds(p_from timestamptz, p_to timestamptz) RETURNS integer`

`LANGUAGE sql STABLE` (not IMMUTABLE: `timezone(text, timestamptz)` is STABLE). For each
IST calendar day from `p_from` to `p_to`, skip Sundays, add
`greatest(0, extract(epoch from least(p_to_local, d + '18:00') - greatest(p_from_local,
d + '10:00')))`. Return 0 when `p_to <= p_from`. Must agree with
`src/lib/workingHours.ts` on the SOP example (15 minutes) and on a Saturday 17:00 to
Monday 11:00 span (2 hours).

### 4.4 RPCs

- **`set_support_ticket_priority(p_ticket_id uuid, p_priority text) RETURNS jsonb`.**
  Super admin only. No-op when unchanged. Sets `triage_priority`, `triaged_at`. Writes an
  INTERNAL `kind='system'` row "SALCI set priority to P1." (internal system rows are allowed
  by the skill §1 design). Mirrors `tasks.priority` on `task_id`: p1 3, p2 2, p3 1,
  enhancement 1. Returns `{ticket_id, priority}`.
- **`post_support_message`: DROP the current signature and recreate** with
  `p_awaits_reporter boolean DEFAULT false` (two overloads would be ambiguous for
  PostgREST). Step 10 gains: a SALCI public post with the flag stamps
  `awaiting_reporter_since = coalesce(awaiting_reporter_since, now())` and writes "SALCI is
  waiting for the reporter to reply."; any reporter public post while
  `awaiting_reporter_since` is set adds `support_working_seconds(since, now())` to
  `paused_working_seconds`, clears the flag and writes "The reporter replied. SALCI is back
  on this request."; every SALCI public post stamps `last_salci_message_at`. Internal notes
  change none of these.
- **`escalate_support_ticket(p_ticket_id uuid, p_assignee_id uuid, p_title text,
  p_details text, p_expected_by date, p_reporter_note text, p_client_token uuid) RETURNS
  jsonb`.** Super admin only; `p_assignee_id` must be a super admin and not the actor
  (`no_self_assignment`); `p_reporter_note` required. One transaction: `tasks` row in
  `get_support_institution_id()` (`title = p_title`, description = `p_details` plus a link
  line `/admin/issues?ticket=<id>`, `task_type 'general'`, `priority` from the map,
  `due_date = p_expected_by`, `status 'open'`); `task_assignments` (assignee, assigner =
  actor); `support_escalations` row; ticket `escalated_at = now()`, `escalation_done_at =
  NULL`, and open to in_progress through the existing system row; INTERNAL row "Escalated
  to <assignee_name>. Expected by <date>."; PUBLIC row "SALCI escalated this request to the
  team. Expected update by <date>."; PUBLIC salci message = `p_reporter_note` (stamps
  `last_salci_message_at`, `first_response_at` if first); notifications: reporter type
  `support_escalated`, title "Your support request has been escalated", link
  `/support?ticket=<id>`; assignee type `task_assigned`, link `/tasks`, metadata
  `{task_id}` (the client resolver opens the task). Idempotent on `p_client_token`; a
  partial-unique violation returns the existing open escalation. Returns
  `{escalation_id, task_id, notify}`.
- **`list_salci_staff() RETURNS jsonb`.** Super admin only. Super admins as
  `[{id, full_name, email}]`, ordered by name, LIMIT 200. Needed because profiles RLS blocks
  the client from listing them.
- **Trigger `support_escalation_task_sync`** AFTER UPDATE OF status ON `tasks`, only when a
  `support_escalations` row matches `NEW.id`: `done_pending_approval` sets
  `escalation_done_at = now()`, writes INTERNAL row "<assignee_name> marked the escalated
  task done. Verify the fix before replying." and a `support_escalation_update`
  notification to `opened_by` (title "Escalated task marked done", link
  `/admin/issues?ticket=<id>`); `completed` sets `closed_at`, `outcome 'fixed'`, same
  row and notification if not already sent; `rejected` clears `escalation_done_at` and
  writes an INTERNAL row. **Never writes `reported_issues.status`.** Exception-wrapped so a
  failure never blocks the task update.
- **`_support_apply_status`:** the closure-note RAISE described here was **NEVER BUILT and
  is now WITHDRAWN (2026-09-22). Do not implement it.** The client-side twin shipped, and on
  2026-09-22 it blocked a real closure on a live Alliance ticket: the primary button sat
  disabled and the reason was invisible, because the error only rendered after the note box
  had been focused and blurred. A server RAISE would be strictly worse, surfacing as a raw
  Postgres error on a button the operator cannot otherwise use. The note stays optional on
  every path; the live function keeps `v_note := nullif(btrim(coalesce(p_note,'')),'')`, so
  an empty note is simply a NULL note. On resolved or
  closed: accumulate and clear `awaiting_reporter_since`; close any open escalation
  (`outcome 'withdrawn'` unless already `'fixed'`); clear `escalated_at`. Stamp
  `last_salci_message_at` when a note is filed. `set_support_ticket_status` and
  `resolve_support_task` inherit all of it.
- **`list_my_support_tickets` and `get_support_thread`:** ticket objects add
  `escalated_at`, `awaiting_reporter_since`, `escalation_expected_by`. Never the priority,
  never the assignee.
- **`support_inbox_stats`** adds: `sla_open_overdue_24wh` (open or in_progress, not paused,
  working age > 24), `in_progress_escalated`, `in_progress_awaiting_reporter`,
  `escalation_done_unverified`; for the 7-day and 30-day windows over the existing
  school-raised `status='resolved'` cohort: `sla_close_avg_wh_*`, `sla_close_p90_wh_*`,
  `sla_close_sample_*`, `sla_breach_*` (count over `sla_eligible_*`: triaged and not
  enhancement), `esc_turnaround_avg_wh_*`, `esc_sample_*` (escalation `opened_at` to
  `closed_at`). Durations are `support_working_seconds(created_at, resolved_at) -
  paused_working_seconds`.
- **Notification types:** `support_escalated`, `support_escalation_update`. The existing
  `send-task-notifications` cron covers the escalation task's `due_date` (reminder,
  overdue, escalation to the assigner).

## 5. Part C: frontend, on the tree now, dormant until §4.1 lands

- `src/hooks/useSupportSop.ts`: `useSupportSopReady` (schema probe), `useSalciStaff`
  (super admins via `user_roles` + `profiles`, the UsersPage shape), `useSetTicketTriage`
  (direct UPDATE of the five columns under the existing super-admin policy).
- `useReportedIssues` / `useReportedIssuesBoard` / `useReportedIssueById` widen the select to
  the five columns only when the probe says they exist.
- `IssueDetailSheet`: a Priority select (P1 / P2 / P3 / Enhancement with one-line
  definitions) and an "Escalated to" select over the SALCI team, both saving at once. Helper:
  "A reminder of who is working on it. Raise the task in Task Management yourself."
- Inbox rows and board cards: P1..Enhancement or "Needs priority", and "With <name>" chips.
  The comparator reads `triage_priority` automatically.
- The measurements (Open, In Progress, Resolved, Turnaround) stay at the top of `/admin/issues`,
  not on the home page (Naman, 2026-09-18). The super admin home gains a Support Inbox tile.

## 6. Risks

- If the closure-sentence rule is ever enforced server-side, Part A must already be
  deployed: the `/tasks` Resolve dialog passed no note before it.
- Fetching live tabs oldest first changes which 200 rows appear once the backlog passes 200
  (about 40 tickets today).
- `escalated_to_name` is a snapshot; a renamed team member keeps the old name on old tickets,
  which is the same trade the thread makes with `author_name`.
