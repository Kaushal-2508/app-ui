# Teacher Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin hand a coordinator a pooled numeric target for a wing, let the coordinator split it across teachers, measure it automatically against published exams and published homework over rolling periods, and keep every closed period readable after the deadline.

**Architecture:** Two new tables (`teacher_targets` for definitions, `teacher_target_periods` for the frozen ledger), a set of SECURITY DEFINER RPCs for every write, one nightly `pg_cron` evaluator that closes periods and notifies, and three frontend surfaces: a shared header button on two existing pages, an admin/coordinator management page, and a teacher page.

**Tech Stack:** Postgres 15 (Supabase), pg_cron, PostgREST, React 18 + TypeScript, Vite, TanStack Query v5, Tailwind + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-09-15-teacher-targets-design.md](../specs/2026-09-15-teacher-targets-design.md) — read it before Task 1. The plan argues from the spec; both travel together.

**Branch:** `feat/teacher-targets`, created from `main` at `64b79279`. Already checked out.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **THERE IS NO TEST RUNNER IN THIS REPO.** Zero test files; no vitest, jest, testing-library or playwright. Do not try to add one. "Write the failing test" means: for SQL, write a `DO $$ ... RAISE EXCEPTION 'FAIL: ...' $$` assertion script and run it; for frontend, run the §5a gate and check the page by hand.
- **The §5a gate, run on every task that touches `src/`:** `npm run typecheck`, then `npx eslint <changed paths>`, then `npx vite build`. All three must exit 0. Never bare `npx tsc --noEmit` — it is a no-op in this repo.
- `prefer-const` and `@typescript-eslint/no-explicit-any` are HARD errors. Never `eslint-disable`, never `as any`, never `: any`.
- **SQL is applied to prod with `powershell -File scripts/run-sql.ps1 -SqlFile <path>`.** Never `supabase db push`. The migration ledger `supabase_migrations.schema_migrations` is NOT maintained; verify against `pg_proc`, `pg_indexes`, `pg_policies`, `information_schema.routine_privileges`.
- **Every new SECURITY DEFINER function gets `REVOKE ALL ... FROM PUBLIC, anon` BY NAME**, then `GRANT EXECUTE ... TO authenticated` only where a client calls it. Revoking from PUBLIC does not strip Supabase's default `anon` grant. Exemplar to copy: `supabase/migrations/20260908130000_school_diary.sql:363-377`. Do **not** copy `20260708120000_syllabus_segments.sql:239-243`, which grants without revoking and is a live §26 violation.
- **Every new FK gets an index in the same migration.** Every RLS UPDATE policy carries BOTH `USING` and `WITH CHECK`. RLS policies call SECURITY DEFINER helpers only, never inline cross-table `EXISTS`, and wrap `(select auth.uid())`.
- **Institution-local dates only** (§24). Use `(now() AT TIME ZONE COALESCE(i.timezone,'Asia/Kolkata'))::date`. Never bare `now()::date` or `CURRENT_DATE`.
- **No em-dashes in user-facing text** (labels, toasts, empty states, notifications). Use "N/A", a comma, a colon, `·`, or "to". SQL comments and this document are exempt.
- **Error state renders BEFORE the empty state** (§6). Every `useQuery` destructures `error`. Every `onError` goes through `toastError(err, { fallback, context })` from `@/lib/toast`; never `toast.error(error.message)`.
- **Every `useQuery` sets an explicit `staleTime`** (≥ 60_000). Every list query has `.range()`. No `select("*")`. Aggregate server-side, never `.length` over fetched rows.
- **Exact object names, verified.** `exam_status` enum = `('draft','ready','published','active','completed','archived')`. `homework_assignments.status` is TEXT CHECK `('draft','published','checked')`. `class_assignments.subject_id` FKs `universal_subjects`, NOT `subjects`. The hybrid settings table is `hybrid_exam_settings`, not `hybrid_exam_config`.
- Commit after every task. Do not push until the whole plan is green.

---

## File Structure

**Database** (`supabase/migrations/`, applied in this order):

| File | Responsibility |
|---|---|
| `20260915120000_homework_published_at.sql` | Add `published_at` to `homework_assignments`, its trigger, backfill, index |
| `20260915120100_teacher_targets_schema.sql` | The two tables, constraints, indexes, RLS, eligibility helper |
| `20260915120200_teacher_targets_counters.sql` | Period math + the two counting functions + source-table indexes |
| `20260915120300_teacher_targets_write_rpcs.sql` | `create_wing_target`, `split_wing_target`, `create_teacher_targets`, `stop_target` |
| `20260915120400_teacher_targets_read_rpcs.sql` | `tt_targets_for_admin`, `tt_targets_for_coordinator`, `tt_targets_for_teacher` |
| `20260915120500_teacher_targets_evaluator.sql` | `tt_evaluate_targets()` + pg_cron registration |
| `20260915120600_teacher_targets_audit.sql` | Enrol both tables in `tg_audit_row`, add the UPDATE arm |

**Verification** (`scripts/teacher-targets/`), mirroring the `scripts/ptm-notifications/` convention:
`verify-01-homework-published-at.sql` … `verify-07-audit.sql`

**Frontend:**

| File | Responsibility |
|---|---|
| `src/lib/targetPeriods.ts` | Pure rolling-period math for UI preview. No I/O. |
| `src/hooks/useTeacherTargets.ts` | Every query and mutation for targets |
| `src/components/targets/TargetsHeaderButton.tsx` | The shared header button, used by both pages |
| `src/components/targets/CreateTargetSheet.tsx` | Create flow (MobileSheet) |
| `src/components/targets/TargetProgressCard.tsx` | One target with its progress |
| `src/components/targets/SplitPoolSheet.tsx` | Coordinator's pool split |
| `src/pages/school/TeacherTargetsPage.tsx` | Admin + coordinator management page |
| `src/pages/teacher/MyTargetsPage.tsx` | Teacher page, notification destination |

**Modified:** `src/pages/ExamsPage.tsx`, `src/pages/HomeworkPage.tsx`, `src/App.tsx`, `src/components/layout/AppSidebar.tsx`, `src/components/admin/institution-wizard/featuresData.ts`, `src/integrations/supabase/types.ts` (regenerated).

---

## Task 1: `published_at` on homework_assignments

Homework has no publication timestamp; publishing is a bare `status` UPDATE and `created_at` is
draft-creation time. Without this column a homework drafted 28 Sep and published 3 Oct counts in
September. Spec decision 15.

**Files:**
- Create: `supabase/migrations/20260915120000_homework_published_at.sql`
- Create: `scripts/teacher-targets/verify-01-homework-published-at.sql`

**Interfaces:**
- Produces: `homework_assignments.published_at timestamptz NULL`; trigger `set_homework_published_at`.

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/teacher-targets/verify-01-homework-published-at.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='homework_assignments'
                    AND column_name='published_at') THEN
    RAISE EXCEPTION 'FAIL: homework_assignments.published_at is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='set_homework_published_at' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: trigger set_homework_published_at is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND tablename='homework_assignments'
                    AND indexname='idx_homework_assignments_creator_published') THEN
    RAISE EXCEPTION 'FAIL: idx_homework_assignments_creator_published is missing';
  END IF;
  -- every already-published row must have been backfilled
  IF EXISTS (SELECT 1 FROM public.homework_assignments
              WHERE status IN ('published','checked') AND published_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: % published/checked rows still have NULL published_at',
      (SELECT count(*) FROM public.homework_assignments
        WHERE status IN ('published','checked') AND published_at IS NULL);
  END IF;
  -- a draft must NOT have one
  IF EXISTS (SELECT 1 FROM public.homework_assignments
              WHERE status='draft' AND published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: draft rows carry a published_at';
  END IF;
  RAISE NOTICE 'PASS: verify-01 homework published_at';
END $$;
```

- [ ] **Step 2: Run it and confirm it fails**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-01-homework-published-at.sql
```
Expected: `FAIL: homework_assignments.published_at is missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915120000_homework_published_at.sql`:

```sql
-- Teacher Targets, part 1 of 7: give homework a publication timestamp.
--
-- WHY. homework_assignments has no published_at. Publishing is a bare status
-- UPDATE (src/hooks/useHomeworkSave.ts), and created_at is DRAFT-creation time.
-- A homework drafted on 28 Sep and published on 3 Oct would be counted into
-- September by any date window. exams already solves this: published_at is
-- written by validate_exam_status_transition on the status change. This is the
-- same shape for homework.
--
-- BACKFILL HONESTY. Existing rows are backfilled to created_at because that is
-- the only timestamp that exists. For a row that sat as a draft for weeks the
-- backfilled value is wrong, and nothing can recover the true date. New rows
-- are correct from here on.

ALTER TABLE public.homework_assignments
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Fires only on the transition INTO a published state, so re-saving a
-- published row never moves the date. Mirrors validate_exam_status_transition.
CREATE OR REPLACE FUNCTION public.tg_set_homework_published_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status IN ('published','checked') AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  -- Going back to draft clears it, so a re-publish re-stamps honestly.
  IF NEW.status = 'draft' THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS set_homework_published_at ON public.homework_assignments;
CREATE TRIGGER set_homework_published_at
  BEFORE INSERT OR UPDATE OF status ON public.homework_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_homework_published_at();

UPDATE public.homework_assignments
SET published_at = created_at
WHERE status IN ('published','checked') AND published_at IS NULL;

-- Serves tt_count_homework_published (Task 3). published_at is indexed RAW, not
-- cast: the counter compares it against a timestamptz range so the index is
-- usable. A (published_at AT TIME ZONE tz)::date expression index is impossible
-- anyway, because timestamptz::date is STABLE, not IMMUTABLE.
CREATE INDEX IF NOT EXISTS idx_homework_assignments_creator_published
  ON public.homework_assignments (created_by, published_at)
  WHERE status IN ('published','checked');

COMMENT ON COLUMN public.homework_assignments.published_at IS
  'When this homework first reached students. Written by set_homework_published_at on the transition into published/checked; cleared on a return to draft. Rows predating 2026-09-15 were backfilled to created_at, which is draft-creation time and is wrong for long-lived drafts.';
```

- [ ] **Step 4: Apply it and confirm the assertions pass**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915120000_homework_published_at.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-01-homework-published-at.sql
```
Expected: `PASS: verify-01 homework published_at`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915120000_homework_published_at.sql scripts/teacher-targets/verify-01-homework-published-at.sql
git commit -m "feat(targets): give homework a real publication timestamp"
```

---

## Task 2: The two tables, RLS, and the eligibility helper

**Files:**
- Create: `supabase/migrations/20260915120100_teacher_targets_schema.sql`
- Create: `scripts/teacher-targets/verify-02-schema.sql`

**Interfaces:**
- Produces: tables `teacher_targets`, `teacher_target_periods`; helpers
  `tt_target_eligible(_user uuid, _institution uuid) -> boolean`,
  `tt_can_manage_targets(_user uuid, _institution uuid) -> boolean`,
  `tt_owns_target(_user uuid, _target uuid) -> boolean`.

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/teacher-targets/verify-02-schema.sql`:

```sql
DO $$
DECLARE v_missing text;
BEGIN
  IF to_regclass('public.teacher_targets') IS NULL THEN
    RAISE EXCEPTION 'FAIL: table teacher_targets is missing';
  END IF;
  IF to_regclass('public.teacher_target_periods') IS NULL THEN
    RAISE EXCEPTION 'FAIL: table teacher_target_periods is missing';
  END IF;

  -- every FK must have an index (CLAUDE.md 23)
  FOR v_missing IN
    SELECT 'teacher_targets.' || c
    FROM unnest(ARRAY['institution_id','wing_id','owner_id','parent_target_id','assigned_by']) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_indexes
                       WHERE schemaname='public' AND tablename='teacher_targets'
                         AND indexdef ILIKE '%(' || c || '%')
  LOOP
    RAISE EXCEPTION 'FAIL: no index on %', v_missing;
  END LOOP;
  FOR v_missing IN
    SELECT 'teacher_target_periods.' || c
    FROM unnest(ARRAY['target_id','institution_id','teacher_id']) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_indexes
                       WHERE schemaname='public' AND tablename='teacher_target_periods'
                         AND indexdef ILIKE '%(' || c || '%')
  LOOP
    RAISE EXCEPTION 'FAIL: no index on %', v_missing;
  END LOOP;

  -- the ledger's uniqueness must be a real CONSTRAINT, so ON CONFLICT can name it
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='teacher_target_periods_target_period_key' AND contype='u') THEN
    RAISE EXCEPTION 'FAIL: named UNIQUE constraint on (target_id, period_index) is missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.teacher_targets'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on teacher_targets';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.teacher_target_periods'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on teacher_target_periods';
  END IF;

  -- every UPDATE policy needs BOTH USING and WITH CHECK (CLAUDE.md 26)
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename IN ('teacher_targets','teacher_target_periods')
                AND cmd='UPDATE' AND with_check IS NULL) THEN
    RAISE EXCEPTION 'FAIL: an UPDATE policy is missing WITH CHECK';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee IN ('anon','PUBLIC')
                AND routine_name IN ('tt_target_eligible','tt_can_manage_targets','tt_owns_target')) THEN
    RAISE EXCEPTION 'FAIL: anon or PUBLIC still holds EXECUTE on a tt_ helper';
  END IF;

  -- the shape rules must be enforced by the database, not by convention
  BEGIN
    INSERT INTO public.teacher_targets
      (institution_id, metric, scope, owner_id, target_value, starts_on, ends_on)
    SELECT i.id, 'exams_published', 'wing', p.id, 5, '2026-01-01', '2026-01-31'
    FROM public.institutions i, public.profiles p WHERE p.institution_id = i.id LIMIT 1;
    RAISE EXCEPTION 'FAIL: a wing-scoped row was accepted with a NULL wing_id';
  EXCEPTION
    WHEN check_violation THEN NULL;   -- correct
    WHEN raise_exception THEN RAISE;
  END;

  RAISE NOTICE 'PASS: verify-02 schema';
END $$;
```

- [ ] **Step 2: Run it and confirm it fails**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-02-schema.sql
```
Expected: `FAIL: table teacher_targets is missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915120100_teacher_targets_schema.sql`:

```sql
-- Teacher Targets, part 2 of 7: the two tables.
--
-- SHAPE. teacher_targets holds BOTH the wing pool (scope='wing', owned by one
-- named coordinator) and the per-teacher targets (scope='teacher'), linked by
-- parent_target_id. teacher_target_periods is the frozen ledger and exists ONLY
-- for scope='teacher' rows; a wing's number is a SUM over its children, never a
-- second stored copy.
--
-- WHY THE LEDGER FREEZES. Both source tables hard-delete with no tombstone:
-- exams has no deleted_at and exam delete is a plain DELETE; homework_delete
-- cascades and writes no audit row. A live count therefore lets September's
-- number change in November. Freezing target_value and achieved_value at period
-- close is the only way "check it after the deadline" stays true.
--
-- WHY A WING DOES NOT FAN OUT TO TEACHERS. There is no helper anywhere that maps
-- a wing to its teachers, and TWO rival shipped derivations disagree: the class
-- path (wing_class_mappings -> classes -> class_assignments) used by WingsPage
-- and coordinator_covers_task, versus direct membership (wing_assignments) used
-- by dash_teachers_table and notice_expand_audience. The admin targets one named
-- coordinator instead, so neither is needed.

CREATE TABLE IF NOT EXISTS public.teacher_targets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  metric           TEXT NOT NULL CHECK (metric IN ('exams_published','homework_published')),
  scope            TEXT NOT NULL CHECK (scope IN ('wing','teacher')),
  wing_id          UUID REFERENCES public.wings(id) ON DELETE CASCADE,
  owner_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_target_id UUID REFERENCES public.teacher_targets(id) ON DELETE CASCADE,
  target_value     INTEGER NOT NULL CHECK (target_value > 0),
  starts_on        DATE NOT NULL,
  ends_on          DATE NOT NULL,
  cadence_unit     TEXT CHECK (cadence_unit IN ('day','week','month')),
  cadence_n        INTEGER CHECK (cadence_n > 0),
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','stopped','completed')),
  note             TEXT,
  assigned_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT teacher_targets_dates_chk   CHECK (ends_on >= starts_on),
  CONSTRAINT teacher_targets_wing_chk    CHECK (
    (scope = 'wing'    AND wing_id IS NOT NULL AND parent_target_id IS NULL) OR
    (scope = 'teacher' AND wing_id IS NULL)
  ),
  CONSTRAINT teacher_targets_cadence_chk CHECK (
    (cadence_unit IS NULL AND cadence_n IS NULL) OR
    (cadence_unit IS NOT NULL AND cadence_n IS NOT NULL)
  )
);

-- FK indexes, all five, in this migration (CLAUDE.md 23).
CREATE INDEX IF NOT EXISTS idx_teacher_targets_institution ON public.teacher_targets (institution_id);
CREATE INDEX IF NOT EXISTS idx_teacher_targets_wing        ON public.teacher_targets (wing_id);
CREATE INDEX IF NOT EXISTS idx_teacher_targets_owner       ON public.teacher_targets (owner_id);
CREATE INDEX IF NOT EXISTS idx_teacher_targets_parent      ON public.teacher_targets (parent_target_id);
CREATE INDEX IF NOT EXISTS idx_teacher_targets_assigned_by ON public.teacher_targets (assigned_by);
-- Query index: the evaluator sweeps active targets per institution.
CREATE INDEX IF NOT EXISTS idx_teacher_targets_inst_status ON public.teacher_targets (institution_id, status);

CREATE TABLE IF NOT EXISTS public.teacher_target_periods (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id      UUID NOT NULL REFERENCES public.teacher_targets(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  teacher_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_index   INTEGER NOT NULL CHECK (period_index > 0),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  target_value   INTEGER NOT NULL,
  achieved_value INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','met','missed')),
  closed_at      TIMESTAMPTZ,
  notified_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- NAMED so ON CONFLICT can reference it explicitly. A bare ON CONFLICT DO
  -- NOTHING fires on ANY unique index on the table, which silently drops rows.
  CONSTRAINT teacher_target_periods_target_period_key UNIQUE (target_id, period_index)
);

CREATE INDEX IF NOT EXISTS idx_ttp_target      ON public.teacher_target_periods (target_id);
CREATE INDEX IF NOT EXISTS idx_ttp_institution ON public.teacher_target_periods (institution_id);
CREATE INDEX IF NOT EXISTS idx_ttp_teacher     ON public.teacher_target_periods (teacher_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_ttp_open        ON public.teacher_target_periods (target_id) WHERE status = 'open';

-- ── Helpers. RLS calls these; it never inlines a cross-table EXISTS. ────────

-- Who may RECEIVE a target: teacher or coordinator role, active, same school.
-- This is a FOURTH definition of "a teacher" in this repo (the engagement engine
-- uses class_assignments only; the badge evaluator uses teacher+coordinator;
-- dash_teachers_table adds employee). It is defined ONCE, here, and every
-- surface calls it. profiles.is_active IS NOT FALSE matters: a teacher leaving
-- is a DEACTIVATION, not a delete.
CREATE OR REPLACE FUNCTION public.tt_target_eligible(_user uuid, _institution uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user
      AND ur.role IN ('teacher','coordinator')
      AND p.institution_id = _institution
      AND p.is_active IS NOT FALSE
  )
$fn$;

-- Who may CREATE targets at all.
CREATE OR REPLACE FUNCTION public.tt_can_manage_targets(_user uuid, _institution uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user
      AND ur.role IN ('school_admin','super_school_admin','super_admin','coordinator')
  ) AND public.get_user_institution(_user) = _institution
$fn$;

-- Owner of a target, or the owner of its parent pool.
CREATE OR REPLACE FUNCTION public.tt_owns_target(_user uuid, _target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_targets t
    LEFT JOIN public.teacher_targets par ON par.id = t.parent_target_id
    WHERE t.id = _target
      AND (t.owner_id = _user OR par.owner_id = _user OR t.assigned_by = _user)
  )
$fn$;

ALTER TABLE public.teacher_targets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_target_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teacher_targets_select ON public.teacher_targets;
CREATE POLICY teacher_targets_select ON public.teacher_targets
  FOR SELECT TO authenticated
  USING (
    owner_id = (select auth.uid())
    OR public.tt_owns_target((select auth.uid()), id)
    OR public.tt_can_manage_targets((select auth.uid()), institution_id)
  );

-- Writes go through the RPCs in Task 4, which are SECURITY DEFINER and bypass
-- these. The policies exist so admin tooling and PostgREST reads behave, and so
-- a direct client write cannot forge a target.
DROP POLICY IF EXISTS teacher_targets_update ON public.teacher_targets;
CREATE POLICY teacher_targets_update ON public.teacher_targets
  FOR UPDATE TO authenticated
  USING      (public.tt_can_manage_targets((select auth.uid()), institution_id))
  WITH CHECK (public.tt_can_manage_targets((select auth.uid()), institution_id));

DROP POLICY IF EXISTS teacher_target_periods_select ON public.teacher_target_periods;
CREATE POLICY teacher_target_periods_select ON public.teacher_target_periods
  FOR SELECT TO authenticated
  USING (
    teacher_id = (select auth.uid())
    OR public.tt_owns_target((select auth.uid()), target_id)
    OR public.tt_can_manage_targets((select auth.uid()), institution_id)
  );

REVOKE ALL ON FUNCTION public.tt_target_eligible(uuid, uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_can_manage_targets(uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_owns_target(uuid, uuid)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_target_eligible(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.tt_can_manage_targets(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tt_owns_target(uuid, uuid)        TO authenticated;

REVOKE ALL ON TABLE public.teacher_targets        FROM anon;
REVOKE ALL ON TABLE public.teacher_target_periods FROM anon;
```

- [ ] **Step 4: Apply and confirm the assertions pass**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915120100_teacher_targets_schema.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-02-schema.sql
```
Expected: `PASS: verify-02 schema`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915120100_teacher_targets_schema.sql scripts/teacher-targets/verify-02-schema.sql
git commit -m "feat(targets): teacher_targets and the frozen period ledger"
```

---

## Task 3: Period math and the two counters

**Files:**
- Create: `supabase/migrations/20260915120200_teacher_targets_counters.sql`
- Create: `scripts/teacher-targets/verify-03-counters.sql`

**Interfaces:**
- Consumes: `homework_assignments.published_at` (Task 1).
- Produces:
  `tt_target_interval(_unit text, _n integer) -> interval`;
  `tt_target_periods(_starts_on date, _ends_on date, _unit text, _n integer, _upto date) -> TABLE(period_index integer, period_start date, period_end date)`;
  `tt_count_exams_published(_teacher uuid, _institution uuid, _from date, _to date) -> integer`;
  `tt_count_homework_published(_teacher uuid, _institution uuid, _from date, _to date, _tz text) -> integer`.

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/teacher-targets/verify-03-counters.sql`:

```sql
DO $$
DECLARE r record; n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                  WHERE ns.nspname='public' AND p.proname='tt_target_periods') THEN
    RAISE EXCEPTION 'FAIL: tt_target_periods is missing';
  END IF;

  -- Rolling from day 1: weekly from 15 Sep gives 15-21, 22-28, ...
  SELECT count(*) INTO n
  FROM public.tt_target_periods('2026-09-15','2026-10-12','week',1,'2026-10-12');
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL: weekly 15 Sep to 12 Oct gave % periods, expected 4', n; END IF;

  SELECT * INTO r FROM public.tt_target_periods('2026-09-15','2026-10-12','week',1,'2026-10-12')
   WHERE period_index = 1;
  IF r.period_start <> DATE '2026-09-15' OR r.period_end <> DATE '2026-09-21' THEN
    RAISE EXCEPTION 'FAIL: period 1 was % to %, expected 2026-09-15 to 2026-09-21',
      r.period_start, r.period_end;
  END IF;

  -- 15-day cadence is the case no calendar-aligned engine can express.
  SELECT * INTO r FROM public.tt_target_periods('2026-09-15','2026-10-14','day',15,'2026-10-14')
   WHERE period_index = 2;
  IF r.period_start <> DATE '2026-09-30' THEN
    RAISE EXCEPTION 'FAIL: 15-day period 2 started %, expected 2026-09-30', r.period_start;
  END IF;

  -- The final period is CLIPPED at ends_on, never allowed to run past it.
  SELECT max(period_end) INTO r FROM public.tt_target_periods('2026-09-15','2026-10-10','month',1,'2026-12-31');
  IF r.max > DATE '2026-10-10' THEN
    RAISE EXCEPTION 'FAIL: last period ran past ends_on';
  END IF;

  -- A one-off (no cadence) is exactly one period spanning the whole range.
  SELECT count(*) INTO n FROM public.tt_target_periods('2026-09-01','2026-09-30',NULL,NULL,'2026-09-30');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: one-off gave % periods, expected 1', n; END IF;

  -- Nothing may be executable by anon.
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee IN ('anon','PUBLIC')
                AND routine_name LIKE 'tt_%') THEN
    RAISE EXCEPTION 'FAIL: anon or PUBLIC holds EXECUTE on a tt_ function';
  END IF;

  RAISE NOTICE 'PASS: verify-03 counters';
END $$;
```

- [ ] **Step 2: Run it and confirm it fails**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-03-counters.sql
```
Expected: `FAIL: tt_target_periods is missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915120200_teacher_targets_counters.sql`:

```sql
-- Teacher Targets, part 3 of 7: rolling period math and the two counters.
--
-- ROLLING, NOT CALENDAR ALIGNED. Nothing in this repo computes a rolling window
-- of N units from an anchor date; every existing engine is calendar-aligned
-- ('YYYY-MM') or a trailing offset from now(). In particular dash_range_window
-- accepts only five month-granular tokens and SILENTLY FALLS BACK to '3m' on an
-- unrecognised one, so it must never be used here.

CREATE OR REPLACE FUNCTION public.tt_target_interval(_unit text, _n integer)
RETURNS interval
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE _unit
           WHEN 'day'   THEN make_interval(days   => _n)
           WHEN 'week'  THEN make_interval(weeks  => _n)
           WHEN 'month' THEN make_interval(months => _n)
         END
$fn$;

-- Period k runs from starts_on + (k-1)*interval to the day before
-- starts_on + k*interval, clipped at ends_on. Postgres month arithmetic already
-- clamps correctly (31 Jan + 1 month = 28 Feb).
CREATE OR REPLACE FUNCTION public.tt_target_periods(
  _starts_on date, _ends_on date, _unit text, _n integer, _upto date
)
RETURNS TABLE (period_index integer, period_start date, period_end date)
LANGUAGE plpgsql IMMUTABLE
AS $fn$
DECLARE
  v_iv interval;
  v_i  integer := 1;
  v_s  date;
BEGIN
  IF _unit IS NULL OR _n IS NULL THEN
    IF _starts_on <= _upto THEN
      period_index := 1; period_start := _starts_on; period_end := _ends_on;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  v_iv := public.tt_target_interval(_unit, _n);
  LOOP
    v_s := (_starts_on + (v_i - 1) * v_iv)::date;
    EXIT WHEN v_s > _ends_on OR v_s > _upto;
    period_index := v_i;
    period_start := v_s;
    period_end   := LEAST((_starts_on + v_i * v_iv)::date - 1, _ends_on);
    RETURN NEXT;
    v_i := v_i + 1;
    EXIT WHEN v_i > 500;   -- a target cannot sanely have more than 500 periods
  END LOOP;
END $fn$;

-- EXAMS. status IN ('published','active','completed') is the exams_published
-- predicate; 'archived' is deliberately excluded. The date chain
-- COALESCE(published_at, scheduled_date, created_at) is the one every dash_* and
-- school_analytics_* RPC uses. TWO RIVAL CHAINS are live in prod (the
-- achievements evaluator puts scheduled_date first; the flag evaluator omits
-- published_at). Using a different one makes the same teacher's September read
-- two different numbers on two screens. Do not "improve" it.
--
-- No expression index backs this: timestamptz::date is STABLE, not IMMUTABLE, so
-- Postgres refuses an index on the COALESCE. The (created_by, status) index below
-- narrows to the teacher and the date is a heap filter, which is fine at
-- per-teacher cardinality.
CREATE OR REPLACE FUNCTION public.tt_count_exams_published(
  _teacher uuid, _institution uuid, _from date, _to date
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT count(*)::int
  FROM public.exams e
  WHERE e.created_by     = _teacher
    AND e.institution_id = _institution
    AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
        BETWEEN _from AND _to
$fn$;

-- HOMEWORK. Compares published_at against a timestamptz RANGE rather than
-- casting the column, so idx_homework_assignments_creator_published is usable.
-- The range is built from the institution-local calendar day (CLAUDE.md 24).
CREATE OR REPLACE FUNCTION public.tt_count_homework_published(
  _teacher uuid, _institution uuid, _from date, _to date, _tz text
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT count(*)::int
  FROM public.homework_assignments h
  WHERE h.created_by     = _teacher
    AND h.institution_id = _institution
    AND h.status IN ('published','checked')
    AND h.published_at IS NOT NULL
    AND h.published_at >= (_from::timestamp        AT TIME ZONE COALESCE(_tz,'Asia/Kolkata'))
    AND h.published_at <  ((_to + 1)::timestamp    AT TIME ZONE COALESCE(_tz,'Asia/Kolkata'))
$fn$;

-- Narrows the exam count to one teacher's published papers.
CREATE INDEX IF NOT EXISTS idx_exams_created_by_status
  ON public.exams (created_by, status);

REVOKE ALL ON FUNCTION public.tt_target_interval(text, integer)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_target_periods(date, date, text, integer, date)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_count_exams_published(uuid, uuid, date, date)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_count_homework_published(uuid, uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_target_periods(date, date, text, integer, date) TO authenticated;
```

- [ ] **Step 4: Apply and confirm the assertions pass**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915120200_teacher_targets_counters.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-03-counters.sql
```
Expected: `PASS: verify-03 counters`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915120200_teacher_targets_counters.sql scripts/teacher-targets/verify-03-counters.sql
git commit -m "feat(targets): rolling period math and the exam and homework counters"
```

---

## Task 4: The write RPCs

Every write is one transaction that validates all rows before writing any (CLAUDE.md §9a). Shape
copied from `create_task_group`.

**Files:**
- Create: `supabase/migrations/20260915120300_teacher_targets_write_rpcs.sql`
- Create: `scripts/teacher-targets/verify-04-write-rpcs.sql`

**Interfaces:**
- Consumes: `tt_target_eligible`, `tt_can_manage_targets`, `tt_owns_target` (Task 2).
- Produces:
  `tt_create_wing_target(_wing_id uuid, _coordinator_id uuid, _metric text, _target_value integer, _starts_on date, _ends_on date, _cadence_unit text, _cadence_n integer, _note text) -> jsonb`;
  `tt_split_wing_target(_parent_id uuid, _allocations jsonb) -> jsonb` where `_allocations` is `[{"teacher_id":"…","value":10}, …]`;
  `tt_create_teacher_targets(_metric text, _target_value integer, _starts_on date, _ends_on date, _cadence_unit text, _cadence_n integer, _teacher_ids uuid[], _note text) -> jsonb`;
  `tt_stop_target(_target_id uuid) -> jsonb`.

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/teacher-targets/verify-04-write-rpcs.sql`:

```sql
DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['tt_create_wing_target','tt_split_wing_target',
                              'tt_create_teacher_targets','tt_stop_target'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname=v_fn) THEN
      RAISE EXCEPTION 'FAIL: % is missing', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname=v_fn AND p.prosecdef) THEN
      RAISE EXCEPTION 'FAIL: % is not SECURITY DEFINER', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
                WHERE routine_schema='public' AND routine_name=v_fn
                  AND grantee IN ('anon','PUBLIC')) THEN
      RAISE EXCEPTION 'FAIL: anon or PUBLIC holds EXECUTE on %', v_fn;
    END IF;
  END LOOP;

  -- An unauthenticated caller must be refused, not silently no-op.
  BEGIN
    PERFORM public.tt_stop_target('00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION 'FAIL: tt_stop_target accepted a NULL auth.uid()';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;   -- our own assertion
  END;

  RAISE NOTICE 'PASS: verify-04 write rpcs';
END $$;
```

- [ ] **Step 2: Run it and confirm it fails**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-04-write-rpcs.sql
```
Expected: `FAIL: tt_create_wing_target is missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915120300_teacher_targets_write_rpcs.sql`:

```sql
-- Teacher Targets, part 4 of 7: every write path.
--
-- CLAUDE.md 9a: client code never writes these tables directly and never does
-- two dependent writes as separate calls. Each function below validates EVERY
-- row before writing ANY, and names the blocker rather than writing a partial
-- set. Shape copied from create_task_group.
--
-- A COORDINATOR IS NOT WING-BOUNDED BY EXISTING POLICY. set_class_teachers
-- accepts has_role(caller,'coordinator') AND same-institution as an independent
-- OR branch, so any coordinator can already rewrite any class institution-wide.
-- The wing bound here is written explicitly; it is NOT inherited.

CREATE OR REPLACE FUNCTION public.tt_create_wing_target(
  _wing_id        uuid,
  _coordinator_id uuid,
  _metric         text,
  _target_value   integer,
  _starts_on      date,
  _ends_on        date,
  _cadence_unit   text DEFAULT NULL,
  _cadence_n      integer DEFAULT NULL,
  _note           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_inst  uuid;
  v_id    uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;

  SELECT w.institution_id INTO v_inst FROM public.wings w WHERE w.id = _wing_id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'targets: that wing does not exist'; END IF;

  -- Only an ADMIN may create a wing pool. A coordinator receives one, and splits it.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = v_actor
                    AND ur.role IN ('school_admin','super_school_admin','super_admin')) THEN
    RAISE EXCEPTION 'targets: only an administrator can set a wing target';
  END IF;
  IF public.get_user_institution(v_actor) <> v_inst THEN
    RAISE EXCEPTION 'targets: that wing belongs to another school';
  END IF;

  -- The named coordinator must actually coordinate THIS wing.
  IF NOT EXISTS (SELECT 1 FROM public.wing_assignments wa
                  WHERE wa.wing_id = _wing_id AND wa.user_id = _coordinator_id) THEN
    RAISE EXCEPTION 'targets: that person is not assigned to this wing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = _coordinator_id AND ur.role = 'coordinator') THEN
    RAISE EXCEPTION 'targets: a wing target can only go to a coordinator';
  END IF;

  INSERT INTO public.teacher_targets
    (institution_id, metric, scope, wing_id, owner_id, target_value,
     starts_on, ends_on, cadence_unit, cadence_n, note, assigned_by)
  VALUES
    (v_inst, _metric, 'wing', _wing_id, _coordinator_id, _target_value,
     _starts_on, _ends_on, _cadence_unit, _cadence_n, _note, v_actor)
  RETURNING id INTO v_id;

  -- Decision 12: the coordinator is told the pool has landed.
  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  VALUES (_coordinator_id, 'target_assigned',
          'New wing target',
          'You have a new wing target to share out with your teachers.',
          '/school/teacher-targets',
          jsonb_build_object('target_id', v_id, 'scope', 'wing', 'metric', _metric));

  RETURN jsonb_build_object('ok', true, 'target_id', v_id);
END $fn$;

-- The coordinator splits the pool. Children INHERIT metric, window and cadence
-- from the parent and may not change them: if a child ran on a different window
-- from its pool, "34 of 40 allocated" would compare numbers measured over
-- different spans and the gap shown to the admin would be meaningless.
-- Decision 14: an allocation that does not add up is ALLOWED; the gap is returned.
CREATE OR REPLACE FUNCTION public.tt_split_wing_target(
  _parent_id uuid, _allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor  uuid := auth.uid();
  v_parent public.teacher_targets%ROWTYPE;
  v_item   jsonb;
  v_tid    uuid;
  v_val    integer;
  v_total  integer := 0;
  v_n      integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;

  SELECT * INTO v_parent FROM public.teacher_targets WHERE id = _parent_id;
  IF v_parent.id IS NULL THEN RAISE EXCEPTION 'targets: that target does not exist'; END IF;
  IF v_parent.scope <> 'wing' THEN RAISE EXCEPTION 'targets: only a wing target can be shared out'; END IF;
  IF v_parent.owner_id <> v_actor THEN RAISE EXCEPTION 'targets: only the coordinator who owns this target can share it out'; END IF;
  IF v_parent.status <> 'active' THEN RAISE EXCEPTION 'targets: this target is no longer active'; END IF;

  -- Validate EVERY allocation before writing ANY.
  FOR v_item IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_tid := (v_item ->> 'teacher_id')::uuid;
    v_val := (v_item ->> 'value')::integer;
    IF v_val IS NULL OR v_val <= 0 THEN
      RAISE EXCEPTION 'targets: every teacher needs a number above zero';
    END IF;
    IF NOT public.tt_target_eligible(v_tid, v_parent.institution_id) THEN
      RAISE EXCEPTION 'targets: % cannot be given a target',
        COALESCE((SELECT full_name FROM public.profiles WHERE id = v_tid), 'that person');
    END IF;
    v_total := v_total + v_val;
    v_n := v_n + 1;
  END LOOP;

  -- Replace the previous allocation wholesale, but ONLY rows with no closed
  -- period yet: a teacher who has already been measured keeps their history
  -- (decision 13, and the ledger must stay reproducible).
  DELETE FROM public.teacher_targets c
  WHERE c.parent_target_id = _parent_id
    AND NOT EXISTS (SELECT 1 FROM public.teacher_target_periods p
                     WHERE p.target_id = c.id AND p.status <> 'open');

  FOR v_item IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_tid := (v_item ->> 'teacher_id')::uuid;
    v_val := (v_item ->> 'value')::integer;
    INSERT INTO public.teacher_targets
      (institution_id, metric, scope, owner_id, parent_target_id, target_value,
       starts_on, ends_on, cadence_unit, cadence_n, assigned_by)
    VALUES
      (v_parent.institution_id, v_parent.metric, 'teacher', v_tid, _parent_id, v_val,
       v_parent.starts_on, v_parent.ends_on, v_parent.cadence_unit, v_parent.cadence_n, v_actor)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (v_tid, 'target_assigned',
            'You have a new target',
            'A new target has been set for you. Open My Targets to see it.',
            '/teacher/my-targets',
            jsonb_build_object('target_id', _parent_id, 'scope', 'teacher',
                               'metric', v_parent.metric, 'value', v_val));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'teachers', v_n, 'allocated', v_total,
    'pool', v_parent.target_value, 'gap', v_parent.target_value - v_total);
END $fn$;

-- Admin assigns straight to named teachers, no wing involved.
CREATE OR REPLACE FUNCTION public.tt_create_teacher_targets(
  _metric       text,
  _target_value integer,
  _starts_on    date,
  _ends_on      date,
  _teacher_ids  uuid[],
  _cadence_unit text DEFAULT NULL,
  _cadence_n    integer DEFAULT NULL,
  _note         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_inst  uuid;
  v_tid   uuid;
  v_n     integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_actor);
  IF v_inst IS NULL THEN RAISE EXCEPTION 'targets: no school context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = v_actor
                    AND ur.role IN ('school_admin','super_school_admin','super_admin')) THEN
    RAISE EXCEPTION 'targets: only an administrator can assign a target directly';
  END IF;
  IF _teacher_ids IS NULL OR array_length(_teacher_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'targets: pick at least one teacher';
  END IF;

  FOREACH v_tid IN ARRAY _teacher_ids LOOP
    IF NOT public.tt_target_eligible(v_tid, v_inst) THEN
      RAISE EXCEPTION 'targets: % cannot be given a target',
        COALESCE((SELECT full_name FROM public.profiles WHERE id = v_tid), 'that person');
    END IF;
  END LOOP;

  FOREACH v_tid IN ARRAY _teacher_ids LOOP
    INSERT INTO public.teacher_targets
      (institution_id, metric, scope, owner_id, target_value,
       starts_on, ends_on, cadence_unit, cadence_n, note, assigned_by)
    VALUES
      (v_inst, _metric, 'teacher', v_tid, _target_value,
       _starts_on, _ends_on, _cadence_unit, _cadence_n, _note, v_actor);
    v_n := v_n + 1;

    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (v_tid, 'target_assigned',
            'You have a new target',
            'A new target has been set for you. Open My Targets to see it.',
            '/teacher/my-targets',
            jsonb_build_object('scope', 'teacher', 'metric', _metric, 'value', _target_value));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', v_n);
END $fn$;

-- Stopping NEVER deletes: closed periods must survive (decision 11).
CREATE OR REPLACE FUNCTION public.tt_stop_target(_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_inst uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;
  SELECT institution_id INTO v_inst FROM public.teacher_targets WHERE id = _target_id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'targets: that target does not exist'; END IF;
  IF NOT (public.tt_can_manage_targets(v_actor, v_inst)
          AND public.tt_owns_target(v_actor, _target_id)) THEN
    RAISE EXCEPTION 'targets: you cannot stop this target';
  END IF;

  UPDATE public.teacher_targets SET status = 'stopped', updated_at = now()
   WHERE id = _target_id OR parent_target_id = _target_id;

  RETURN jsonb_build_object('ok', true);
END $fn$;

REVOKE ALL ON FUNCTION public.tt_create_wing_target(uuid, uuid, text, integer, date, date, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_split_wing_target(uuid, jsonb)                                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_create_teacher_targets(text, integer, date, date, uuid[], text, integer, text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_stop_target(uuid)                                                              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_create_wing_target(uuid, uuid, text, integer, date, date, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tt_split_wing_target(uuid, jsonb)                                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.tt_create_teacher_targets(text, integer, date, date, uuid[], text, integer, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.tt_stop_target(uuid)                                                              TO authenticated;
```

- [ ] **Step 4: Apply and confirm the assertions pass**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915120300_teacher_targets_write_rpcs.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-04-write-rpcs.sql
```
Expected: `PASS: verify-04 write rpcs`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915120300_teacher_targets_write_rpcs.sql scripts/teacher-targets/verify-04-write-rpcs.sql
git commit -m "feat(targets): transactional write RPCs for wing pools, splits and direct targets"
```

---

## Task 5: The read RPCs

**Files:**
- Create: `supabase/migrations/20260915120400_teacher_targets_read_rpcs.sql`
- Create: `scripts/teacher-targets/verify-05-read-rpcs.sql`

**Interfaces:**
- Produces: `tt_targets_overview(_metric text DEFAULT NULL) -> jsonb` (admin and coordinator, scoped by role inside),
  `tt_my_targets() -> jsonb` (the caller's own, teacher-facing).

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/teacher-targets/verify-05-read-rpcs.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='tt_targets_overview') THEN
    RAISE EXCEPTION 'FAIL: tt_targets_overview is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='tt_my_targets') THEN
    RAISE EXCEPTION 'FAIL: tt_my_targets is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee IN ('anon','PUBLIC')
                AND routine_name IN ('tt_targets_overview','tt_my_targets')) THEN
    RAISE EXCEPTION 'FAIL: anon or PUBLIC holds EXECUTE on a read RPC';
  END IF;
  -- Both must be STABLE, never VOLATILE: they are reads.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('tt_targets_overview','tt_my_targets')
                AND p.provolatile = 'v') THEN
    RAISE EXCEPTION 'FAIL: a read RPC is VOLATILE';
  END IF;
  RAISE NOTICE 'PASS: verify-05 read rpcs';
END $$;
```

- [ ] **Step 2: Run it and confirm it fails**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-05-read-rpcs.sql
```
Expected: `FAIL: tt_targets_overview is missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915120400_teacher_targets_read_rpcs.sql`:

```sql
-- Teacher Targets, part 5 of 7: the read API.
--
-- Aggregation is server-side (Scale Gate item 2). The client never fetches
-- period rows to count or sum them. A wing's allocated total is a SUM over its
-- children computed here, never a stored second copy.

CREATE OR REPLACE FUNCTION public.tt_targets_overview(_metric text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_inst  uuid;
  v_admin boolean;
  v_out   jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_actor);
  IF v_inst IS NULL THEN RAISE EXCEPTION 'targets: no school context'; END IF;

  v_admin := EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = v_actor
                        AND ur.role IN ('school_admin','super_school_admin','super_admin'));

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT tt.id, tt.metric, tt.scope, tt.wing_id, tt.owner_id, tt.parent_target_id,
           tt.target_value, tt.starts_on, tt.ends_on, tt.cadence_unit, tt.cadence_n,
           tt.status, tt.note, tt.created_at,
           w.name                                    AS wing_name,
           p.full_name                               AS owner_name,
           -- allocated is NULL for a teacher target; for a pool it is the SUM
           -- of its children, which is how the "34 of 40" gap is computed.
           CASE WHEN tt.scope = 'wing' THEN (
             SELECT COALESCE(sum(c.target_value), 0)
             FROM public.teacher_targets c
             WHERE c.parent_target_id = tt.id AND c.status <> 'stopped'
           ) END                                     AS allocated,
           CASE WHEN tt.scope = 'wing' THEN (
             SELECT count(*) FROM public.teacher_targets c
             WHERE c.parent_target_id = tt.id AND c.status <> 'stopped'
           ) END                                     AS teacher_count,
           (SELECT to_jsonb(op) FROM (
              SELECT pr.period_index, pr.period_start, pr.period_end,
                     pr.target_value, pr.achieved_value, pr.status
              FROM public.teacher_target_periods pr
              WHERE pr.target_id = tt.id AND pr.status = 'open'
              ORDER BY pr.period_index DESC LIMIT 1
            ) op)                                    AS open_period
    FROM public.teacher_targets tt
    LEFT JOIN public.wings    w ON w.id = tt.wing_id
    LEFT JOIN public.profiles p ON p.id = tt.owner_id
    WHERE tt.institution_id = v_inst
      AND (_metric IS NULL OR tt.metric = _metric)
      AND (v_admin
           OR tt.owner_id = v_actor
           OR tt.parent_target_id IN (SELECT id FROM public.teacher_targets
                                       WHERE owner_id = v_actor))
    ORDER BY tt.created_at DESC
    LIMIT 500
  ) t;

  RETURN jsonb_build_object('ok', true, 'is_admin', v_admin, 'targets', v_out);
END $fn$;

-- The teacher's own view. ZERO arguments that could widen it: it returns only
-- the caller's rows and nobody else's name, number or rank.
CREATE OR REPLACE FUNCTION public.tt_my_targets()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.starts_on DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT tt.id, tt.metric, tt.target_value, tt.starts_on, tt.ends_on,
           tt.cadence_unit, tt.cadence_n, tt.status, tt.note,
           (SELECT to_jsonb(op) FROM (
              SELECT pr.period_index, pr.period_start, pr.period_end,
                     pr.target_value, pr.achieved_value, pr.status
              FROM public.teacher_target_periods pr
              WHERE pr.target_id = tt.id AND pr.status = 'open'
              ORDER BY pr.period_index DESC LIMIT 1
            ) op)                                     AS open_period,
           (SELECT COALESCE(jsonb_agg(hp ORDER BY hp.period_index DESC), '[]'::jsonb)
              FROM (
                SELECT pr.period_index, pr.period_start, pr.period_end,
                       pr.target_value, pr.achieved_value, pr.status
                FROM public.teacher_target_periods pr
                WHERE pr.target_id = tt.id AND pr.status <> 'open'
                ORDER BY pr.period_index DESC LIMIT 24
              ) hp)                                   AS history
    FROM public.teacher_targets tt
    WHERE tt.owner_id = v_actor AND tt.scope = 'teacher'
    ORDER BY tt.starts_on DESC
    LIMIT 200
  ) t;

  RETURN jsonb_build_object('ok', true, 'targets', v_out);
END $fn$;

REVOKE ALL ON FUNCTION public.tt_targets_overview(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tt_my_targets()           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_targets_overview(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tt_my_targets()           TO authenticated;
```

- [ ] **Step 4: Apply and confirm the assertions pass**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915120400_teacher_targets_read_rpcs.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-05-read-rpcs.sql
```
Expected: `PASS: verify-05 read rpcs`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915120400_teacher_targets_read_rpcs.sql scripts/teacher-targets/verify-05-read-rpcs.sql
git commit -m "feat(targets): server-side read API for admin, coordinator and teacher"
```

---

## Task 6: The evaluator and its cron

**Files:**
- Create: `supabase/migrations/20260915120500_teacher_targets_evaluator.sql`
- Create: `scripts/teacher-targets/verify-06-evaluator.sql`

**Interfaces:**
- Consumes: `tt_target_periods`, `tt_count_exams_published`, `tt_count_homework_published` (Task 3).
- Produces: `tt_evaluate_targets(_institution_id uuid DEFAULT NULL) -> jsonb`; cron job `teacher-targets-daily`.

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/teacher-targets/verify-06-evaluator.sql`:

```sql
DO $$
DECLARE a jsonb; b jsonb; n1 bigint; n2 bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='tt_evaluate_targets') THEN
    RAISE EXCEPTION 'FAIL: tt_evaluate_targets is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND routine_name='tt_evaluate_targets'
                AND grantee IN ('anon','PUBLIC','authenticated')) THEN
    RAISE EXCEPTION 'FAIL: tt_evaluate_targets must be cron-only, not client-callable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'teacher-targets-daily') THEN
    RAISE EXCEPTION 'FAIL: cron job teacher-targets-daily is not scheduled';
  END IF;

  -- IDEMPOTENCY: two runs back to back must leave identical rows.
  a := public.tt_evaluate_targets();
  SELECT count(*), COALESCE(sum(achieved_value),0) INTO n1, n2 FROM public.teacher_target_periods;
  b := public.tt_evaluate_targets();
  IF (SELECT count(*) FROM public.teacher_target_periods) <> n1 THEN
    RAISE EXCEPTION 'FAIL: a second evaluator run changed the row count';
  END IF;
  IF (SELECT COALESCE(sum(achieved_value),0) FROM public.teacher_target_periods) <> n2 THEN
    RAISE EXCEPTION 'FAIL: a second evaluator run changed achieved totals';
  END IF;

  -- A closed period must never be rewritten.
  IF EXISTS (SELECT 1 FROM public.teacher_target_periods
              WHERE status <> 'open' AND closed_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: a closed period has no closed_at';
  END IF;

  RAISE NOTICE 'PASS: verify-06 evaluator';
END $$;
```

- [ ] **Step 2: Run it and confirm it fails**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-06-evaluator.sql
```
Expected: `FAIL: tt_evaluate_targets is missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915120500_teacher_targets_evaluator.sql`:

```sql
-- Teacher Targets, part 6 of 7: the nightly evaluator.
--
-- Plain SQL under pg_cron, not an edge function: every period-evaluation job in
-- this repo is a plain SECURITY DEFINER function, and an edge function would
-- import a 10s ceiling that SQL does not have.
--
-- HOLIDAYS ARE NOT SUBTRACTED, deliberately. A target counts work produced over
-- a wall-clock window, not a school-day rate. Two incompatible definitions of
-- "school day" already ship (award_player_of_the_month subtracts only
-- cal_events kind='holiday' and counts Sundays; get-working-days subtracts
-- holidays, exam_blocks and weekends), and adopting either would make this
-- feature disagree with the other one.

CREATE OR REPLACE FUNCTION public.tt_evaluate_targets(_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_t        record;
  v_p        record;
  v_today    date;
  v_tz       text;
  v_achieved integer;
  v_opened   integer := 0;
  v_closed   integer := 0;
BEGIN
  FOR v_t IN
    SELECT tt.*, COALESCE(i.timezone,'Asia/Kolkata') AS tz
    FROM public.teacher_targets tt
    JOIN public.institutions i ON i.id = tt.institution_id
    WHERE tt.scope = 'teacher'
      AND tt.status = 'active'
      AND (_institution_id IS NULL OR tt.institution_id = _institution_id)
    ORDER BY tt.id                      -- deterministic lock order
  LOOP
    v_tz    := v_t.tz;
    v_today := (now() AT TIME ZONE v_tz)::date;      -- CLAUDE.md 24

    FOR v_p IN
      SELECT * FROM public.tt_target_periods(
        v_t.starts_on, v_t.ends_on, v_t.cadence_unit, v_t.cadence_n, v_today)
    LOOP
      -- Never touch a period that has already been closed: its numbers are
      -- frozen, and the source rows behind them may since have been deleted.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.teacher_target_periods x
        WHERE x.target_id = v_t.id AND x.period_index = v_p.period_index
          AND x.status <> 'open');

      v_achieved := CASE v_t.metric
        WHEN 'exams_published' THEN
          public.tt_count_exams_published(v_t.owner_id, v_t.institution_id,
                                          v_p.period_start, v_p.period_end)
        WHEN 'homework_published' THEN
          public.tt_count_homework_published(v_t.owner_id, v_t.institution_id,
                                             v_p.period_start, v_p.period_end, v_tz)
      END;

      INSERT INTO public.teacher_target_periods
        (target_id, institution_id, teacher_id, period_index, period_start, period_end,
         target_value, achieved_value, status)
      VALUES
        (v_t.id, v_t.institution_id, v_t.owner_id, v_p.period_index,
         v_p.period_start, v_p.period_end, v_t.target_value, v_achieved, 'open')
      -- The constraint is NAMED: a bare DO NOTHING would fire on any unique
      -- index on the table and silently drop the row.
      ON CONFLICT ON CONSTRAINT teacher_target_periods_target_period_key
      DO UPDATE SET achieved_value = EXCLUDED.achieved_value,
                    target_value   = EXCLUDED.target_value,
                    updated_at     = now()
      WHERE public.teacher_target_periods.status = 'open';

      v_opened := v_opened + 1;

      -- Close it once the window has passed.
      IF v_p.period_end < v_today THEN
        UPDATE public.teacher_target_periods p
        SET status    = CASE WHEN p.achieved_value >= p.target_value THEN 'met' ELSE 'missed' END,
            closed_at = now(),
            updated_at = now()
        WHERE p.target_id = v_t.id AND p.period_index = v_p.period_index
          AND p.status = 'open';
        v_closed := v_closed + 1;
      END IF;
    END LOOP;

    -- Decision 11: expiry completes the target, it never deletes it.
    IF v_t.ends_on < v_today THEN
      UPDATE public.teacher_targets SET status = 'completed', updated_at = now()
       WHERE id = v_t.id AND status = 'active';
    END IF;
  END LOOP;

  -- Decision 10: tell the teacher they came up short. notified_at makes this
  -- fire exactly once per period, however many times the job runs.
  WITH due AS (
    SELECT p.id, p.teacher_id, p.target_value, p.achieved_value, t.metric
    FROM public.teacher_target_periods p
    JOIN public.teacher_targets t ON t.id = p.target_id
    WHERE p.status = 'missed' AND p.notified_at IS NULL
      AND (_institution_id IS NULL OR p.institution_id = _institution_id)
    ORDER BY p.id
  ),
  ins AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    SELECT d.teacher_id, 'target_period_missed',
           'Target period closed',
           'Your target period has closed at ' || d.achieved_value || ' of ' || d.target_value || '.',
           '/teacher/my-targets',
           jsonb_build_object('metric', d.metric, 'achieved', d.achieved_value,
                              'target', d.target_value)
    FROM due d
    RETURNING 1
  )
  UPDATE public.teacher_target_periods p
  SET notified_at = now()
  FROM due d WHERE p.id = d.id;

  -- Wing pools expire too; they carry no periods of their own to close.
  UPDATE public.teacher_targets tt
  SET status = 'completed', updated_at = now()
  FROM public.institutions i
  WHERE i.id = tt.institution_id
    AND tt.scope = 'wing' AND tt.status = 'active'
    AND tt.ends_on < (now() AT TIME ZONE COALESCE(i.timezone,'Asia/Kolkata'))::date
    AND (_institution_id IS NULL OR tt.institution_id = _institution_id);

  RETURN jsonb_build_object('ok', true, 'periods_touched', v_opened, 'periods_closed', v_closed);
END $fn$;

REVOKE ALL ON FUNCTION public.tt_evaluate_targets(uuid) FROM PUBLIC, anon, authenticated;

-- 00:35 UTC = 06:05 IST. The 00:20 to 01:00 band already holds
-- student-activity-daily (00:20), badges-player-of-the-month (00:30),
-- badges-year-end (01:00) and teacher-engagement-monthly (00:25), so 00:35 is a
-- free slot that still runs after the activity pass.
--
-- Unschedule-then-schedule, NOT the "WHERE NOT EXISTS" form: that form never
-- updates an existing job's schedule, so a later edit here would be a no-op on
-- prod.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('teacher-targets-daily');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('teacher-targets-daily', '35 0 * * *',
                          $job$ SELECT public.tt_evaluate_targets(); $job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: teacher-targets-daily was NOT scheduled.';
  END IF;
END;
$$;
```

- [ ] **Step 4: Apply and confirm the assertions pass**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915120500_teacher_targets_evaluator.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-06-evaluator.sql
```
Expected: `PASS: verify-06 evaluator`. The script runs the evaluator twice and fails loudly if the second run changes anything.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915120500_teacher_targets_evaluator.sql scripts/teacher-targets/verify-06-evaluator.sql
git commit -m "feat(targets): nightly evaluator that closes periods and notifies"
```

---

## Task 7: Audit enrolment, with the UPDATE arm

`tg_audit_row` currently carries INSERT and DELETE only (`zzz_audit_ins`, `zzz_audit_del`). Targets
are the first feature here where **the edit is the contentious event**: "who changed the number from
4 to 2" must be answerable.

**Files:**
- Create: `supabase/migrations/20260915120600_teacher_targets_audit.sql`
- Create: `scripts/teacher-targets/verify-07-audit.sql`
- Read first: `supabase/migrations/20260914140000_server_side_activity_capture.sql`

- [ ] **Step 1: Read the existing audit migration**

Open `supabase/migrations/20260914140000_server_side_activity_capture.sql` and find the `tg_audit_row`
function body and the per-table `CREATE TRIGGER zzz_audit_ins` / `zzz_audit_del` statements. Copy
their exact shape. Do not guess the payload columns.

- [ ] **Step 2: Write the failing assertion script**

Create `scripts/teacher-targets/verify-07-audit.sql`:

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['teacher_targets','teacher_target_periods'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
                    WHERE c.relname=t AND tr.tgname='zzz_audit_ins' AND NOT tr.tgisinternal) THEN
      RAISE EXCEPTION 'FAIL: % has no INSERT audit trigger', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
                    WHERE c.relname=t AND tr.tgname='zzz_audit_del' AND NOT tr.tgisinternal) THEN
      RAISE EXCEPTION 'FAIL: % has no DELETE audit trigger', t;
    END IF;
  END LOOP;
  -- The new arm: an EDIT to a target must leave a trace.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
                  WHERE c.relname='teacher_targets' AND tr.tgname='zzz_audit_upd'
                    AND NOT tr.tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: teacher_targets has no UPDATE audit trigger';
  END IF;
  RAISE NOTICE 'PASS: verify-07 audit';
END $$;
```

- [ ] **Step 3: Run it and confirm it fails**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-07-audit.sql
```
Expected: `FAIL: teacher_targets has no INSERT audit trigger`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260915120600_teacher_targets_audit.sql`. Attach `zzz_audit_ins` and
`zzz_audit_del` to both new tables using the exact trigger shape read in Step 1, then add the UPDATE
arm on `teacher_targets`:

```sql
-- Teacher Targets, part 7 of 7: audit coverage.
--
-- tg_audit_row (20260914140000) shipped with INSERT and DELETE arms only.
-- Targets are the first feature where the EDIT is the contentious event: "who
-- changed the number from 4 to 2" must be answerable. The UPDATE trigger below
-- is attached ONLY to teacher_targets, not to the ledger, because the evaluator
-- rewrites open ledger rows every night and auditing that would be pure noise.
--
-- NOTE ON REFERENCING: a statement-level trigger using REFERENCING NEW TABLE
-- must NOT carry a column list (Postgres 0A000). That is what broke the first
-- apply of 20260904150000.

-- (Attach zzz_audit_ins / zzz_audit_del to both tables here, copying the exact
--  CREATE TRIGGER shape from 20260914140000.)

DROP TRIGGER IF EXISTS zzz_audit_upd ON public.teacher_targets;
CREATE TRIGGER zzz_audit_upd
  AFTER UPDATE ON public.teacher_targets
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tg_audit_row('UPDATE');
```

If `tg_audit_row` cannot accept an `'UPDATE'` argument as written, extend it in this same migration
rather than inventing a second audit function.

- [ ] **Step 5: Apply, confirm the assertions pass, and commit**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915120600_teacher_targets_audit.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-07-audit.sql
```

```bash
git add supabase/migrations/20260915120600_teacher_targets_audit.sql scripts/teacher-targets/verify-07-audit.sql
git commit -m "feat(targets): audit coverage including the first UPDATE arm"
```

---

## Task 8: Types, period math in TypeScript, and the hooks

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerate)
- Create: `src/lib/targetPeriods.ts`
- Create: `src/hooks/useTeacherTargets.ts`

**Interfaces:**
- Consumes: RPCs `tt_targets_overview`, `tt_my_targets`, `tt_create_wing_target`, `tt_split_wing_target`, `tt_create_teacher_targets`, `tt_stop_target`.
- Produces: `TargetMetric`, `CadenceUnit`, `TeacherTarget`, `TargetPeriod` types; `periodsFor()`, `currentPeriod()`; hooks `useTargetsOverview`, `useMyTargets`, `useCreateWingTarget`, `useSplitWingTarget`, `useCreateTeacherTargets`, `useStopTarget`.

- [ ] **Step 1: Regenerate the database types**

```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
```

Then `git diff --stat src/integrations/supabase/types.ts` and confirm the change is **additive**. A
past auto-merge silently dropped 206 lines of schema from this file. If the diff shows deletions
unrelated to this feature, stop and investigate before committing.

- [ ] **Step 2: Write the period math**

Create `src/lib/targetPeriods.ts`. This mirrors `tt_target_periods` so the create form can preview
periods without a round trip. It is the only place the UI computes a window.

```ts
export type CadenceUnit = "day" | "week" | "month";
export type TargetMetric = "exams_published" | "homework_published";

export interface TargetPeriodBounds {
  index: number;
  start: Date;
  end: Date;
}

function addUnits(from: Date, unit: CadenceUnit, n: number, times: number): Date {
  const d = new Date(from.getTime());
  if (unit === "day") d.setDate(d.getDate() + n * times);
  else if (unit === "week") d.setDate(d.getDate() + 7 * n * times);
  else d.setMonth(d.getMonth() + n * times);
  return d;
}

/**
 * Rolling periods counted from day 1, matching public.tt_target_periods.
 * Period k runs from startsOn + (k-1) intervals to the day before
 * startsOn + k intervals, clipped at endsOn. A null cadence is one period
 * spanning the whole range.
 */
export function periodsFor(
  startsOn: Date,
  endsOn: Date,
  unit: CadenceUnit | null,
  n: number | null,
): TargetPeriodBounds[] {
  if (!unit || !n) return [{ index: 1, start: startsOn, end: endsOn }];
  const out: TargetPeriodBounds[] = [];
  for (let i = 1; i <= 500; i += 1) {
    const start = addUnits(startsOn, unit, n, i - 1);
    if (start > endsOn) break;
    const nextStart = addUnits(startsOn, unit, n, i);
    const end = new Date(nextStart.getTime());
    end.setDate(end.getDate() - 1);
    out.push({ index: i, start, end: end > endsOn ? endsOn : end });
  }
  return out;
}
```

- [ ] **Step 3: Write the hooks**

Create `src/hooks/useTeacherTargets.ts`. Every query sets `staleTime`, destructures `error`, and
every mutation routes errors through `toastError`.

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import type { CadenceUnit, TargetMetric } from "@/lib/targetPeriods";

export interface TargetPeriodRow {
  period_index: number;
  period_start: string;
  period_end: string;
  target_value: number;
  achieved_value: number;
  status: "open" | "met" | "missed";
}

export interface TeacherTargetRow {
  id: string;
  metric: TargetMetric;
  scope: "wing" | "teacher";
  wing_id: string | null;
  owner_id: string;
  parent_target_id: string | null;
  target_value: number;
  starts_on: string;
  ends_on: string;
  cadence_unit: CadenceUnit | null;
  cadence_n: number | null;
  status: "active" | "stopped" | "completed";
  note: string | null;
  wing_name: string | null;
  owner_name: string | null;
  allocated: number | null;
  teacher_count: number | null;
  open_period: TargetPeriodRow | null;
}

export function useTargetsOverview(metric?: TargetMetric) {
  return useQuery({
    queryKey: ["teacher-targets", "overview", metric ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tt_targets_overview", {
        _metric: metric ?? null,
      });
      if (error) throw error;
      const payload = data as { is_admin: boolean; targets: TeacherTargetRow[] };
      return payload;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useMyTargets() {
  return useQuery({
    queryKey: ["teacher-targets", "mine"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tt_my_targets");
      if (error) throw error;
      return (data as { targets: (TeacherTargetRow & { history: TargetPeriodRow[] })[] }).targets;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSplitWingTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      parentId: string;
      allocations: { teacher_id: string; value: number }[];
    }) => {
      const { data, error } = await supabase.rpc("tt_split_wing_target", {
        _parent_id: vars.parentId,
        _allocations: vars.allocations,
      });
      if (error) throw error;
      return data as { teachers: number; allocated: number; pool: number; gap: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["teacher-targets"] });
      toast.success(
        r.gap === 0
          ? `Shared out across ${r.teachers} teachers.`
          : `Shared out ${r.allocated} of ${r.pool}. ${r.gap} still to allocate.`,
      );
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't share out this target.", context: "splitWingTarget" }),
  });
}
```

Write `useCreateWingTarget`, `useCreateTeacherTargets` and `useStopTarget` in the same shape:
`supabase.rpc(...)`, throw on `error`, invalidate `["teacher-targets"]`, `toast.success` on success,
`toastError` on failure.

- [ ] **Step 4: Run the gate**

```bash
npm run typecheck
npx eslint src/lib/targetPeriods.ts src/hooks/useTeacherTargets.ts
npx vite build
```
All three must exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/types.ts src/lib/targetPeriods.ts src/hooks/useTeacherTargets.ts
git commit -m "feat(targets): types, rolling period math and the data layer"
```

---

## Task 9: Feature flag, routes and sidebar, gated off

Wire the surfaces before building them, so every later task ships behind a flag that is off.

**Files:**
- Modify: `src/components/admin/institution-wizard/featuresData.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`
- Create: `src/pages/school/TeacherTargetsPage.tsx` (placeholder shell)
- Create: `src/pages/teacher/MyTargetsPage.tsx` (placeholder shell)

- [ ] **Step 1: Add the feature**

In `featuresData.ts`, add to `AVAILABLE_FEATURES` (category `operations`, `isDefault: false`):

```ts
  { id: "teacher_targets", name: "Teacher Targets", description: "Set exam and homework targets for teachers, by wing or individually, and track them period by period", icon: Target, category: "operations", isDefault: false },
```

Add `Target` to the `lucide-react` import at the top of the file.

Add BOTH urls to `FEATURE_URL_MAP`. Mapping only one leaks the other back into the sidebar when the
feature is off:

```ts
  "/school/teacher-targets": "teacher_targets",
  "/teacher/my-targets": "teacher_targets",
```

- [ ] **Step 2: Create the two placeholder pages**

Each page renders a `PageShell` + `PageHeader` with the correct title and an `EmptyState`. This
proves routing and gating before any data work. Copy the `PageShell`/`PageHeader` import paths from
`src/pages/ExamsPage.tsx`.

- [ ] **Step 3: Add the routes**

In `src/App.tsx`, add lazy imports and two routes, matching the surrounding style exactly:

- `/school/teacher-targets` with `allowedRoles={["school_admin", "super_school_admin", "super_admin", "coordinator"]}`
- `/teacher/my-targets` with `allowedRoles={["teacher", "coordinator"]}`

**The teacher route must exist and admit teachers before any notification is written.**
`ProtectedRoute` enforces `allowedRoles` and then `FEATURE_URL_MAP` by exact pathname, so a
notification pointing at an admin-only URL bounces the teacher to `/dashboard` with a toast.

- [ ] **Step 4: Add the sidebar rows**

In `AppSidebar.tsx`, add the admin/coordinator row and the teacher row. **Add the teacher row to the
teacher branch as well as the coordinator branch:** `shouldShowCoordinatorNav()` keys off
`activeViewRole`, and `viewRoles[0]` for a teacher+coordinator is `"teacher"`, so a row added only to
the coordinator branch is invisible to exactly the dual-role users who need it.

- [ ] **Step 5: Run the gate and verify by hand**

```bash
npm run typecheck && npx eslint src/App.tsx src/components/layout/AppSidebar.tsx src/components/admin/institution-wizard/featuresData.ts src/pages/school/TeacherTargetsPage.tsx src/pages/teacher/MyTargetsPage.tsx && npx vite build
```

With `teacher_targets` OFF for the institution: neither sidebar row appears, and navigating directly
to either URL bounces to `/dashboard`. Turn it ON: both rows appear for the right roles.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(targets): feature flag, routes and sidebar, gated off by default"
```

---

## Task 10: The header button on both pages

**Files:**
- Create: `src/components/targets/TargetsHeaderButton.tsx`
- Modify: `src/pages/ExamsPage.tsx:502-527`
- Modify: `src/pages/HomeworkPage.tsx` (its `PageShell` + `PageHeader` block)

- [ ] **Step 1: Write the shared button**

Create `src/components/targets/TargetsHeaderButton.tsx`:

```tsx
import { Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Sits in PageHeader's `extras` slot, to the left of the primary CTA on every
 * breakpoint. The label collapses to an icon under sm, the way ScopeSwitcher
 * and the TasksPage header chip already do: the action cluster has no
 * flex-wrap and PageShell sets overflow-x-hidden, so anything that overflows at
 * 375px is CLIPPED and silently unreachable rather than scrollable.
 *
 * bg-white/85 is deliberate and matches ScopeSwitcher (ExamsPage.tsx:1218) and
 * the HomeworkPage filter triggers. The token bg-surface-card would make this
 * button flip in dark mode while its immediate neighbours did not.
 */
export function TargetsHeaderButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="outline"
      onClick={() => navigate(to)}
      title="Targets"
      className="h-10 shrink-0 gap-1.5 rounded-full border-surface-stroke bg-white/85 px-3 text-sm font-medium text-ink-700 backdrop-blur-sm hover:bg-ink-400/5 sm:px-4"
    >
      <Target className="h-4 w-4" />
      <span className="hidden sm:inline">Targets</span>
    </Button>
  );
}
```

- [ ] **Step 2: Wire it into ExamsPage**

The `extras` slot at `src/pages/ExamsPage.tsx:517-521` is **already occupied** by `ScopeSwitcher` for
dual-role users. Compose, do not replace, or dual-role staff lose their scope toggle:

```tsx
        extras={
          <>
            {canSwitchScope ? (
              <ScopeSwitcher value={activeViewRole} onChange={setActiveViewRole} roles={viewRoles} />
            ) : null}
            {isFeatureEnabled("teacher_targets") ? (
              <TargetsHeaderButton to={targetsPathForRole} />
            ) : null}
          </>
        }
```

`targetsPathForRole` is `/school/teacher-targets` when `isSchoolAdminView || isCoordinatorScope`,
else `/teacher/my-targets`. Derive it from the existing `isSchoolAdminView` and `isCoordinatorScope`
at `ExamsPage.tsx:131-133`; do not compute roles a second way.

- [ ] **Step 3: Wire it into HomeworkPage**

`HomeworkPage` passes no `extras` today, so add the prop to its `PageHeader` with the same
feature-gated button and the same role-derived destination.

- [ ] **Step 4: Run the gate and verify by hand**

```bash
npm run typecheck && npx eslint src/components/targets/TargetsHeaderButton.tsx src/pages/ExamsPage.tsx src/pages/HomeworkPage.tsx && npx vite build
```

Check all of:
- At **375px** on both pages, with the button present: the header row does not clip. On ExamsPage
  check specifically as a **dual-role user**, where `ScopeSwitcher` is also present.
- In **dark mode** the new button matches its neighbours.
- **While the page is loading**, `ExamsPage` returns `PageSkeleton` before `PageHeader`
  (`ExamsPage.tsx:496-498`), so the button is legitimately absent. Confirm it appears once loaded.
- With the feature off, the button is gone on both pages.

- [ ] **Step 5: Commit**

```bash
git add src/components/targets/TargetsHeaderButton.tsx src/pages/ExamsPage.tsx src/pages/HomeworkPage.tsx
git commit -m "feat(targets): Targets button in the exams and homework page headers"
```

---

## Task 11: The admin and coordinator page

**Files:**
- Modify: `src/pages/school/TeacherTargetsPage.tsx`
- Create: `src/components/targets/CreateTargetSheet.tsx`
- Create: `src/components/targets/SplitPoolSheet.tsx`
- Create: `src/components/targets/TargetProgressCard.tsx`

- [ ] **Step 1: Build the page shell with its three states, in the right order**

`useTargetsOverview()` gives `{ data, isLoading, error }`. Render **error before empty** (§6), and
make the error state cover the stat tiles and header too, not just the list:

```tsx
  if (isLoading) return <PageSkeleton />;
  if (error) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Couldn't load targets"
        description="Something went wrong fetching targets. Try again in a moment."
        action={{ label: "Retry", onClick: () => refetch() }}
      />
    );
  }
  if (!targets.length) {
    return (
      <EmptyState
        icon={<Target className="h-6 w-6" />}
        title="No targets yet"
        description="Set a target for a wing or for individual teachers to get started."
        action={{ label: "Set a target", onClick: () => setCreateOpen(true) }}
      />
    );
  }
```

- [ ] **Step 2: Build the create sheet**

`CreateTargetSheet` in a `MobileSheet` (not `Dialog`). Fields: measure (exams or homework), target
type (wing pool or named teachers), wing plus its coordinator when wing, teacher multi-select when
direct, the number, start and end dates, and cadence (one-off, weekly, every 15 days, monthly,
quarterly).

Show a live preview of the first three periods using `periodsFor()` from `src/lib/targetPeriods.ts`,
so the admin can see that "weekly from 15 Sep" means 15-21, 22-28 and so on before saving.

The coordinator dropdown lists only people who hold a `wing_assignments` row for the chosen wing
**and** the coordinator role. `tt_create_wing_target` rejects anyone else, so the UI must not offer
them.

- [ ] **Step 3: Build the split sheet**

`SplitPoolSheet` lists the coordinator's candidate teachers with a number input each, and a running
"34 of 40 allocated" line. **Saving with a gap is allowed** (decision 14): the button stays enabled
and the success toast reports the gap. Never block the save.

- [ ] **Step 4: Run the gate and verify by hand**

```bash
npm run typecheck && npx eslint src/pages/school/TeacherTargetsPage.tsx src/components/targets/ && npx vite build
```

Verify at 375px and in dark mode. Verify as a **coordinator**: they see only their own wing pools and
the children they created, and they cannot open the create-wing-target flow.

- [ ] **Step 5: Commit**

```bash
git add src/pages/school/TeacherTargetsPage.tsx src/components/targets/
git commit -m "feat(targets): admin and coordinator targets page with pool splitting"
```

---

## Task 12: The teacher page

**Files:**
- Modify: `src/pages/teacher/MyTargetsPage.tsx`

- [ ] **Step 1: Build it**

`useMyTargets()` returns each target with its `open_period` and up to 24 closed periods as `history`.
Render, per target: the measure, the number, the window, a progress indicator for the open period
("3 of 5, 11 days left"), and the closed periods below with met or missed.

**History stays visible after the deadline** (decision 11). A `completed` target renders with its full
history, not hidden.

Error state before empty state, as in Task 11.

- [ ] **Step 2: Verify the notification path end to end**

This is the step that catches the failure mode the spec called out:

1. As an admin, assign a target to a test teacher.
2. Sign in as that teacher, open the notification bell, and click the notification.
3. Confirm it lands on `/teacher/my-targets` and **does not** bounce to `/dashboard`.

If it bounces, the cause is `allowedRoles` or a missing `FEATURE_URL_MAP` entry from Task 9, not the
page.

- [ ] **Step 3: Run the gate**

```bash
npm run typecheck && npx eslint src/pages/teacher/MyTargetsPage.tsx && npx vite build
```

Verify at 375px and in dark mode.

- [ ] **Step 4: Commit**

```bash
git add src/pages/teacher/MyTargetsPage.tsx
git commit -m "feat(targets): teacher-facing targets page with period history"
```

---

## Task 13: Integration pass and the Scale Gate

**Files:**
- Modify: `src/components/settings/SystemMapsDocument.tsx` (or the living-docs tab that lists modules)
- Read: `.claude/rules/enterprise-code-quality.md`

- [ ] **Step 1: Walk the Scale Gate and write a verdict for every item**

State `pass` or `na` plus a reason for all ten items in
`.claude/rules/enterprise-code-quality.md`. The three most at risk here:

- **Item 1 (bounds):** `tt_targets_overview` is capped at 500 and `tt_my_targets` at 200. Confirm.
- **Item 2 (server-side aggregation):** no `.length`, `filter().length` or `reduce` over fetched rows
  anywhere in the targets code. The wing's allocated total is a SQL `SUM`.
- **Item 3 (staleTime):** every `useQuery` in `useTeacherTargets.ts` sets one.

- [ ] **Step 2: Add the module to the living docs**

Add a Teacher Targets entry. While there, note that the docs list `topic_pacing_targets` as a live
table; it was **dropped on 2026-04-18**, so anyone grepping the docs for "targets" currently finds a
corpse. Correcting that line is a one-word change and prevents the next agent wiring against it.

- [ ] **Step 3: Run the full gate one final time**

```bash
npm run typecheck
npx eslint src/
npx vite build
```

Then the stale-import pass, because this repo sets `@typescript-eslint/no-unused-vars` to `off` and
the normal gate cannot see a symbol an edit made dead:

```bash
npx eslint --rule '{"@typescript-eslint/no-unused-vars":["error",{"argsIgnorePattern":"^_"}]}' src/components/targets/ src/pages/school/TeacherTargetsPage.tsx src/pages/teacher/MyTargetsPage.tsx src/hooks/useTeacherTargets.ts src/lib/targetPeriods.ts src/pages/ExamsPage.tsx src/pages/HomeworkPage.tsx
```

Fix only what this change orphaned; pre-existing ones are out of scope.

- [ ] **Step 4: Re-run every verification script**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-01-homework-published-at.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-02-schema.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-03-counters.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-04-write-rpcs.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-05-read-rpcs.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-06-evaluator.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/teacher-targets/verify-07-audit.sql
```

All seven must print `PASS`.

- [ ] **Step 5: Prove the ledger actually freezes**

The single most important behavioural check, because it is the whole reason the ledger exists:

1. Find a closed period with `achieved_value > 0`.
2. Delete one of the exams or homework rows that fed it.
3. Re-run `tt_evaluate_targets()`.
4. Confirm `achieved_value` on that closed period is **unchanged**.

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "feat(targets): integration pass, living docs and scale gate"
git push origin feat/teacher-targets
```

---

## Self-review

**Spec coverage.** All 15 locked decisions map to a task: 1 and 2 to Task 3 (counters); 3 to Task 3
(period math); 4, 5 and 14 to Task 4 (`tt_create_wing_target`, `tt_split_wing_target`); 6 to the
schema in Task 2; 7 to `tt_target_eligible` in Task 2; 8 and 9 to Tasks 9 and 12; 10 to the notify
block in Task 6; 11 to the ledger in Task 2 plus Task 13 Step 5; 12 to the notifications in Task 4
and Task 6; 13 to the `split_wing_target` delete guard in Task 4; 15 to Task 1. Spec §7's
infrastructure list maps to Tasks 7, 9 and 13.

**Known gap, stated rather than hidden.** Spec §5.3 lists a fourth notification, "your wing target is
still undistributed". Task 6 does not implement it: the evaluator only walks `scope='teacher'` rows,
so an unsplit pool is never visited. The admin-side "0 of 40 allocated" from Task 5 covers the
visibility half of decision 12, and the coordinator is notified on arrival in Task 4. **The reminder
is deliberately deferred** and should be a follow-up task once the core is in use, rather than a
second scheduled sweep added before anyone has used the feature.

**Type consistency.** `TargetMetric` and `CadenceUnit` are declared once in `src/lib/targetPeriods.ts`
and imported by `useTeacherTargets.ts`. SQL and TypeScript use the same literals throughout
(`exams_published`, `homework_published`, `day`/`week`/`month`, `open`/`met`/`missed`,
`active`/`stopped`/`completed`, `wing`/`teacher`). The RPC names in Task 8's hooks match Tasks 4 and
5 exactly.

**Placeholder scan.** Task 7 Step 4 is the only step that says "copy the exact shape from the existing
migration" rather than quoting it. That is deliberate: `tg_audit_row`'s trigger signature must be read
from `20260914140000_server_side_activity_capture.sql` at implementation time rather than reproduced
from a summary, because getting a `REFERENCING NEW TABLE` trigger signature wrong fails with a
`0A000` that already broke one apply in this repo. Step 1 of that task makes reading it a required
step.
