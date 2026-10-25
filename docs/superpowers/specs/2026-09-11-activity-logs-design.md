# Activity Logs rebuild (2026-09-11, naman-erp, frontend only)

**Route:** `/school/activity` (school admins) and `/admin/activity` (super admins), both `ActivityLogsPage`.

## Problem

The page showed three tables merged in the browser, 100 rows each, no paging, one type dropdown, and a
search that only looked at the merged 300. School scoping for task and exam rows happened client-side
after the fetch, so a school admin's page could be mostly other schools' rows that RLS then hid, leaving
a short list that looked like "quiet week". There was no detail view: `old_values`, `new_values`,
`metadata`, IP and user agent were fetched and never rendered.

## What ships in this round (frontend)

**Sources federated** (all admin-readable under existing RLS, verified in the migrations):

| Source | Table | Scope filter (SQL) |
|---|---|---|
| system | `system_audit_logs` | RLS on `metadata->>'institution_id'` (no column exists) |
| task | `task_audit_logs` | `tasks!inner(institution_id)` |
| exam | `exam_publication_logs` | `exams!inner(institution_id)` |
| assignment | `class_assignment_deletions` | `institution_id` column; names resolved in 3 batched `.in()` reads because the ledger has no FKs by design |

**Paging.** `useInfiniteQuery`, keyset cursor on the event timestamp with a boundary-key set so two
events in the same millisecond on different tables are never dropped between pages. Each page asks
every active source for 30 rows below the cursor, k-way merges, keeps 30. Never OFFSET.

**Filters** (server-side, in every source's query): sources (multi), date range (presets + custom
calendar), action (`eq`), person (`eq actor_id` / `deleted_by`), entity type (`ilike`, system only).
Search narrows the pages already loaded (skill §16 pattern A) because the sources share no text
column; the footer and empty state say so and offer "Load more".

**KPI strip.** Trailing 7 days, one HEAD count per source (4 requests, 5-minute cache), total summed
from those counts. No rows are fetched to count.

**Detail sheet** (`MobileSheet`, centred): who, what, when, status move, reason, before/after diff
with changed fields tinted, extra metadata, IP + browser, copy-to-clipboard ids, collapsed raw record.

**Export.** CSV of the visible events with every detail column, quotes escaped.

**Design.** `PageShell` + compact `PageHeader`, Classes-page KPI strip anatomy, source pills,
day-grouped timeline with sticky day headers under the app bar, tone discs per source
(system sky, task violet, exam teal, assignment peach), status chips coloured by outcome.
All colours through tokens; verified at 375px and in dark mode.

## Deletions now recorded from the client (same round)

`src/lib/deletionLog.ts` wraps `logActivityEvent`: the caller snapshots the row's identifying
columns BEFORE the delete (a deleted row cannot be read back, and PostgREST's `DELETE ... RETURNING`
is gated by the SELECT policy), then logs `<kind>_deleted` with `old_values` = the snapshot and
`metadata.institution_id` so the school's admins can read it. Instrumented: exams (`useDeleteExam`,
`useDeleteExamDraft`), exam templates, question bank, homework (`homework_delete` RPC), tasks
(`delete_task` RPC, records group fan-out count), diary entries, classes (`useDeleteClassGroup`,
records sections removed), wings, coordinator removed from wing, class removed from wing, subjects
(three direct-delete paths; the RPC path already logged server-side), subject removed from class
group, study materials, fee structures, fee categories, holidays, employee levels (global, super
admin only), timetable substitutions, shared resources (both hooks), admin role revoked
(`ManageAdminsPage` revoke-only branch; the delete-user branch is logged by `admin-operations`),
and role changes (`ChangeRoleDialog`, old and new role sets). Chapter, material, segment and
optional-group deletions were already logged before this round.

Not instrumented on purpose: exam-question and timetable-slot rewrites (internal DELETE-then-INSERT
of child rows, not a user-level deletion), the student's own leave withdrawal, syllabus progress
corrections, Olympiad, and the dormant communication templates.

## Creations now recorded from the client (same day, second round)

Naman created and deleted a chapter and only the deletion appeared: nothing in the codebase
logged creation. `src/lib/creationLog.ts` mirrors `logDeletion` with `<kind>_created` and
`new_values` = the row as written. Instrumented: chapters (all four create paths: syllabus hook,
class-scoped hook, school Add Chapter dialog, subjects page, admin global dialog), subjects (school
page and global catalogue), classes (with initial sections), wings, coordinator added to wing,
class added to wing, fee structures, fee categories, holidays, employee levels, shared resources,
exam templates, question bank (single add; bulk import still unlogged), study materials, tasks
(single and group fan-out, with assignee count), homework (draft creation; publish gate unchanged),
diary entries, exams (creation; publishing was already covered by `exam_publication_logs`).

## Server-side capture: SHIPPED 2026-09-14 (steps 1-3)

`supabase/migrations/20260914140000_server_side_activity_capture.sql`, applied and verified in
production. Step 4 (the `activity_feed` RPC and an `institution_id` column) and step 5 (retention)
are NOT done and are still worth doing when volume grows.

**What ships.** One `SECURITY DEFINER` trigger function, `tg_audit_row(label, name_column)`,
attached `AFTER ... FOR EACH ROW` to 24 tables as `zzz_audit_ins` / `zzz_audit_del`, 46 triggers
in total. It writes `system_audit_logs` with `action` = `<label>_created|deleted`, `entity_type` =
the human label, `entity_id`, `entity_name` (the given column, else name/title/level_name/label),
`old_values` / `new_values` as `to_jsonb` of the row, and `metadata` carrying `institution_id`,
`source: 'trigger'` and the table name. `actor_id` is `auth.uid()`; a NULL actor (cron, an edge
function on the service role, a cascade) also gets `metadata.via = 'system'` so the page can say
so honestly.

**Institution resolution**, in order: the row's own `institution_id`; then a lookup on `wings` for
the two wing join tables; then the ACTOR's institution. That last fallback is what lets rows on
institution-less tables reach the school admin who caused them, because the `system_audit_logs`
read policy keys on `metadata->>'institution_id'`. `employee_levels` is global and stays NULL, so
only super admins see it, matching who can edit it.

**Nothing here can break the write it audits.** The whole body is wrapped so any failure downgrades
to a `WARNING` and the original statement still commits. An audit trigger able to abort a delete
would be worse than no trigger. Verified by a full dry run inside a rolled-back transaction: an
insert and a delete of a fee category as a real school admin produced exactly two rows, correct
actor, correct institution, `source = trigger`, and neither write was blocked.

**Coverage choices worth knowing.**
* `question_bank` is DELETE-only. It holds 100,281 rows and is loaded by XLSX imports of tens of
  thousands at a time; an INSERT trigger there would swamp the table. Single-question adds are
  therefore still logged by the client, and bulk imports remain unlogged as before.
* `tasks` is DELETE-only, because `log_task_created` already writes `task_audit_logs` on insert and
  the page federates that table, so an INSERT trigger would print every new task twice.
* `syllabus_topics` DOES get INSERT: chapter creation was the gap that prompted the creation
  logging in the first place, and at 4,516 rows the whole history is bounded.
* Indexes added: `((metadata->>'institution_id'), created_at DESC)` so the RLS predicate and the
  feed's ORDER BY are one scan, and `(actor_id, created_at DESC)` for the person filter.

**The client stopped duplicating these.** The `logDeletion` / `logCreation` calls Naman added are
removed in the same change, together with the snapshot SELECT each one ran purely to fill
`old_values`, which also removes a wasted round trip from every delete. `src/lib/deletionLog.ts`
and `src/lib/creationLog.ts` go with them.

## STILL OPEN: the forgery hole, and what has to happen first

`log_audit_event` is `SECURITY DEFINER` and granted to `authenticated`, so any signed-in user can
write a `system_audit_logs` row with any action, any entity, any values, and any
`metadata.institution_id`, which decides whose Activity page shows it. `actor_id` is stamped from
`auth.uid()`, so WHO cannot be forged, but WHAT can, and it can be aimed at another school.

**It cannot be revoked yet.** Triggers cover INSERT and DELETE; they do NOT cover the edit-type
events the client still logs through `logActivityEvent`, and those are real coverage that would be
lost. The remaining callers, all of them UPDATE-shaped:

| Call site | Event |
|---|---|
| `UpdateRollNumberSheet` | roll number changed |
| `UpdateClassSectionSheet` | student moved between sections |
| `UpdateOptionalSubjectSheet`, `useStudentOptionalSubjects` | optional subject changed |
| `useStudentDetails` | student personal details edited |
| `useSetUserAvatar` | profile photo set or cleared |
| `useOptionalGroups`, `useOptionalBatches` | optional group and batch edits |
| `SegmentManagerSheet` | syllabus segment edits |
| `useManageSchoolSubject` | subject renamed or re-scoped |
| `ChangeRoleDialog` | role change, kept deliberately: one readable old-set/new-set row beats the two rows the `user_roles` triggers produce |

To close it: add UPDATE triggers covering those tables (`profiles` name/photo columns only,
`student_personal_details`, `student_optional_enrollments`, `optional_groups`, the segment tables,
`universal_subjects`), move each call site off `logActivityEvent`, then

```sql
REVOKE ALL ON FUNCTION public.log_audit_event(text, text, uuid, text, jsonb, jsonb, jsonb) FROM authenticated;
```

The six SQL callers (`delete_institution_subject`, `grant_teacher_role`, `revoke_teacher_role`,
`set_class_teachers`, `set_staff_class_assignments`, `unassign_subject_from_class`) are all
SECURITY DEFINER and the edge functions use the service role, so none of them is affected by that
revoke. Only the browser loses the write, which is the point.

## Original proposal (for reference)

The page can only show what is written. Today the writers are: 18 client `logActivityEvent` calls,
7 SQL RPC call sites of `log_audit_event`, and the `admin-operations` / `broadcast-email` edge
functions. Whole modules leave no trace: class create/rename/delete, student admission and
promotion, staff creation, notices and diary posts, homework create/publish, timetable and
substitution edits, attendance corrections, fee entries, support status changes, logins.

Proposed server-side capture, in priority order, so nothing depends on a client remembering to log:

1. **Generic row-audit trigger.** One `SECURITY DEFINER` trigger function that writes
   `system_audit_logs` (`action` = `<table>_inserted|updated|deleted`, `entity_type` = table,
   `entity_id` = `NEW.id`/`OLD.id`, `entity_name` from a per-table name column, `old_values` /
   `new_values` as `to_jsonb(OLD/NEW)` minus secret columns, `metadata.institution_id` from the
   row's `institution_id` so the existing RLS keeps scoping). Attach to: `classes`, `class_groups`,
   `profiles` (name/email/phone/is_active only), `user_roles`, `class_assignments`,
   `subject_class_group_mappings`, `notices`, `homework`, `tt_slots`, `tt_substitutions`,
   `attendance` corrections, `student_leave`, `reported_issues` status.
2. **`actor_id` inside triggers** = `(select auth.uid())`; for cron/service writes leave it NULL
   and set `metadata.via = 'system'`.
3. **Indexes** for the new query shapes: `system_audit_logs (created_at DESC)` exists;
   add `((metadata->>'institution_id'), created_at DESC)` so the RLS predicate plus the page's
   ORDER BY is one index scan, and `(actor_id, created_at DESC)` for the person filter.
4. **Optional, once volume grows:** an `activity_feed(_institution_id, _before, _limit, _sources,
   _action, _actor, _from, _to)` RPC that UNION ALLs the four sources in SQL and returns one page,
   replacing the 4-way client merge with one request; and a `system_audit_logs.institution_id`
   column backfilled from `metadata` so the RLS predicate stops parsing JSON per row.
5. **Retention:** a monthly partition or a `pg_cron` purge past 24 months; the page pages by time,
   so nothing in it depends on the table staying small.

The frontend already renders whatever these triggers write: unknown actions fall back to a
humanised label and appear in the Action filter automatically.

## Known limits of this round

- `homework_mark_audit` is readable only via `can_manage_homework()`, which may not include school
  admins; it is left out rather than risk a 42501 that would blank the page. Fold it into the RPC in
  step 4 above.
- Person and entity-type filter options come from the events loaded so far, not from a directory.
- "Today" in the 7-day window uses browser-local midnight (§24 note: fine for IST-only schools).
