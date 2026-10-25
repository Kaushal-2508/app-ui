-- Verify Task 4: the four write RPCs (tgt_create_wing_target,
-- tgt_split_wing_target, tgt_create_teacher_targets, tgt_stop_target).
--
-- This is the most security-sensitive task in the plan: these four
-- SECURITY DEFINER functions are the ONLY way anything can ever write
-- teacher_targets / teacher_target_periods (no INSERT/UPDATE/DELETE policy
-- exists on either table). Existence/signature checks alone are nearly
-- worthless here -- what matters is that the functions REFUSE the calls they
-- should refuse. Part 2 below proves four specific refusals against REAL
-- production accounts (real admin, real coordinators, real teacher, real
-- student), impersonated via the same set_config('request.jwt.claims', ...)
-- technique scripts/verify-photo-authority.sql already uses in this repo,
-- since auth.uid() reads that GUC. Everything Part 2 writes is inside an
-- explicit BEGIN ... ROLLBACK so no row survives the run either way.
--
-- OUTPUT NOTE (same as verify-photo-authority.sql): the Management API's
-- query endpoint returns only the last statement's rows, or the first error
-- if any statement raises. So Part 2 records every cell into a TEMP TABLE,
-- SELECTs it back (that SELECT is what a passing run actually returns), and
-- only THEN raises if any row is a FAIL -- a hard fail-loud gate that blanks
-- the row detail on a genuinely failing run, which is an acceptable trade
-- for never silently returning HTTP 201 on a real failure.

-- ============================================================
-- PART 1: structural checks (existence, identity, shape, grants).
-- Read-only against the catalogs; safe to run standalone.
-- ============================================================
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['tgt_create_wing_target','tgt_split_wing_target',
                              'tgt_create_teacher_targets','tgt_stop_target'] LOOP
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
    -- Unlike Task 3's counters, these four ARE called directly by clients, so
    -- authenticated must positively hold EXECUTE -- absence is a regression,
    -- not a hardening.
    IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                    WHERE routine_schema='public' AND routine_name=v_fn
                      AND grantee='authenticated' AND privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated lacks EXECUTE on % - this RPC is called directly by the client', v_fn;
    END IF;
  END LOOP;

  -- Identity + shape, not name alone (Task 2/3 review lesson: a same-named
  -- function with the wrong signature would still pass a name-only check).
  -- pg_get_function_identity_arguments is ORDER-sensitive, which is exactly
  -- what proves correction 6 (defaulted params must trail _teacher_ids, not
  -- precede it, as the plan's prose wrongly had it).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_create_wing_target'
      AND pg_get_function_identity_arguments(p.oid) =
        '_wing_id uuid, _coordinator_id uuid, _metric text, _target_value integer, _starts_on date, _ends_on date, _cadence_unit text, _cadence_n integer, _note text'
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND p.pronargdefaults = 3
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_create_wing_target does not have the documented (uuid,uuid,text,integer,date,date,text,integer,text)->jsonb signature with 3 trailing defaults';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_split_wing_target'
      AND pg_get_function_identity_arguments(p.oid) = '_parent_id uuid, _allocations jsonb'
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND p.pronargdefaults = 0
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_split_wing_target does not have the documented (uuid,jsonb)->jsonb signature';
  END IF;

  -- CORRECTION 6, pinned precisely: _teacher_ids uuid[] must sit BEFORE the
  -- three defaulted trailing params, not after them (the plan's own prose
  -- block had it after, which is illegal PL/pgSQL - a non-default parameter
  -- cannot follow one that has a default). The exact ordered identity-argument
  -- string below is the only way to distinguish the correct order from the
  -- wrong one; pronargdefaults=3 additionally proves exactly three of the
  -- eight are optional, no more, no fewer.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_create_teacher_targets'
      AND pg_get_function_identity_arguments(p.oid) =
        '_metric text, _target_value integer, _starts_on date, _ends_on date, _teacher_ids uuid[], _cadence_unit text, _cadence_n integer, _note text'
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND p.pronargdefaults = 3
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_create_teacher_targets does not have the documented signature/order - _teacher_ids must precede the three trailing defaults (_cadence_unit, _cadence_n, _note), never follow them';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_stop_target'
      AND pg_get_function_identity_arguments(p.oid) = '_target_id uuid'
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND p.pronargdefaults = 0
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_stop_target does not have the documented (uuid)->jsonb signature';
  END IF;

  -- No tt_-named write RPC exists under the old Timetable-colliding prefix
  -- (these four never shipped under tt_ - this just guards against a future
  -- accidental reintroduction under the wrong module's namespace).
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('tt_create_wing_target','tt_split_wing_target',
                        'tt_create_teacher_targets','tt_stop_target')
  ) THEN
    RAISE EXCEPTION 'FAIL: a tt_-named write RPC exists - this module uses tgt_ only, tt_ is the Timetable module''s namespace';
  END IF;

  -- FIX ROUND 1, finding 1: idx_teacher_targets_one_active_child_per_teacher
  -- must exist with EXACTLY the documented partial-unique shape - identity
  -- over name, same as every other index/constraint check in this suite.
  -- tgt_split_wing_target's ON CONFLICT clause infers this index by column
  -- list + predicate, so a wrong predicate here would silently break that
  -- inference (a different, loud error at call time, not a quiet one - but
  -- pinning the exact shape here catches drift before it ever reaches a call).
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='teacher_targets'
      AND indexname='idx_teacher_targets_one_active_child_per_teacher'
      AND indexdef LIKE '%UNIQUE INDEX%'
      AND indexdef LIKE '%(parent_target_id, owner_id)%'
      AND indexdef LIKE '%parent_target_id IS NOT NULL%'
      AND indexdef LIKE '%status <> ''stopped''%'
  ) THEN
    RAISE EXCEPTION 'FAIL: idx_teacher_targets_one_active_child_per_teacher is missing, is not UNIQUE, or does not have the documented (parent_target_id, owner_id) WHERE parent_target_id IS NOT NULL AND status <> ''stopped'' shape';
  END IF;

  RAISE NOTICE 'PASS: verify-04 part 1, structural checks';
END $$;

-- ============================================================
-- PART 2: behavioural authorisation proofs, against real prod accounts.
-- Wrapped in an explicit transaction that always ends in ROLLBACK, so every
-- row this part creates (via legitimate, successful RPC calls used as
-- fixtures) is undone regardless of pass or fail.
-- ============================================================
BEGIN;

CREATE TEMP TABLE zz_targets_results (
  seq    int PRIMARY KEY,
  label  text NOT NULL,
  status text NOT NULL
);

DO $suite$
DECLARE
  v_wing         uuid;
  v_wing_inst    uuid;
  v_coord        uuid;   -- real, PURE coordinator (no admin role) assigned to v_wing
  v_admin        uuid;   -- real school_admin/super_school_admin in v_wing_inst
  v_other_coord  uuid;   -- a DIFFERENT real PURE coordinator, never the pool's owner
  v_non_admin    uuid;   -- real plain teacher (no admin/coordinator role) in v_wing_inst
  v_ineligible   uuid;   -- real plain student in v_wing_inst
  v_pool_id      uuid;
  v_direct_id    uuid;
  v_child_id     uuid;   -- v_non_admin's split-off child row under v_pool_id
  v_child_count  int;
  v_notif_before int;
  v_notif_after  int;
  v_notif_type   text;
  v_notif_ids_before uuid[];  -- see note at first use: created_at cannot disambiguate
  v_seq          int := 0;
  v_fails        int := 0;
  v_res          jsonb;
  v_today        date := CURRENT_DATE;  -- fixture window only, not an institution-timezone "today" computation
BEGIN
  -- ---- discover real accounts. Non-vacuous: fail loud, naming exactly what
  -- population is missing, rather than silently skipping (the same failure
  -- shape verify-02's pure-coordinator check was built to close). ----

  -- A wing whose assigned coordinator holds NO admin role (so tgt_can_manage
  -- genuinely rejects them - a coordinator who ALSO happens to be an admin
  -- would make the OR-vs-AND distinction in tgt_stop_target untestable), in
  -- an institution that also has a school_admin/super_school_admin to act as
  -- the pool creator.
  SELECT w.id, w.institution_id, wa.user_id
    INTO v_wing, v_wing_inst, v_coord
  FROM public.wings w
  JOIN public.wing_assignments wa ON wa.wing_id = w.id
  JOIN public.user_roles ur_coord ON ur_coord.user_id = wa.user_id AND ur_coord.role = 'coordinator'
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = wa.user_id
                        AND ur2.role IN ('school_admin','super_school_admin','super_admin'))
    AND EXISTS (SELECT 1 FROM public.profiles pa
                 JOIN public.user_roles ura ON ura.user_id = pa.id
                                            AND ura.role IN ('school_admin','super_school_admin')
                 WHERE pa.institution_id = w.institution_id)
  LIMIT 1;
  IF v_wing IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no wing exists whose assigned coordinator is a PURE coordinator (holds no admin role) in an institution that also has a school_admin/super_school_admin; the suite was SKIPPED, not satisfied';
  END IF;

  SELECT p.id INTO v_admin
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('school_admin','super_school_admin')
  WHERE p.institution_id = v_wing_inst
  LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no school_admin/super_school_admin exists in institution % even though the discovery query above required one; the suite was SKIPPED, not satisfied', v_wing_inst;
  END IF;

  SELECT p.id INTO v_non_admin
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'teacher'
  WHERE p.institution_id = v_wing_inst
    AND p.is_active IS NOT FALSE
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id
                        AND ur2.role IN ('school_admin','super_school_admin','super_admin','coordinator'))
  LIMIT 1;
  IF v_non_admin IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no plain, active teacher (no admin/coordinator role) exists in institution % to test the non-admin-refusal and eligible-allocation paths; the suite was SKIPPED, not satisfied', v_wing_inst;
  END IF;

  SELECT p.id INTO v_ineligible
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'student'
  WHERE p.institution_id = v_wing_inst
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id AND ur2.role IN ('teacher','coordinator'))
  LIMIT 1;
  IF v_ineligible IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no plain student exists in institution % to test the eligibility-refusal path; the suite was SKIPPED, not satisfied', v_wing_inst;
  END IF;

  SELECT p.id INTO v_other_coord
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'coordinator'
  WHERE p.id <> v_coord
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id
                        AND ur2.role IN ('school_admin','super_school_admin','super_admin'))
  LIMIT 1;
  IF v_other_coord IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no SECOND real pure coordinator (distinct from the wing''s own, holding no admin role) exists anywhere in this database to test "a coordinator cannot split a pool they do not own"; the suite was SKIPPED, not satisfied';
  END IF;

  -- ================================================================
  -- 1. A NON-ADMIN CANNOT CREATE A WING TARGET.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_non_admin::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.tgt_create_wing_target(v_wing, v_coord, 'exams_published', 5, v_today, v_today + 30);
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_wing_target: non-admin refused', 'FAIL - accepted a non-admin caller');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'targets: only an administrator%' THEN
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_wing_target: non-admin refused', 'ok');
    ELSE
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_wing_target: non-admin refused', 'FAIL - wrong error: ' || SQLERRM);
    END IF;
  END;

  -- Fixture + happy-path proof: the tightened admin-only check must still
  -- let a REAL admin through.
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT public.tgt_create_wing_target(v_wing, v_coord, 'exams_published', 10, v_today, v_today + 30) INTO v_res;
    v_pool_id := (v_res ->> 'target_id')::uuid;
    IF v_pool_id IS NULL THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_wing_target: admin happy path', 'FAIL - no target_id returned');
    ELSE
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_wing_target: admin happy path', 'ok');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_wing_target: admin happy path', 'FAIL - ' || SQLERRM);
  END;

  -- ================================================================
  -- 2. A COORDINATOR CANNOT SPLIT A POOL THEY DO NOT OWN.
  -- FIX ROUND 1, finding 2: "does not exist" and "not owned by you" are now
  -- ONE message, so this expects the combined text, not the old distinct
  -- ownership-specific one.
  -- ================================================================
  v_seq := v_seq + 1;
  IF v_pool_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_coord::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.tgt_split_wing_target(v_pool_id,
        jsonb_build_array(jsonb_build_object('teacher_id', v_non_admin, 'value', 5)));
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: non-owner coordinator refused', 'FAIL - accepted a non-owner coordinator');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'targets: that target does not exist, or you cannot manage it' THEN
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: non-owner coordinator refused', 'ok');
      ELSE
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: non-owner coordinator refused', 'FAIL - wrong error: ' || SQLERRM);
      END IF;
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: non-owner coordinator refused', 'FAIL - prerequisite pool fixture missing, cannot test');
  END IF;

  -- ================================================================
  -- 3. A TEACHER TARGET CANNOT BE CREATED FOR SOMEONE WHO IS NOT ELIGIBLE.
  -- Proved on BOTH write paths that can create a scope='teacher' row.
  -- ================================================================
  v_seq := v_seq + 1;
  IF v_pool_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.tgt_split_wing_target(v_pool_id,
        jsonb_build_array(jsonb_build_object('teacher_id', v_ineligible, 'value', 5)));
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: ineligible allocation refused', 'FAIL - accepted an ineligible teacher_id');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE '%cannot be given a target' THEN
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: ineligible allocation refused', 'ok');
      ELSE
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: ineligible allocation refused', 'FAIL - wrong error: ' || SQLERRM);
      END IF;
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: ineligible allocation refused', 'FAIL - prerequisite pool fixture missing, cannot test');
  END IF;

  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.tgt_create_teacher_targets('exams_published', 5, v_today, v_today + 30, ARRAY[v_ineligible]);
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_teacher_targets: ineligible teacher refused', 'FAIL - accepted an ineligible teacher_id');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%cannot be given a target' THEN
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_teacher_targets: ineligible teacher refused', 'ok');
    ELSE
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_teacher_targets: ineligible teacher refused', 'FAIL - wrong error: ' || SQLERRM);
    END IF;
  END;

  -- ================================================================
  -- 4. A PARENT THAT IS NOT scope='wing' IS REJECTED (correction 5).
  -- Fixture: admin directly assigns v_non_admin a teacher-scope target
  -- (parent_target_id IS NULL). v_non_admin, the row's OWNER, then tries to
  -- "split" their own target as if it were a pool.
  --
  -- FIX ROUND 1, finding 2: since existence+ownership are now ONE combined
  -- gate checked BEFORE the scope check, the caller here must be the row's
  -- actual owner - an unrelated caller (the original test used v_coord, who
  -- does not own this row) would now be rejected at the combined
  -- existence-or-ownership gate instead, never reaching the scope check at
  -- all, and this assertion would silently stop testing correction 5. Using
  -- the genuine owner passes that gate and isolates the scope check as the
  -- thing actually under test.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.tgt_create_teacher_targets('exams_published', 3, v_today, v_today + 30, ARRAY[v_non_admin]);
    SELECT id INTO v_direct_id FROM public.teacher_targets
      WHERE owner_id = v_non_admin AND scope = 'teacher' AND parent_target_id IS NULL
      ORDER BY created_at DESC LIMIT 1;
    IF v_direct_id IS NULL THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_teacher_targets: direct-assign fixture created', 'FAIL - could not locate the created row');
    ELSE
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_teacher_targets: direct-assign fixture created', 'ok');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_create_teacher_targets: direct-assign fixture created', 'FAIL - ' || SQLERRM);
  END;

  v_seq := v_seq + 1;
  IF v_direct_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_non_admin::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.tgt_split_wing_target(v_direct_id,
        jsonb_build_array(jsonb_build_object('teacher_id', v_non_admin, 'value', 1)));
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: non-wing parent rejected', 'FAIL - accepted a teacher-scope row as a parent');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'targets: only a wing target can be shared out' THEN
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: non-wing parent rejected', 'ok');
      ELSE
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: non-wing parent rejected', 'FAIL - wrong error: ' || SQLERRM);
      END IF;
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: non-wing parent rejected', 'FAIL - prerequisite direct-assign fixture missing, cannot test');
  END IF;

  -- ================================================================
  -- 5. Valid split still works (happy path + gap math), now that all the
  -- negative cases above have run against the SAME pool without corrupting it
  -- (every rejected call above raised before writing anything).
  -- ================================================================
  v_seq := v_seq + 1;
  IF v_pool_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT public.tgt_split_wing_target(v_pool_id,
        jsonb_build_array(jsonb_build_object('teacher_id', v_non_admin, 'value', 4))) INTO v_res;
      IF (v_res ->> 'gap')::int <> 6 THEN   -- pool 10, allocated 4
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: owner happy path + gap math', 'FAIL - gap was ' || (v_res ->> 'gap'));
      ELSE
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: owner happy path + gap math', 'ok');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: owner happy path + gap math', 'FAIL - ' || SQLERRM);
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: owner happy path + gap math', 'FAIL - prerequisite pool fixture missing, cannot test');
  END IF;

  -- ================================================================
  -- 5b. FIX ROUND 1, FINDING 1: re-splitting a pool that includes a teacher
  -- with a CLOSED-period child must UPDATE that same row, never duplicate it.
  --
  -- The bug only engages for a child that SURVIVES the wholesale DELETE,
  -- which only spares a child with an existing closed (met/missed) period -
  -- an un-historied child gets deleted and freshly re-inserted regardless
  -- (never hits ON CONFLICT), so a re-split of a never-measured allocation
  -- would NOT have exercised the old bug or this fix. A closed-period row is
  -- manufactured directly (Task 6's evaluator, which would normally close a
  -- period, does not exist yet) to reproduce the exact scenario finding 1
  -- describes.
  -- ================================================================
  IF v_pool_id IS NOT NULL THEN
    SELECT id INTO v_child_id FROM public.teacher_targets
      WHERE parent_target_id = v_pool_id AND owner_id = v_non_admin AND status <> 'stopped'
      ORDER BY created_at DESC LIMIT 1;
  END IF;

  v_seq := v_seq + 1;
  IF v_child_id IS NOT NULL THEN
    BEGIN
      -- Manufacture the "already measured" history a real evaluator run
      -- would leave: one CLOSED period for this child, target_value snapshot
      -- 4 (this child's value from assertion 5 above) - the DELETE in
      -- tgt_split_wing_target must skip this row because of this fixture row.
      INSERT INTO public.teacher_target_periods
        (target_id, institution_id, teacher_id, period_index, period_start, period_end,
         target_value, achieved_value, status, closed_at)
      VALUES
        (v_child_id, v_wing_inst, v_non_admin, 1, v_today - 7, v_today - 1, 4, 4, 'met', now());
      INSERT INTO zz_targets_results VALUES (v_seq, 'fixture: closed period recorded for the split-off child', 'ok');
    EXCEPTION WHEN OTHERS THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'fixture: closed period recorded for the split-off child', 'FAIL - ' || SQLERRM);
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'fixture: closed period recorded for the split-off child', 'FAIL - prerequisite split-off child missing, cannot test');
  END IF;

  -- Re-split with a DIFFERENT value (7, was 4) for the SAME teacher. Before
  -- the fix this created a second active row (ON CONFLICT DO NOTHING never
  -- fired - nothing to conflict on); after the fix it must UPDATE the SAME
  -- row in place.
  v_seq := v_seq + 1;
  IF v_pool_id IS NOT NULL AND v_child_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
    -- Snapshot IDS, not just a count: this whole suite runs inside ONE
    -- transaction, and plain now() (used by every notification INSERT in the
    -- migration) returns the TRANSACTION's start time, not wall-clock time -
    -- every notification this suite creates shares the identical created_at.
    -- v_non_admin already holds an earlier target_assigned notification from
    -- the direct-assign fixture (assertion 4) with that SAME timestamp, so
    -- "ORDER BY created_at DESC LIMIT 1" cannot reliably pick the row this
    -- re-split just inserted - ids are unique (gen_random_uuid()) where
    -- timestamps are not, so the new row is found by set difference instead.
    SELECT array_agg(id) INTO v_notif_ids_before FROM public.notifications
      WHERE user_id = v_non_admin AND type IN ('target_assigned','target_updated');
    v_notif_before := COALESCE(array_length(v_notif_ids_before, 1), 0);
    BEGIN
      PERFORM public.tgt_split_wing_target(v_pool_id,
        jsonb_build_array(jsonb_build_object('teacher_id', v_non_admin, 'value', 7)));

      SELECT count(*) INTO v_child_count FROM public.teacher_targets
        WHERE parent_target_id = v_pool_id AND owner_id = v_non_admin AND status <> 'stopped';

      IF v_child_count <> 1 THEN
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: re-split UPDATES the same row, never duplicates', 'FAIL - found ' || v_child_count || ' active child row(s) for this teacher, expected exactly 1');
      ELSIF NOT EXISTS (SELECT 1 FROM public.teacher_targets WHERE id = v_child_id AND target_value = 7) THEN
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: re-split UPDATES the same row, never duplicates', 'FAIL - the ORIGINAL row id did not receive the new value 7 (a duplicate row under a NEW id would also make v_child_count=1 only if the old one were removed - checking the SAME id proves it was an UPDATE, not delete+reinsert)');
      ELSIF NOT EXISTS (SELECT 1 FROM public.teacher_target_periods WHERE target_id = v_child_id AND status = 'met' AND target_value = 4) THEN
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: re-split UPDATES the same row, never duplicates', 'FAIL - the closed period''s own historical target_value (4) was disturbed by the re-split');
      ELSE
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: re-split UPDATES the same row, never duplicates', 'ok');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: re-split UPDATES the same row, never duplicates', 'FAIL - ' || SQLERRM);
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: re-split UPDATES the same row, never duplicates', 'FAIL - prerequisite fixture missing, cannot test');
  END IF;

  -- The re-split above changed the teacher's number (4 -> 7): must have sent
  -- exactly one NEW notification, and it must be the "updated" copy, not
  -- another "you have a new target" (this is a re-allocation, not a first
  -- assignment).
  v_seq := v_seq + 1;
  IF v_pool_id IS NOT NULL AND v_child_id IS NOT NULL THEN
    SELECT count(*) INTO v_notif_after FROM public.notifications
      WHERE user_id = v_non_admin AND type IN ('target_assigned','target_updated');
    -- The new row is whichever one's id was NOT in the "before" snapshot -
    -- see the note above on why created_at ordering cannot be trusted here.
    SELECT type INTO v_notif_type FROM public.notifications
      WHERE user_id = v_non_admin AND type IN ('target_assigned','target_updated')
        AND NOT (id = ANY(COALESCE(v_notif_ids_before, ARRAY[]::uuid[])))
      LIMIT 1;
    IF v_notif_after <> v_notif_before + 1 THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: changed re-split sends exactly one "updated" notification', 'FAIL - notification count went from ' || v_notif_before || ' to ' || v_notif_after || ', expected +1');
    ELSIF v_notif_type <> 'target_updated' THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: changed re-split sends exactly one "updated" notification', 'FAIL - newest notification type was ' || v_notif_type || ', expected target_updated');
    ELSE
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: changed re-split sends exactly one "updated" notification', 'ok');
    END IF;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: changed re-split sends exactly one "updated" notification', 'FAIL - prerequisite fixture missing, cannot test');
  END IF;

  -- Re-split AGAIN with the SAME value (7 -> 7): no notification at all -
  -- a re-split that leaves the number unchanged is noise, not news.
  v_seq := v_seq + 1;
  IF v_pool_id IS NOT NULL AND v_child_id IS NOT NULL THEN
    SELECT count(*) INTO v_notif_before FROM public.notifications
      WHERE user_id = v_non_admin AND type IN ('target_assigned','target_updated');
    BEGIN
      PERFORM public.tgt_split_wing_target(v_pool_id,
        jsonb_build_array(jsonb_build_object('teacher_id', v_non_admin, 'value', 7)));
      SELECT count(*) INTO v_notif_after FROM public.notifications
        WHERE user_id = v_non_admin AND type IN ('target_assigned','target_updated');
      IF v_notif_after <> v_notif_before THEN
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: unchanged re-split sends NO notification', 'FAIL - notification count changed from ' || v_notif_before || ' to ' || v_notif_after || ', expected no change');
      ELSE
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: unchanged re-split sends NO notification', 'ok');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: unchanged re-split sends NO notification', 'FAIL - ' || SQLERRM);
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_split_wing_target: unchanged re-split sends NO notification', 'FAIL - prerequisite fixture missing, cannot test');
  END IF;

  -- ================================================================
  -- 6. tgt_stop_target: the corrected OR, BOTH branches, plus the negative.
  -- ================================================================
  -- 6a. Neither owner nor admin -> refused. FIX ROUND 1, finding 2: expects
  -- the combined existence-or-authority message now, not the old distinct one.
  v_seq := v_seq + 1;
  IF v_pool_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_coord::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.tgt_stop_target(v_pool_id);
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: non-owner non-admin refused', 'FAIL - accepted an unrelated coordinator');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'targets: that target does not exist, or you cannot manage it' THEN
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: non-owner non-admin refused', 'ok');
      ELSE
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: non-owner non-admin refused', 'FAIL - wrong error: ' || SQLERRM);
      END IF;
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: non-owner non-admin refused', 'FAIL - prerequisite pool fixture missing, cannot test');
  END IF;

  -- 6b. THE core fix under test: a PURE coordinator (tgt_can_manage is FALSE
  -- for them by construction of v_coord above) MUST still be able to stop a
  -- target they OWN. If tgt_stop_target still used AND instead of OR, this
  -- call would wrongly fail here - this is the one assertion that actually
  -- distinguishes the fixed code from the brief's original (AND) version.
  v_seq := v_seq + 1;
  IF v_pool_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.tgt_stop_target(v_pool_id);
      IF EXISTS (SELECT 1 FROM public.teacher_targets WHERE id = v_pool_id AND status = 'stopped')
         AND NOT EXISTS (SELECT 1 FROM public.teacher_targets WHERE parent_target_id = v_pool_id AND status <> 'stopped') THEN
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: pure-coordinator owner can stop own pool + cascades to children', 'ok');
      ELSE
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: pure-coordinator owner can stop own pool + cascades to children', 'FAIL - status not stopped as expected');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: pure-coordinator owner can stop own pool + cascades to children', 'FAIL - ' || SQLERRM);
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: pure-coordinator owner can stop own pool + cascades to children', 'FAIL - prerequisite pool fixture missing, cannot test');
  END IF;

  -- 6c. The OTHER branch of the OR: an admin who is NOT the owner can still
  -- stop a target, via tgt_can_manage.
  v_seq := v_seq + 1;
  IF v_direct_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.tgt_stop_target(v_direct_id);
      IF EXISTS (SELECT 1 FROM public.teacher_targets WHERE id = v_direct_id AND status = 'stopped') THEN
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: admin (not owner) can stop via tgt_can_manage branch', 'ok');
      ELSE
        v_fails := v_fails + 1;
        INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: admin (not owner) can stop via tgt_can_manage branch', 'FAIL - status not stopped');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: admin (not owner) can stop via tgt_can_manage branch', 'FAIL - ' || SQLERRM);
    END;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: admin (not owner) can stop via tgt_can_manage branch', 'FAIL - prerequisite direct-assign fixture missing, cannot test');
  END IF;

  -- ================================================================
  -- 7. Unauthenticated caller refused, not silently no-op (carried from the
  -- original brief's Step 2).
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', NULL, true);
  BEGIN
    PERFORM public.tgt_stop_target('00000000-0000-0000-0000-000000000000'::uuid);
    v_fails := v_fails + 1;
    INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: unauthenticated caller refused', 'FAIL - accepted a NULL auth.uid()');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'targets: not authenticated' THEN
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: unauthenticated caller refused', 'ok');
    ELSE
      v_fails := v_fails + 1;
      INSERT INTO zz_targets_results VALUES (v_seq, 'tgt_stop_target: unauthenticated caller refused', 'FAIL - wrong error: ' || SQLERRM);
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ---- summary ----
  v_seq := v_seq + 1;
  IF v_fails > 0 THEN
    INSERT INTO zz_targets_results VALUES (v_seq, 'SUMMARY', v_fails || ' assertion(s) FAILED');
  ELSE
    INSERT INTO zz_targets_results VALUES (v_seq, 'SUMMARY', 'ALL WRITE-RPC AUTHORISATION ASSERTIONS PASSED');
  END IF;
END $suite$;

SELECT seq, label, status FROM zz_targets_results ORDER BY seq;

-- Fail loud: on a pass this is a no-op and the SELECT above is the last thing
-- returned. On a fail it raises, turning the whole response into this error
-- (per the Management API's all-or-nothing batch behaviour) - a loud failure
-- with less row-level detail beats a silent HTTP 201 pass on a genuinely
-- failing suite.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM zz_targets_results WHERE status LIKE 'FAIL%') THEN
    RAISE EXCEPTION 'Write-RPC authorisation suite FAILED - see the SELECT above for which cell(s) failed.'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ROLLBACK;
