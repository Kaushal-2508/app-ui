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
--
-- NAMING: `tgt_`, not `tt_` -- `tt_` is the Timetable module's namespace and
-- CLAUDE.md 7 routes any `tt_*` match to the timetable-module skill. Tasks 2
-- and 3 already renamed the three authority helpers
-- (tgt_eligible/tgt_can_manage/tgt_owns_target) and the four period/counter
-- functions from `tt_` to `tgt_`; the old `tt_` names for those seven no
-- longer exist in the database at all (dropped in 20260915120100 and
-- 20260915120200). This migration's four RPCs use `tgt_` from the start.
--
-- tgt_can_manage IS ADMINISTRATORS ONLY (school_admin/super_school_admin/
-- super_admin) -- coordinators were removed from it in 20260915120100 (fix
-- round 1: as originally written it let ANY coordinator write ANY target in
-- the institution through RLS, a live prod hole). tgt_stop_target below
-- therefore tests "administrator OR owns-this-target", NEVER AND: with
-- coordinators excluded from tgt_can_manage, an AND would mean a coordinator
-- could never stop a target they created themselves. tgt_can_manage already
-- checks institution membership internally; tgt_owns_target is scoped to one
-- target row, so no separate institution check is needed on that branch
-- either.
--
-- NO INSERT/UPDATE/DELETE POLICY EXISTS on teacher_targets or
-- teacher_target_periods (20260915120100). RLS denies every direct client
-- write by default; these four SECURITY DEFINER functions are the ONLY write
-- path, so every authorisation check has to live inside them -- nothing
-- upstream will catch a mistake here.

-- Admin creates a wing pool for one named coordinator to share out.
CREATE OR REPLACE FUNCTION public.tgt_create_wing_target(
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

  -- FIX (review round 1, finding 2): admin check runs BEFORE any wing lookup.
  -- It is a fact about the caller alone, not about _wing_id, so checking it
  -- first costs nothing and means a non-admin never reaches the wing lookup
  -- below at all - they can never use this function to learn whether a given
  -- wing exists.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = v_actor
                    AND ur.role IN ('school_admin','super_school_admin','super_admin')) THEN
    RAISE EXCEPTION 'targets: only an administrator can set a wing target';
  END IF;

  -- FIX (review round 1, finding 2): existence and institution-match are ONE
  -- message. Previously "that wing does not exist" was raised before any
  -- authority check at all, so ANY authenticated caller could probe an
  -- arbitrary wing_id and learn whether it existed. Now an admin from
  -- another school gets the identical response for "wing does not exist"
  -- and "wing belongs to another school" - the two are indistinguishable.
  SELECT w.institution_id INTO v_inst FROM public.wings w WHERE w.id = _wing_id;
  IF v_inst IS NULL OR v_inst <> public.get_user_institution(v_actor) THEN
    RAISE EXCEPTION 'targets: that wing does not exist, or you cannot manage it';
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

  -- The coordinator is told the pool has landed.
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
-- different spans and the gap shown to the admin would be meaningless. An
-- allocation that does not add up is ALLOWED; the gap is returned.
--
-- THE PARENT MUST BE scope='wing'. A CHECK constraint cannot express this
-- cross-row rule (teacher_targets_no_self_parent only rules out a row
-- parenting itself -- see 20260915120100), so this function verifies it
-- explicitly, before writing anything. Without this, a teacher-scope row
-- could be "split" as though it were a pool, parenting another teacher-scope
-- row; tgt_owns_target's LEFT JOIN to parent_target_id would then make an
-- unrelated teacher "own" someone else's target.
--
-- FIX (review round 1, finding 2): existence and ownership collapse into ONE
-- message. Previously "that target does not exist" was raised before the
-- ownership check, so ANY authenticated caller could probe an arbitrary
-- target uuid and learn whether it existed before being told they did not
-- own it. Now a nonexistent id and someone else's target both raise the
-- identical message. The scope and status checks run AFTER that combined
-- gate, once the caller has already proven ownership of this specific row -
-- revealing its scope or status at that point tells them nothing they could
-- not already read for their own row via teacher_targets_select.
CREATE OR REPLACE FUNCTION public.tgt_split_wing_target(
  _parent_id uuid, _allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor    uuid := auth.uid();
  v_parent   public.teacher_targets%ROWTYPE;
  v_item     jsonb;
  v_tid      uuid;
  v_val      integer;
  v_total    integer := 0;
  v_n        integer := 0;
  v_prev_val integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;

  SELECT * INTO v_parent FROM public.teacher_targets WHERE id = _parent_id;
  IF v_parent.id IS NULL OR v_parent.owner_id <> v_actor THEN
    RAISE EXCEPTION 'targets: that target does not exist, or you cannot manage it';
  END IF;
  IF v_parent.scope <> 'wing' THEN RAISE EXCEPTION 'targets: only a wing target can be shared out'; END IF;
  IF v_parent.status <> 'active' THEN RAISE EXCEPTION 'targets: this target is no longer active'; END IF;

  -- Validate EVERY allocation before writing ANY.
  FOR v_item IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_tid := (v_item ->> 'teacher_id')::uuid;
    v_val := (v_item ->> 'value')::integer;
    IF v_val IS NULL OR v_val <= 0 THEN
      RAISE EXCEPTION 'targets: every teacher needs a number above zero';
    END IF;
    IF NOT public.tgt_eligible(v_tid, v_parent.institution_id) THEN
      RAISE EXCEPTION 'targets: % cannot be given a target',
        COALESCE((SELECT full_name FROM public.profiles WHERE id = v_tid), 'that person');
    END IF;
    v_total := v_total + v_val;
    v_n := v_n + 1;
  END LOOP;

  -- Replace the previous allocation wholesale, but ONLY rows with no closed
  -- period yet: a teacher who has already been measured keeps their history,
  -- and the ledger must stay reproducible. A child WITH a closed period
  -- survives this DELETE on purpose - it is exactly that surviving row the
  -- ON CONFLICT below must find and update, never duplicate.
  DELETE FROM public.teacher_targets c
  WHERE c.parent_target_id = _parent_id
    AND NOT EXISTS (SELECT 1 FROM public.teacher_target_periods p
                     WHERE p.target_id = c.id AND p.status <> 'open');

  -- FIX (review round 1, finding 1): the old `ON CONFLICT DO NOTHING` here
  -- could never fire - teacher_targets carries no UNIQUE constraint other
  -- than its primary key, so there was nothing to conflict on. A teacher
  -- with a surviving historied child (see the DELETE above) who was included
  -- in a re-split got a SECOND active row: two simultaneous targets, a
  -- duplicate "new target" notification for what was really a
  -- re-allocation, and a wing SUM that double-counted them.
  --
  -- idx_teacher_targets_one_active_child_per_teacher (20260915120100) is a
  -- partial UNIQUE INDEX on (parent_target_id, owner_id) WHERE
  -- parent_target_id IS NOT NULL AND status <> 'stopped' - it cannot be a
  -- table CONSTRAINT (Postgres constraints cannot carry a WHERE predicate).
  -- ON CONFLICT (columns) WHERE (predicate) below must match that index's
  -- column list and predicate TEXTUALLY for Postgres to infer it as the
  -- arbiter; DO UPDATE re-allocates the SAME row going forward rather than
  -- creating a duplicate, and closed periods are unaffected because each
  -- period row already snapshots its own target_value independently.
  --
  -- The previous value is read BEFORE the upsert so the notification below
  -- can tell "brand new" from "re-allocated, number changed" from
  -- "re-allocated, number identical" - the three cases need different (or
  -- no) copy, and only the OLD value read this way makes that possible;
  -- RETURNING's `xmax = 0` would say insert-vs-update but never the old
  -- value, so this SELECT would still be needed regardless.
  FOR v_item IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_tid := (v_item ->> 'teacher_id')::uuid;
    v_val := (v_item ->> 'value')::integer;

    SELECT target_value INTO v_prev_val
    FROM public.teacher_targets
    WHERE parent_target_id = _parent_id AND owner_id = v_tid AND status <> 'stopped'
    LIMIT 1;

    INSERT INTO public.teacher_targets
      (institution_id, metric, scope, owner_id, parent_target_id, target_value,
       starts_on, ends_on, cadence_unit, cadence_n, assigned_by)
    VALUES
      (v_parent.institution_id, v_parent.metric, 'teacher', v_tid, _parent_id, v_val,
       v_parent.starts_on, v_parent.ends_on, v_parent.cadence_unit, v_parent.cadence_n, v_actor)
    ON CONFLICT (parent_target_id, owner_id) WHERE parent_target_id IS NOT NULL AND status <> 'stopped'
    DO UPDATE SET target_value = EXCLUDED.target_value, updated_at = now();

    IF v_prev_val IS NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
      VALUES (v_tid, 'target_assigned',
              'You have a new target',
              'A new target has been set for you. Open My Targets to see it.',
              '/teacher/my-targets',
              jsonb_build_object('target_id', _parent_id, 'scope', 'teacher',
                                 'metric', v_parent.metric, 'value', v_val));
    ELSIF v_prev_val <> v_val THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
      VALUES (v_tid, 'target_updated',
              'Your target changed',
              'Your target has been updated. Open My Targets to see the new number.',
              '/teacher/my-targets',
              jsonb_build_object('target_id', _parent_id, 'scope', 'teacher',
                                 'metric', v_parent.metric, 'value', v_val, 'previous_value', v_prev_val));
    END IF;
    -- v_prev_val = v_val: the re-split left this teacher's number unchanged -
    -- deliberately silent, a notification here would be noise.
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'teachers', v_n, 'allocated', v_total,
    'pool', v_parent.target_value, 'gap', v_parent.target_value - v_total);
END $fn$;

-- Admin assigns straight to named teachers, no wing involved.
--
-- ARGUMENT ORDER: non-default parameters first, then the three optional ones
-- trailing. This corrects the plan's own "Interfaces" prose (Ruling C4,
-- 2026-09-15), which listed _teacher_ids after the cadence/note defaults --
-- illegal, since a parameter with no default cannot follow one that has one.
-- The migration body below is, and always was, the authoritative order.
CREATE OR REPLACE FUNCTION public.tgt_create_teacher_targets(
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

  -- Validate EVERY teacher before writing ANY.
  FOREACH v_tid IN ARRAY _teacher_ids LOOP
    IF NOT public.tgt_eligible(v_tid, v_inst) THEN
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

-- Stopping NEVER deletes: closed periods must survive.
--
-- tgt_can_manage is admin-only (coordinators were removed from it, fix round 1
-- of 20260915120100 -- it had no wing bound and let any coordinator UPDATE any
-- target in the institution through RLS). The test here is therefore
-- "administrator OR owns-this-target", NEVER AND: with coordinators excluded
-- from tgt_can_manage, an AND would mean a coordinator could never stop a
-- target they themselves created or were assigned. tgt_can_manage already
-- checks institution membership internally (get_user_institution(_user) =
-- _institution); tgt_owns_target is scoped to exactly this one target row
-- (owner, parent-owner, or assigner), so no separate institution check is
-- needed on that branch either.
--
-- FIX (review round 1, finding 2): existence and authority collapse into ONE
-- message. Previously "that target does not exist" was raised before the
-- authority check ran at all, so ANY authenticated caller could probe an
-- arbitrary target uuid and learn whether it existed. tgt_can_manage(_user,
-- NULL) and tgt_owns_target(_user, _target_id) against a nonexistent id both
-- safely evaluate to false (no row to match), so combining the NULL check
-- into the same condition is safe either way the boolean OR short-circuits.
CREATE OR REPLACE FUNCTION public.tgt_stop_target(_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_inst uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'targets: not authenticated'; END IF;
  SELECT institution_id INTO v_inst FROM public.teacher_targets WHERE id = _target_id;
  IF v_inst IS NULL OR NOT (public.tgt_can_manage(v_actor, v_inst)
                            OR public.tgt_owns_target(v_actor, _target_id)) THEN
    RAISE EXCEPTION 'targets: that target does not exist, or you cannot manage it';
  END IF;

  UPDATE public.teacher_targets SET status = 'stopped', updated_at = now()
   WHERE id = _target_id OR parent_target_id = _target_id;

  RETURN jsonb_build_object('ok', true);
END $fn$;

-- These four are called directly by the client (Task 8's hooks), so
-- authenticated keeps EXECUTE -- unlike Task 3's counters, which are
-- server-only and have authenticated revoked.
REVOKE ALL ON FUNCTION public.tgt_create_wing_target(uuid, uuid, text, integer, date, date, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tgt_split_wing_target(uuid, jsonb)                                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tgt_create_teacher_targets(text, integer, date, date, uuid[], text, integer, text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tgt_stop_target(uuid)                                                              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tgt_create_wing_target(uuid, uuid, text, integer, date, date, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tgt_split_wing_target(uuid, jsonb)                                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.tgt_create_teacher_targets(text, integer, date, date, uuid[], text, integer, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.tgt_stop_target(uuid)                                                              TO authenticated;
