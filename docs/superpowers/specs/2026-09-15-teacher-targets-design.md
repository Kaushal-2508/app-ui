# Teacher Targets: design

**Status:** DESIGN, approved decisions recorded below. NO code, NO migration, NO prod change yet.
**Date:** 2026-09-15. **Branch:** `main` (Tushar, full stack).

An admin gives a coordinator a numeric target for a wing; the coordinator splits it across their
teachers. An admin may also target a teacher directly. Targets run over a date range or a repeating
cadence, and every closed period is kept so anyone can look back after the deadline.

Version 1 measures exactly two things: **exams published** and **homework published**.

---

## 0. Decisions (locked)

Every one of these was decided by the product owner on 2026-09-15. Do not re-litigate without them.

| # | Decision | Answer |
|---|---|---|
| 1 | What an exam must be to count | **Published**, i.e. it reached students |
| 2 | What a homework must be to count | **Published** to a class |
| 3 | Where a repeating period starts | **Rolling from the target's own `starts_on`**, not calendar aligned |
| 4 | What a wing target is | Admin hands a **pool** to **one named coordinator**, who splits it |
| 5 | Who receives a wing target | The **admin picks the coordinator explicitly** |
| 6 | Unit of a teacher target | **One total per teacher**, across all their classes and subjects |
| 7 | Who may receive a target | Anyone holding the **`teacher` or `coordinator`** role |
| 8 | Does the teacher see it | **Yes**: the number and live progress |
| 9 | Teacher surface | A **dedicated teacher page**, reached from the same header button |
| 10 | On a shortfall | **Record it and notify the teacher.** No flag, no auto-task, no escalation |
| 11 | Lifetime | Runs **until an end date**; all history **kept and readable after the deadline** |
| 12 | Coordinator never splits the pool | **Notify the coordinator**, and show it as undistributed to the admin |
| 13 | A teacher leaves the wing mid-period | **They keep the target.** It was assigned to the person |
| 14 | Split does not add up to the pool | **Allowed.** Show the gap to both the admin and the coordinator |
| 15 | Homework dating | **Add a `published_at` column to `homework_assignments`** |

---

## 1. Why a wing does not resolve to teachers

The original plan was to fan a wing target out to every teacher in the wing. That is abandoned, and
the reason is worth recording, because it is a trap anyone revisiting this will fall into.

There is **no helper, RPC or reusable query anywhere in this repo that maps a wing to its teachers**,
and the repo contains two rival, both-shipped derivations that return different people:

| Path | Used by | What it returns |
|---|---|---|
| `wings` -> `wing_class_mappings` -> `classes` -> `class_assignments.role='teacher'` | `WingsPage.tsx`, `dash_scoped_wing_standing`, `coordinator_covers_task`, `dash_scoped_task_queue` | Every teacher timetabled into the wing's sections |
| `wings` -> `wing_assignments` -> `profiles` | `dash_teachers_table` wing filter, `notice_expand_audience` wing scope | Only the handful of people directly assigned, in practice the coordinators |

Whichever one a new feature picked would contradict a screen that already ships. The cascading model
(decision 4) dissolves the problem entirely: **the admin targets one named person, and the coordinator
names the teachers themselves.** Nothing auto-resolves a wing into a teacher list, so neither
derivation is needed.

Two further facts that made auto-resolution a bad idea regardless:

* `wing_class_mappings` is **never pruned**. The academic-year rollover mirrors every `(wing, class)`
  pair forward without deleting the old one. Any class-path query omitting
  `classes.is_active IS NOT FALSE` fans out to teachers of dead sections.
* **Nothing in the wing schema is effective-dated.** The only `valid_from`/`valid_to` and
  `effective_from`/`effective_to` columns in the whole migration set are on `fee_concessions` and
  `staff_salary_assignments`, both unrelated. Once a teacher moves wings, the previous state is gone,
  so "who was in this wing on day 1" is unanswerable after the fact.

Verified table shapes:

```
wings                 (id, institution_id, name, description, display_order, is_active, ...)
                      UNIQUE (institution_id, name)
wing_assignments      (id, wing_id -> wings CASCADE, user_id -> profiles CASCADE,
                       assigned_at, assigned_by -> profiles)
                      UNIQUE (wing_id, user_id)            -- no role column; no institution_id
wing_class_mappings   (id, wing_id -> wings CASCADE, class_id -> classes CASCADE, created_at)
                      UNIQUE (wing_id, class_id)
```

`wing_assignments` carries **no role column**, so "the coordinators of a wing" means: rows in
`wing_assignments` whose `user_id` also holds the `coordinator` role. The institution comes from
`wings.institution_id`, not from the assignment row.

---

## 2. Data model

Two new tables. Both are new; every other object named in this document was verified to exist.

### 2.1 `teacher_targets` (the definition)

```
teacher_targets
  id                uuid PK
  institution_id    uuid NOT NULL -> institutions ON DELETE CASCADE
  metric            text NOT NULL CHECK (metric IN ('exams_published','homework_published'))
  scope             text NOT NULL CHECK (scope IN ('wing','teacher'))
  wing_id           uuid NULL     -> wings ON DELETE CASCADE      -- scope='wing' only
  owner_id          uuid NOT NULL -> profiles ON DELETE CASCADE   -- coordinator (wing) or teacher
  parent_target_id  uuid NULL     -> teacher_targets ON DELETE CASCADE
  target_value      integer NOT NULL CHECK (target_value > 0)
  starts_on         date NOT NULL
  ends_on           date NOT NULL CHECK (ends_on >= starts_on)
  cadence_unit      text NULL CHECK (cadence_unit IN ('day','week','month'))
  cadence_n         integer NULL CHECK (cadence_n > 0)
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','stopped','completed'))
  note              text
  assigned_by       uuid NULL -> profiles ON DELETE SET NULL
  created_at, updated_at  timestamptz NOT NULL DEFAULT now()
```

Shape rules, enforced by CHECK constraints rather than convention:

* `scope='wing'` requires `wing_id NOT NULL` and `parent_target_id IS NULL`.
* `scope='teacher'` requires `wing_id IS NULL`.
* `parent_target_id NOT NULL` implies `scope='teacher'` and a parent whose `scope='wing'`.
* `cadence_unit` and `cadence_n` are both NULL (a one-off date range) or both NOT NULL.

**A child inherits its parent's window, cadence and metric, and may not change them.** When a
coordinator splits a pool, `split_wing_target` copies `metric`, `starts_on`, `ends_on`,
`cadence_unit` and `cadence_n` from the parent onto every child; the coordinator sets only
`target_value` and which teachers receive one. This is not cosmetic: if a child could run on a
different window from its pool, "34 of 40 allocated" would be comparing numbers measured over
different spans, and the gap shown to the admin would be meaningless. Enforce it in the RPC and
re-assert it with a trigger, not by trusting the caller.

**Cadence encoding.** Two columns cover every cadence asked for and stay open to more:

| Cadence | `cadence_unit` | `cadence_n` |
|---|---|---|
| One-off date range | NULL | NULL |
| Weekly | `week` | 1 |
| Fortnightly / 15 days | `day` | 15 |
| Monthly | `month` | 1 |
| Quarterly | `month` | 3 |

**Rolling periods.** Period *k* (1-based) runs from `starts_on + (k-1) * cadence_n * cadence_unit`
to the day before `starts_on + k * cadence_n * cadence_unit`, with the final period clipped at
`ends_on`. This is decision 3, "counting starts from the 1st day". Postgres interval arithmetic
already clamps month ends correctly (31 Jan + 1 month = 28 Feb).

There is **no rolling-window helper in this repo to reuse**. Everything shipped is either calendar
aligned or a trailing offset from `now()`. In particular `dash_range_window` accepts only five
month-granular tokens and **silently falls back to `'3m'`** on anything it does not recognise, so it
must not be used here: a new cadence token would quietly narrow the window instead of failing.

### 2.2 `teacher_target_periods` (the ledger)

```
teacher_target_periods
  id                uuid PK
  target_id         uuid NOT NULL -> teacher_targets ON DELETE CASCADE
  institution_id    uuid NOT NULL -> institutions ON DELETE CASCADE
  teacher_id        uuid NOT NULL -> profiles ON DELETE CASCADE
  period_index      integer NOT NULL CHECK (period_index > 0)
  period_start      date NOT NULL
  period_end        date NOT NULL
  target_value      integer NOT NULL      -- SNAPSHOT of the number for THIS period
  achieved_value    integer NOT NULL DEFAULT 0
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','met','missed'))
  closed_at         timestamptz
  notified_at       timestamptz
  created_at, updated_at timestamptz NOT NULL DEFAULT now()
  CONSTRAINT teacher_target_periods_target_period_key UNIQUE (target_id, period_index)
```

**Only `scope='teacher'` targets get period rows.** The wing number is a server-side `SUM` over its
children, so there is exactly one source of truth and no denormalised copy to drift.

**Why the ledger exists at all.** Both source tables hard-delete with no tombstone:

* Exam delete is a plain `DELETE` (`src/hooks/useExamData.ts`), and `exams` has no `deleted_at` or
  `archived_at` column anywhere.
* `homework_delete` cascades every child and writes no audit row. The only homework audit table,
  `homework_mark_audit`, covers `homework_results` only.

So a row deleted in November silently changes what September's count *was*. Freezing
`achieved_value` and `target_value` when the period closes is the only way decision 11 ("readable
after the deadline") stays true. An edit to a live target changes future periods and the open one;
it never rewrites a closed row.

---

## 3. Counting

### 3.1 Exams

```sql
SELECT count(*)
FROM exams e
WHERE e.created_by = <teacher_id>
  AND e.institution_id = <institution_id>
  AND e.status IN ('published','active','completed')
  AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
      BETWEEN <period_start> AND <period_end>
```

`exam_status` is an enum with exactly six values, verified in
`20260104115119_c3121678-04d9-4f00-a829-914cfd6bf3d9.sql:9`:
`('draft','ready','published','active','completed','archived')`. The three-value filter matches the
existing `exams_published` badge metric and deliberately excludes `archived`.

**Use this exact date chain.** `COALESCE(published_at, scheduled_date, created_at)` is what every
`dash_*` and `school_analytics_*` RPC uses. Two rival chains are live in prod and disagree with it
(the achievements evaluator puts `scheduled_date` first; the flag evaluator omits `published_at`
entirely). Picking a different one makes the same teacher's September read two different numbers on
two screens.

Known, accepted imprecision, all recorded rather than fixed here:

* `exams.created_by` is nullable, `ON DELETE SET NULL`. Deleting a teacher's profile orphans their
  exams and their historical counts vanish. The frozen ledger is what preserves the score.
* The INSERT policy on `exams` never checks `created_by`, so attribution is forgeable by any
  teacher, coordinator or school admin posting directly to PostgREST. Out of scope to fix.
* Coordinators and school admins may UPDATE any exam in the institution, and publishing is what moves
  the count. **An admin flipping a teacher's draft to published credits that teacher's target without
  the teacher acting.**
* `published_at` is written by the `validate_exam_status_transition` BEFORE UPDATE trigger, which
  fires only `WHEN OLD.status IS DISTINCT FROM NEW.status`. An exam INSERTed straight as
  `'published'` gets a NULL `published_at` and falls through the chain.
* Results-only exams (`exams.is_results_only`) are papers the teacher did not author, only uploaded
  marks for, and are created and published in one shot. They are indistinguishable from authored
  exams in this count.
* One exam row can carry N classes and M subjects via `exam_classes` and `exam_subjects`. Because a
  target is per teacher and not per class (decision 6), **count the exam row once**; never join
  either junction to count, or a multi-class exam is counted several times.
* `'ready'`, `'active'` and `'archived'` have no writer in the app. Do not offer them as filters.

### 3.2 Homework

```sql
SELECT count(*)
FROM homework_assignments h
WHERE h.created_by = <teacher_id>
  AND h.institution_id = <institution_id>
  AND h.status IN ('published','checked')
  AND (h.published_at AT TIME ZONE <institution timezone>)::date
      BETWEEN <period_start> AND <period_end>
```

`homework_assignments.status` is a TEXT CHECK, not an enum, with exactly three values:
`draft | published | checked`.

**`published_at` does not exist yet and must be added (decision 15).** `homework_assignments` has no
publication timestamp at all: publishing is a bare `status` UPDATE, and `created_at` is
draft-creation time. Without the new column, a homework drafted on 28 September and published on
3 October would count in September. The migration adds the column, sets it from a trigger on the
draft-to-published transition exactly as `exams` already does, and backfills existing rows to
`created_at` (the only value available; it is wrong for old long-lived drafts and that is accepted).

Known, accepted imprecision:

* `homework_auto_check_pass` sets `status='checked'` by cron for every `carries_marks=false` past-due
  assignment, leaving `evaluated_by` NULL. `'checked'` is included above because it is a *later*
  state than published, not because the cron did work. This does not distort a "published" count.
* Admins and coordinators can create homework, so `created_by` is not a teacher-only column. For a
  per-teacher target this is correct behaviour: it counts what that person created.
* `homework_assignments` has **no `class_id` column**; classes attach M:N through
  `homework_assignment_classes`. A class-scoped homework target is impossible from this table alone,
  which is one more reason decision 6 (per teacher, total) is the right unit.
* `subject_id` is `ON DELETE RESTRICT`, and `homework_assignments.academic_year` is `TEXT NOT NULL`
  while `exams` has no academic-year column at all. The two measures therefore **cannot share an
  academic-year filter**; the evaluator branches per metric.
* `created_by` is nullable, `ON DELETE SET NULL`, same history-loss caveat as exams.

### 3.3 Indexes

Neither source table has an index serving a dated per-teacher count. `exams` has six indexes, none
containing a timestamp; `homework_assignments` has seven, with no `created_at` and no
`(created_by, created_at)` composite. Because the exam date is a `COALESCE` expression, a plain
b-tree will not be used for it: an expression or partial index has to be designed deliberately.

Per CLAUDE.md §23 both new FKs and these supporting indexes land **in the same migration**.

---

## 4. Authority

| Actor | May create | Over whom |
|---|---|---|
| `school_admin`, `super_school_admin`, `super_admin` | wing targets and teacher targets | whole institution |
| `coordinator` | teacher targets, **only as children of a wing target they own** | teachers they name |
| `teacher` | nothing | reads their own only |

Eligible recipients are users holding the `teacher` or `coordinator` role (decision 7). This matters
because **three live definitions of "a teacher" disagree** and were measured within a day of each
other at 213 versus 265 people platform-wide:

* `class_assignments.role='teacher'` only (`compute_teacher_engagement_monthly`)
* `user_roles.role IN ('teacher','coordinator')` (the badge evaluator)
* `user_roles.role IN ('teacher','coordinator','employee')` (`dash_teachers_table`)

There is **no `institution_teacher_ids()`** equivalent to the canonical `institution_student_ids()`.
Whatever this feature defines becomes a fourth definition, so it is defined once, in one SECURITY
DEFINER helper, and every surface calls that helper.

Two constraints on that helper:

* `user_roles.institution_id` is **nullable**, and `has_role_at_institution` treats NULL as matching
  any institution. `profiles.institution_id` is nullable too and the two can disagree for one user.
  A single-table teacher list silently drops people.
* Filter `profiles.is_active IS NOT FALSE`. **A teacher leaving the school is a deactivation, not a
  deletion** (`UsersPage.tsx` flips `profiles.is_active`); the §21 delete cascade is the rare case.
  Without this filter a departed teacher sits in a target list forever and cannot log in to see it.

**A coordinator is not wing-bounded today and must be bounded explicitly here.** `set_class_teachers`
accepts `has_role(caller,'coordinator') AND get_user_institution(caller) = institution` as an
independent OR branch, so any coordinator can already rewrite any class's teacher list
institution-wide. Do not infer a wing bound from existing policy; write it into the RPC.

Do not use `is_coordinator_for_class` alone as the authority predicate: it checks neither the
coordinator role nor the institution nor whether the class is archived.

### 4.1 Write path

All writes go through SECURITY DEFINER RPCs, never client-side multi-row writes (CLAUDE.md §9a).
The shape to copy is `create_task_group`: authenticate the actor, validate **every** target row
before writing **any**, name blockers before writing, write in one transaction, return a summary.

* `create_wing_target(...)` -> admin only; resolves the named coordinator, checks they hold the
  coordinator role and a `wing_assignments` row for that wing.
* `split_wing_target(...)` -> the owning coordinator; writes N child teacher targets in one
  transaction. Allows an allocation under or over the pool (decision 14) and returns the gap.
* `create_teacher_targets(...)` -> admin; direct teacher targets with no parent.
* `stop_target(...)` -> sets `status='stopped'`. **Never deletes.** Closed periods must survive
  (decision 11).

Every one of these gets `REVOKE EXECUTE ... FROM anon` **by name** (CLAUDE.md §26; revoking from
PUBLIC does not strip Supabase's default grant). Every RLS UPDATE policy gets both `USING` and
`WITH CHECK`; a missing `WITH CHECK` silently rejected 100% of teachers' offline-marks saves for two
days in August 2026. RLS policies call SECURITY DEFINER helpers only, never inline cross-table
`EXISTS`, and wrap `(select auth.uid())`.

---

## 5. Surfaces

### 5.1 The entry button

Both target pages already render `PageShell > PageHeader`, so this is **one primitive, not two
bespoke headers**. `PageHeader` exposes an `extras` slot documented as *"rendered in the action
cluster, to the LEFT of the primary CTA on every breakpoint"*. That is the insertion point.

Do **not** use `secondaryActions`: it collapses into a kebab dropdown below `lg`.

`ExamsPage.tsx` serves **all four** exam routes (`/exams`, `/admin/exams`, `/school/exams`,
`/coordinator/exams`), so one insertion reaches every role. On `ExamsPage` the `extras` slot is
already occupied by the local `ScopeSwitcher` when `canSwitchScope` is true, so the new button
composes into a fragment beside it, as `TasksPage` already does.

Copy the button classes from the `TasksPage` header chip, with two corrections:

* **Swap `bg-surface-card` for `bg-white/85`.** `ScopeSwitcher` and the HomeworkPage filter triggers
  both use the literal `bg-white/85`. Using the token instead makes the new button flip in dark mode
  while its immediate neighbours do not.
* **Collapse the label under `sm`** (`<span className="hidden sm:inline">`), which is how both
  `ScopeSwitcher` and the TasksPage chip survive 375px. With the switcher icon-only at that width the
  row has roughly 115px of slack, so an icon-plus-short-label button fits, but a full label will not.
  The action cluster has **no `flex-wrap`** and `PageShell` sets `overflow-x-hidden`, so an overflow
  is **clipped and silently unreachable**, not scrollable.

Three traps confirmed by reading the files:

1. **`ExamsPage` returns `PageSkeleton` before `PageHeader` while loading**, and `PageSkeleton` draws
   only skeleton blocks. The button is absent for the whole scope query, which for a coordinator
   includes the wing-class resolve. Same pattern on HomeworkPage.
2. **A sidebar row added only to the coordinator branch is invisible to a teacher+coordinator**,
   because `shouldShowCoordinatorNav()` keys off `activeViewRole` and `viewRoles[0]` for that pair is
   `"teacher"`.
3. **A new `/school/*` route is bounced for Olympiad-only schools** by the `ProtectedRoute` allowlist,
   which permits only `/dashboard`, `/support`, the olympiad routes and `/settings*`.

### 5.2 Pages

* **Admin and coordinator page.** Create a target, pick a wing (then its coordinator) or named
  teachers, set the number, the window and the cadence. Lists live targets with progress, and closed
  targets with their period history. The wing view shows "34 of 40 allocated" when a split is short.
* **Teacher page.** Their own targets, live progress for the open period, and past periods after the
  deadline. This is the destination the notification links to.

`MobileTabs` for tab strips, `MobileSheet` for the create flow (not `Dialog`), `StatTile` for
numbers, `EmptyState` for empties, and **the error state renders before the empty state** (§6).
`HomeworkPage` currently destructures no `error` from its list query at all and goes loading ->
empty; do not copy that shape.

### 5.3 Notifications

`notifications` is `(user_id -> profiles CASCADE, type TEXT free-form, title, message, link TEXT,
is_read, metadata JSONB)`. `NotificationBell` routes by `n.link` with a single special case for
`type='message'`; everything else just navigates to `link`.

So the teacher-facing route must exist, be in `allowedRoles`, and be mapped in `FEATURE_URL_MAP`
**before** any notification is written. `ProtectedRoute` enforces roles and then `FEATURE_URL_MAP` by
exact pathname, so a link to an admin-only URL bounces the teacher to `/dashboard` with a toast.

Four notification events, all decided:

| Event | Goes to | Decision |
|---|---|---|
| A teacher target is created for you | the teacher | 8 |
| A wing target is handed to you | the named coordinator | 12 |
| A period closed short | the teacher | 10 |
| Your wing target is still undistributed | the coordinator | 12 |

The first two fire from the RPC that writes the row. The last two fire from the evaluator, so they
are stamped (`notified_at`) and never sent twice on a re-run.

---

## 6. Evaluator

One `pg_cron` job, one plain SECURITY DEFINER SQL function. Not an edge function: every
period-evaluation job that ships today is plain SQL under pg_cron, and an edge function would import
a 10s ceiling that SQL does not have.

Per institution, using `(now() AT TIME ZONE COALESCE(i.timezone,'Asia/Kolkata'))::date` as today
(CLAUDE.md §24; copy `compute_teacher_engagement_monthly`, **not**
`tt_run_attendance_pass_for_institution`, which declares `v_today DATE := CURRENT_DATE`):

1. For each `active` teacher target, compute which periods should exist up to today.
2. Upsert the open period. Recompute its `achieved_value`.
3. Close every period whose `period_end` has passed: set `met` or `missed`, stamp `closed_at`,
   freeze `achieved_value` and `target_value`.
4. Insert a notification for each newly `missed` period, stamp `notified_at`.
5. Mark a **teacher** target `completed` once `ends_on` has passed and its last period is closed.
   Mark a **wing** target `completed` once `ends_on` has passed; wing targets carry no period rows of
   their own, so there is nothing to close. A completed target of either kind is never deleted and
   stays fully readable (decision 11).

Idempotency uses `ON CONFLICT ON CONSTRAINT teacher_target_periods_target_period_key DO UPDATE`.
**Name the constraint.** A bare `ON CONFLICT DO NOTHING` fires on *any* unique index on the table,
which is why a partially-written row can be silently dropped by an unrelated constraint.

Scheduling notes: the 00:20 to 01:00 UTC band already holds five jobs in a deliberate order, so this
needs a chosen slot rather than a default. Register it with the **unschedule-then-schedule** guard;
the `SELECT cron.schedule(...) WHERE NOT EXISTS (...)` form never updates an existing job's
schedule, so a later edit to the cron expression is a no-op on prod.

Holidays are **not** subtracted. A target is a count of work produced over a wall-clock window, not a
school-day rate. This is deliberate: two incompatible definitions of "school day" already exist
(`award_player_of_the_month` subtracts only `cal_events kind='holiday'` and counts Sundays;
`get-working-days` subtracts holidays, exam blocks and weekends), and adopting either would make this
feature disagree with the other.

---

## 7. Infrastructure to build alongside

1. Feature id in `featuresData.ts`, and **both** the admin and teacher URLs in `FEATURE_URL_MAP`
   (an unmapped URL is treated as "always show").
2. Routes in `App.tsx`, lazy-loaded, with `ProtectedRoute` role gates.
3. Sidebar rows in `AppSidebar.tsx`, present in the teacher branch as well as the coordinator one.
4. A new `notifications.type` value plus a teacher-reachable link target.
5. Both new tables enrolled in `tg_audit_row`, which is a hand-written per-table `VALUES` list.
   **It currently carries only INSERT and DELETE.** Targets are the first feature here where *the
   edit is the contentious event* ("who changed the number from 4 to 2"), so an UPDATE arm is
   required, not optional.
6. New indexes on `exams` and `homework_assignments` for the dated per-teacher count (§3.3).
7. `published_at` on `homework_assignments`, its trigger, and its backfill (decision 15).
8. An entry in the settings living docs. Note that the docs currently list `topic_pacing_targets` as
   a live table; it was **dropped on 2026-04-18**. Anyone grepping the docs for "targets" finds a
   corpse.
9. `scripts/` verification SQL: confirm policies in `pg_policies`, absence of `anon` EXECUTE in
   `information_schema.routine_privileges`, and indexes in `pg_indexes` (the ledger is not
   maintained; never verify against `supabase_migrations.schema_migrations`).

---

## 8. Deliberately not built

* **No dashboard flag and no auto-task** (decision 10). Note that `dash_evaluate_flags` already
  contains a nag-the-teacher pipeline: it auto-creates a task plus a notification from any critical
  red flag and runs a red/amber/blue lifecycle. Targets deliberately do **not** ride it, to avoid two
  pipelines disagreeing about the same teacher on the same day.
* **No reconciliation with flag E7.** E7 ("a class has not had a test recently", 30 days, per class)
  will routinely disagree with a per-teacher target: a teacher can hit 4 exams while one of their
  classes gets none. Both are correct about different things. The Targets page must not present
  itself as answering E7's question.
* **No merge with the badge ladder.** `/achievements` already shows teachers progress toward a number
  on these same two measures, but badge thresholds are **lifetime and unfiltered by institution or
  date** while a target is windowed and institution-scoped. The same teacher will see "Homework Set
  3 of 5" and "Homework target 1 of 4" in one app. Label both so neither reads as the other.
* **No fix** to the forgeable `created_by` on `exams`, to `useSchoolExams` lacking `.range()`, or to
  `useTeacherDetailAnalytics` computing `examsCreated` with `.length` over an unbounded query. All
  three are pre-existing and out of scope, but the last one is a **fourth** definition of
  exams-per-teacher sitting on the very page an admin will open to check a target.

---

## 9. Verification before this is called done

* `npm run typecheck`, `npx eslint <changed>`, `npx vite build` all clean (§5a).
* Both pages at 375px and in dark mode, with the new button present and reachable.
* As a teacher JWT: the teacher page loads, shows only own targets, and the notification link
  resolves without bouncing to `/dashboard`.
* As a coordinator JWT: can split only wing targets they own; cannot create a target for a teacher
  outside their own allocation.
* Evaluator run twice in succession produces identical rows (idempotency).
* A closed period's `achieved_value` does **not** change after deleting a counted exam.
