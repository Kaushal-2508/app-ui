DO $$
DECLARE
  v_missing text;
  v_pure_coordinator_count int;
  v_wrongly_admitted_count int;
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
  -- STRENGTHENED (same pattern as verify-01's trigger identity check): conname +
  -- contype='u' alone would still PASS for a same-named unique constraint on the
  -- wrong table, or one covering the wrong columns. Pin the table via conrelid
  -- and the exact column pair via pg_get_constraintdef.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'teacher_target_periods_target_period_key'
      AND c.contype = 'u'
      AND c.conrelid = 'public.teacher_target_periods'::regclass
      AND pg_get_constraintdef(c.oid) = 'UNIQUE (target_id, period_index)'
  ) THEN
    RAISE EXCEPTION 'FAIL: teacher_target_periods_target_period_key is not a UNIQUE (target_id, period_index) constraint on public.teacher_target_periods';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.teacher_targets'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on teacher_targets';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.teacher_target_periods'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on teacher_target_periods';
  END IF;

  -- FIX (review round 1, 2026-09-15): this check used to require that an
  -- UPDATE policy on teacher_targets/teacher_target_periods carry WITH CHECK.
  -- That missed that the UPDATE policy itself should never have existed: it
  -- was gated on tgt_can_manage alone, which has no wing/ownership
  -- bound, so it let any coordinator UPDATE any row institution-wide via a
  -- direct PostgREST call - a live prod security hole. All writes must go
  -- through the Task 4 SECURITY DEFINER RPCs; RLS on teacher_targets denying
  -- by default (no permissive policy for these commands) is what enforces
  -- that, so no INSERT, UPDATE or DELETE policy may exist on it at all.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='teacher_targets'
                AND cmd IN ('INSERT','UPDATE','DELETE')) THEN
    RAISE EXCEPTION 'FAIL: teacher_targets has an INSERT, UPDATE or DELETE policy - all writes must go through the Task 4 RPCs, never a client-facing policy';
  END IF;

  -- STRENGTHENED (post-review, 2026-09-15, same session as the rename below):
  -- restate the security property fixed above still holds AFTER the rename -
  -- exactly one SELECT policy on teacher_targets, and it must be the named
  -- one, not merely "no write policy". A rename sweep that dropped and
  -- recreated policies is exactly the kind of change that could leave a
  -- duplicate or a stray policy behind without this being caught by the
  -- write-policy-absence check above alone.
  --
  -- FIX (review round 2, 2026-09-15): this originally covered teacher_targets
  -- only. teacher_target_periods has the identical shape (one SELECT policy,
  -- teacher_target_periods_select, no write policy - the ledger is written
  -- only by the Task 4/6 SECURITY DEFINER RPCs) and was never asserted here at
  -- all, so a stray or duplicate policy on IT would have gone uncaught. Loop
  -- over both tables so neither is silently skipped.
  FOR v_missing IN
    SELECT t.tablename FROM (VALUES
      ('teacher_targets',        'teacher_targets_select'),
      ('teacher_target_periods','teacher_target_periods_select')
    ) AS t(tablename, expected_policy)
    WHERE (SELECT count(*) FROM pg_policies
            WHERE schemaname='public' AND tablename=t.tablename) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policies
                        WHERE schemaname='public' AND tablename=t.tablename
                          AND policyname=t.expected_policy AND cmd='SELECT')
  LOOP
    RAISE EXCEPTION 'FAIL: % must have exactly one policy, %_select (SELECT) - found % polic(y/ies)',
      v_missing, v_missing,
      (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename=v_missing);
  END LOOP;

  -- teacher_targets_no_self_parent must exist and cover the documented
  -- expression, not just the name (same identity-over-name principle as the
  -- UNIQUE constraint check above).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'teacher_targets_no_self_parent'
      AND c.contype = 'c'
      AND c.conrelid = 'public.teacher_targets'::regclass
      AND pg_get_constraintdef(c.oid) = 'CHECK ((parent_target_id IS DISTINCT FROM id))'
  ) THEN
    RAISE EXCEPTION 'FAIL: teacher_targets_no_self_parent CHECK constraint is missing or has the wrong definition';
  END IF;

  -- RENAME (fixed 2026-09-15, before Task 4 ships): these three helpers were
  -- originally named tt_target_eligible, tt_can_manage_targets, tt_owns_target.
  -- `tt_` is already the Timetable module's namespace and CLAUDE.md 7 routes
  -- any `tt_*` match to the `timetable-module` skill, so a future agent
  -- opening one of these would load the wrong subsystem's context. Renamed
  -- to tgt_eligible / tgt_can_manage / tgt_owns_target; this script checks the
  -- new names only - the old ones must no longer exist at all (checked below).
  --
  -- STRENGTHENED: the anon/PUBLIC privilege check below is vacuously true for a
  -- function that does not exist at all (no privilege row -> no match -> no
  -- exception). Assert each helper exists with the documented signature and is
  -- STABLE SECURITY DEFINER before trusting the grant check.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_eligible'
      AND pg_get_function_identity_arguments(p.oid) = '_user uuid, _institution uuid'
      AND p.prorettype = 'boolean'::regtype AND p.prosecdef AND p.provolatile='s'
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_eligible(uuid, uuid) is missing or is not a STABLE SECURITY DEFINER boolean function';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_can_manage'
      AND pg_get_function_identity_arguments(p.oid) = '_user uuid, _institution uuid'
      AND p.prorettype = 'boolean'::regtype AND p.prosecdef AND p.provolatile='s'
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_can_manage(uuid, uuid) is missing or is not a STABLE SECURITY DEFINER boolean function';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_owns_target'
      AND pg_get_function_identity_arguments(p.oid) = '_user uuid, _target uuid'
      AND p.prorettype = 'boolean'::regtype AND p.prosecdef AND p.provolatile='s'
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_owns_target(uuid, uuid) is missing or is not a STABLE SECURITY DEFINER boolean function';
  END IF;

  -- The rename must have actually DROPPED the old names, not just added new
  -- ones alongside them - a stale duplicate with the old name and the old
  -- grants is exactly the kind of thing that gets called by accident later.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('tt_target_eligible','tt_can_manage_targets','tt_owns_target')
  ) THEN
    RAISE EXCEPTION 'FAIL: an old tt_-named helper (tt_target_eligible / tt_can_manage_targets / tt_owns_target) still exists - the rename to tgt_ must DROP the old function, not merely add the new one alongside it';
  END IF;

  -- FIX (review round 1, 2026-09-15): behavioral check that tgt_can_manage
  -- no longer admits coordinators, run against real prod role-holders rather
  -- than string-matching the function source. Excludes anyone who ALSO holds
  -- an admin role (dual-role users legitimately pass via that role - CLAUDE.md
  -- 25 - so including them would produce a false failure, not a real one).
  -- A coordinator with no admin role satisfying this function would mean the
  -- fix regressed and the institution-wide write hole is back.
  --
  -- FIX (review round 2, 2026-09-15): the round-1 version of this check was
  -- `IF EXISTS (... AND wrongly admitted ...)`. On a database with zero pure
  -- coordinators, that EXISTS finds no candidate row, tgt_can_manage is
  -- never called on anyone, and the block PASSES having proved nothing - the
  -- exact vacuous-pass shape already caught and fixed once in this same file
  -- (the anon-grant check for a tt_ helper that was never created). Count the
  -- population FIRST: zero pure coordinators is now itself a hard FAIL, so a
  -- database that cannot exercise this check cannot silently satisfy it -
  -- only a nonzero population with zero wrongly-admitted rows is a real PASS.
  SELECT count(*),
         count(*) FILTER (WHERE public.tgt_can_manage(ur.user_id, p.institution_id))
    INTO v_pure_coordinator_count, v_wrongly_admitted_count
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'coordinator'
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur2
      WHERE ur2.user_id = ur.user_id
        AND ur2.role IN ('school_admin','super_school_admin','super_admin')
    );

  IF v_pure_coordinator_count = 0 THEN
    RAISE EXCEPTION 'FAIL: cannot verify tgt_can_manage rejects coordinators - no pure coordinator (role=coordinator, holding no school_admin/super_school_admin/super_admin role) exists in this database to test the behavior against; the assertion was SKIPPED, not satisfied';
  END IF;
  IF v_wrongly_admitted_count > 0 THEN
    RAISE EXCEPTION 'FAIL: tgt_can_manage still admits % of % pure coordinator(s) with no admin role', v_wrongly_admitted_count, v_pure_coordinator_count;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee IN ('anon','PUBLIC')
                AND routine_name IN ('tgt_eligible','tgt_can_manage','tgt_owns_target')) THEN
    RAISE EXCEPTION 'FAIL: anon or PUBLIC still holds EXECUTE on a tgt_ helper';
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

  -- FIX (review round 1, 2026-09-15): a row must not be able to parent itself.
  -- id and parent_target_id are both fixed to the same value up front so the
  -- self-reference exists at INSERT time; scope='teacher' + wing_id NULL keeps
  -- teacher_targets_wing_chk satisfied so only the new constraint can fire.
  DECLARE
    v_self_id uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.teacher_targets
      (id, institution_id, metric, scope, owner_id, parent_target_id, target_value, starts_on, ends_on)
    SELECT v_self_id, i.id, 'exams_published', 'teacher', p.id, v_self_id, 5, '2026-01-01', '2026-01-31'
    FROM public.institutions i, public.profiles p WHERE p.institution_id = i.id LIMIT 1;
    RAISE EXCEPTION 'FAIL: a self-parenting row was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;   -- correct
    WHEN raise_exception THEN RAISE;
  END;

  RAISE NOTICE 'PASS: verify-02 schema';
END $$;
