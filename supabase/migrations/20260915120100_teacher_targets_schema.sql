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

-- FIX (review round 1, 2026-09-15): tgt_owns_target LEFT JOINs parent_target_id
-- to read the parent's owner_id. If a row's parent_target_id ever pointed at
-- itself (or a cycle formed through two rows), that join would let a target
-- silently "own" itself or its own descendant. This CHECK closes the
-- self-parent half of that; a parent must additionally be scope='wing' and
-- that cross-row rule cannot be a CHECK, so it is enforced by Task 4's write
-- RPC instead. Table already exists in prod as of this migration's first
-- apply, so CREATE TABLE's inline CONSTRAINT list never runs again - this has
-- to be a separate, guarded ALTER so re-running the file stays safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'teacher_targets_no_self_parent'
      AND conrelid = 'public.teacher_targets'::regclass
  ) THEN
    ALTER TABLE public.teacher_targets
      ADD CONSTRAINT teacher_targets_no_self_parent CHECK (parent_target_id IS DISTINCT FROM id);
  END IF;
END $$;

-- FIX (Task 4 review round 1, 2026-09-15): ONE active child per (pool,
-- teacher). Without this, tgt_split_wing_target's per-teacher DELETE only
-- removes an un-historied child (one with no closed period yet); a child
-- that already has a closed period survives, on purpose, so its history is
-- never lost. But nothing then stopped the following INSERT from adding a
-- SECOND active row for that same teacher under the same parent when a
-- coordinator re-split the pool and included that teacher again - two
-- simultaneous targets, a duplicate "you have a new target" notification for
-- what was really a re-allocation, and a wing SUM that double-counts them.
--
-- This MUST be a plain partial UNIQUE INDEX, not a table CONSTRAINT:
-- PostgreSQL constraints (ADD CONSTRAINT ... UNIQUE) cannot carry a WHERE
-- predicate, only CREATE UNIQUE INDEX can (reference:
-- reference_unique_index_not_in_pg_constraint.md - a unique index is
-- invisible to pg_constraint, so check pg_indexes, not pg_constraint, to
-- confirm this exists). tgt_split_wing_target's write RPC targets this exact
-- (parent_target_id, owner_id) column pair and WHERE predicate for
-- ON CONFLICT inference - the predicate here and the one in that INSERT's
-- ON CONFLICT clause must stay textually identical or Postgres cannot infer
-- this index as the arbiter.
--
-- `status <> 'stopped'` (rather than `status = 'active'`) also covers a
-- 'completed' child without a second index: only a stopped row is meant to
-- free up its (parent, teacher) slot for a fresh allocation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_targets_one_active_child_per_teacher
  ON public.teacher_targets (parent_target_id, owner_id)
  WHERE parent_target_id IS NOT NULL AND status <> 'stopped';

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
--
-- NAMING (fixed 2026-09-15, before Task 4 ships): these three helpers and
-- Task 3's four functions were originally named tt_target_eligible,
-- tt_can_manage_targets, tt_owns_target, tt_target_interval, tt_target_periods,
-- tt_count_exams_published, tt_count_homework_published. `tt_` is already the
-- Timetable module's namespace (tt_slots, tt_period_structures,
-- tt_run_attendance_pass_for_institution, ~20 more) and CLAUDE.md 7 routes any
-- `tt_*` match to the `timetable-module` skill, so a future agent opening one
-- of these would load the wrong subsystem's context. Renamed to `tgt_` (this
-- repo's house style for short module prefixes: oly_, dash_, cal_, hybrid_)
-- before Task 4 could call the old names from a fourth place. The two TABLES
-- keep no prefix at all and are unaffected.

-- Who may RECEIVE a target: teacher or coordinator role, active, same school.
-- This is a FOURTH definition of "a teacher" in this repo (the engagement engine
-- uses class_assignments only; the badge evaluator uses teacher+coordinator;
-- dash_teachers_table adds employee). It is defined ONCE, here, and every
-- surface calls it. profiles.is_active IS NOT FALSE matters: a teacher leaving
-- is a DEACTIVATION, not a delete.
CREATE OR REPLACE FUNCTION public.tgt_eligible(_user uuid, _institution uuid)
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

-- Who may CREATE/manage targets at all: administrators only.
-- FIX (review round 1, 2026-09-15): 'coordinator' was REMOVED from this list.
-- This function has no wing bound, so admitting coordinators here and then
-- backing an UPDATE policy with it let ANY coordinator update ANY
-- teacher_targets row institution-wide via a direct PostgREST call - not just
-- their own wing's - because nothing here checked which wing the caller
-- coordinates. Coordinators are deliberately EXCLUDED; their real access
-- (their own targets, targets under a pool they own, targets they assigned)
-- is covered entirely by tgt_owns_target below, which the SELECT policy
-- already calls. No wing join is needed for that, so none was added here.
CREATE OR REPLACE FUNCTION public.tgt_can_manage(_user uuid, _institution uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user
      AND ur.role IN ('school_admin','super_school_admin','super_admin')
  ) AND public.get_user_institution(_user) = _institution
$fn$;

-- Owner of a target, or the owner of its parent pool.
CREATE OR REPLACE FUNCTION public.tgt_owns_target(_user uuid, _target uuid)
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
    OR public.tgt_owns_target((select auth.uid()), id)
    OR public.tgt_can_manage((select auth.uid()), institution_id)
  );

-- FIX (review round 1, 2026-09-15): deliberately NO INSERT, UPDATE or DELETE
-- policy exists on teacher_targets. All writes go through the Task 4 SECURITY
-- DEFINER RPCs (CLAUDE.md 9a), which bypass RLS entirely - the RPC is what
-- enforces authority on a write, never a client-facing policy. With RLS
-- enabled and no permissive policy for these commands, PostgREST denies every
-- direct client INSERT/UPDATE/DELETE by default; that default-deny IS the
-- enforcement. A prior version of this migration shipped a
-- teacher_targets_update policy gated on tgt_can_manage alone, which
-- had no wing or ownership bound: it let ANY coordinator run a direct
-- PostgREST UPDATE against ANY row in the institution, including another
-- wing's pool, in production. Do not re-add a write policy here.
DROP POLICY IF EXISTS teacher_targets_update ON public.teacher_targets;

DROP POLICY IF EXISTS teacher_target_periods_select ON public.teacher_target_periods;
CREATE POLICY teacher_target_periods_select ON public.teacher_target_periods
  FOR SELECT TO authenticated
  USING (
    teacher_id = (select auth.uid())
    OR public.tgt_owns_target((select auth.uid()), target_id)
    OR public.tgt_can_manage((select auth.uid()), institution_id)
  );

REVOKE ALL ON FUNCTION public.tgt_eligible(uuid, uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tgt_can_manage(uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tgt_owns_target(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tgt_eligible(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.tgt_can_manage(uuid, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.tgt_owns_target(uuid, uuid) TO authenticated;

-- RENAME CLEANUP (2026-09-15): the old tt_-prefixed names above are recreated
-- under tgt_ names and both RLS policies already reference the new names only
-- (see the two CREATE POLICY statements above, which were dropped and
-- recreated in this same apply) - so by this point nothing in the database
-- depends on the old functions and a plain DROP (no CASCADE) is safe. Do NOT
-- reorder this above the CREATE POLICY statements: dropping a helper while a
-- live policy still calls it fails loudly (or, with CASCADE, silently drops
-- the policy too - never use CASCADE here).
DROP FUNCTION IF EXISTS public.tt_target_eligible(uuid, uuid);
DROP FUNCTION IF EXISTS public.tt_can_manage_targets(uuid, uuid);
DROP FUNCTION IF EXISTS public.tt_owns_target(uuid, uuid);

REVOKE ALL ON TABLE public.teacher_targets        FROM anon;
REVOKE ALL ON TABLE public.teacher_target_periods FROM anon;
