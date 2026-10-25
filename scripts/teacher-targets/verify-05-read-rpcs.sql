-- Verify Task 5: the two read RPCs (tgt_targets_overview, tgt_my_targets).
--
-- These are STABLE SECURITY DEFINER functions granted to `authenticated`
-- directly, and each does its OWN row filtering in plpgsql (there is no RLS
-- policy backing them -- they read past RLS as the definer). A name-and-grant
-- check alone cannot prove that filtering is correct: a broken WHERE clause
-- (e.g. dropping the `v_admin OR ...` guard, or reintroducing the old inline
-- ownership subquery instead of calling tgt_owns_target) would still pass
-- every Part 1 check while leaking every teacher's numbers to every other
-- teacher. Part 2 proves the filtering behaviourally, against real accounts,
-- the same way verify-04 proved the write RPCs' authorisation -- wrapped in an
-- explicit BEGIN ... ROLLBACK so the fixtures it creates (via the real,
-- already-shipped write RPCs) never survive the run.

-- ============================================================
-- PART 1: structural checks (existence, identity, shape, grants).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='tgt_targets_overview') THEN
    RAISE EXCEPTION 'FAIL: tgt_targets_overview is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='tgt_my_targets') THEN
    RAISE EXCEPTION 'FAIL: tgt_my_targets is missing';
  END IF;

  -- No tt_-named read RPC exists under the Timetable-colliding prefix (these
  -- two never shipped under tt_ -- guards against a future accidental
  -- reintroduction under the wrong module's namespace).
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('tt_targets_overview','tt_my_targets')) THEN
    RAISE EXCEPTION 'FAIL: a tt_-named read RPC exists - this module uses tgt_ only, tt_ is the Timetable module''s namespace';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee IN ('anon','PUBLIC')
                AND routine_name IN ('tgt_targets_overview','tgt_my_targets')) THEN
    RAISE EXCEPTION 'FAIL: anon or PUBLIC holds EXECUTE on a read RPC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                  WHERE routine_schema='public' AND grantee='authenticated' AND privilege_type='EXECUTE'
                    AND routine_name='tgt_targets_overview') THEN
    RAISE EXCEPTION 'FAIL: authenticated lacks EXECUTE on tgt_targets_overview - it is called directly by the client';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                  WHERE routine_schema='public' AND grantee='authenticated' AND privilege_type='EXECUTE'
                    AND routine_name='tgt_my_targets') THEN
    RAISE EXCEPTION 'FAIL: authenticated lacks EXECUTE on tgt_my_targets - it is called directly by the client';
  END IF;

  -- Identity + shape, not name alone: signature, return type, defaults,
  -- volatility (STABLE, never VOLATILE: they are reads) and SECURITY DEFINER.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_targets_overview'
      AND pg_get_function_identity_arguments(p.oid) = '_metric text'
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND p.pronargdefaults = 1
      AND p.provolatile = 's'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_targets_overview does not have the documented (_metric text DEFAULT NULL)->jsonb STABLE SECURITY DEFINER shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_my_targets'
      AND pg_get_function_identity_arguments(p.oid) = ''
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND p.pronargdefaults = 0
      AND p.provolatile = 's'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_my_targets does not have the documented ()->jsonb STABLE SECURITY DEFINER shape';
  END IF;

  RAISE NOTICE 'PASS: verify-05 part 1, structural checks';
END $$;

-- ============================================================
-- PART 2: behavioural scoping proofs, against real prod accounts.
-- Wrapped in an explicit transaction that always ends in ROLLBACK.
-- ============================================================
BEGIN;

CREATE TEMP TABLE zz_read_results (
  seq    int PRIMARY KEY,
  label  text NOT NULL,
  status text NOT NULL
);

DO $suite$
DECLARE
  v_wing        uuid;
  v_wing_inst   uuid;
  v_coord       uuid;   -- real PURE coordinator (no admin role), assigned to v_wing
  v_admin       uuid;   -- real school_admin/super_school_admin in v_wing_inst
  v_teacher_a   uuid;   -- real plain teacher, gets a 4-value child
  v_teacher_b   uuid;   -- a SECOND real plain teacher, gets a 6-value child
  v_bystander   uuid;   -- real student in the same institution, owns nothing
  v_pool_id     uuid;
  v_child_a     uuid;
  v_child_b     uuid;
  v_res         jsonb;
  v_elem        jsonb;
  v_seq         int := 0;
  v_fails       int := 0;
  v_today       date := CURRENT_DATE;  -- fixture window only
BEGIN
  -- ---- discover real accounts, fail loud (not silently skip) if the
  -- population this suite needs does not exist. ----
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
    RAISE EXCEPTION 'FAIL: cannot verify - no wing exists whose assigned coordinator is a PURE coordinator in an institution that also has an admin; the suite was SKIPPED, not satisfied';
  END IF;

  SELECT p.id INTO v_admin
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('school_admin','super_school_admin')
  WHERE p.institution_id = v_wing_inst
  LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no admin found in institution % even though discovery required one', v_wing_inst;
  END IF;

  SELECT p.id INTO v_teacher_a
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'teacher'
  WHERE p.institution_id = v_wing_inst
    AND p.is_active IS NOT FALSE
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id
                        AND ur2.role IN ('school_admin','super_school_admin','super_admin','coordinator'))
  ORDER BY p.id
  LIMIT 1;
  IF v_teacher_a IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no plain active teacher exists in institution %', v_wing_inst;
  END IF;

  SELECT p.id INTO v_teacher_b
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'teacher'
  WHERE p.institution_id = v_wing_inst
    AND p.is_active IS NOT FALSE
    AND p.id <> v_teacher_a
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id
                        AND ur2.role IN ('school_admin','super_school_admin','super_admin','coordinator'))
  ORDER BY p.id
  LIMIT 1;
  IF v_teacher_b IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no SECOND distinct plain active teacher exists in institution % - the cross-teacher scoping proof needs two', v_wing_inst;
  END IF;

  SELECT p.id INTO v_bystander
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'student'
  WHERE p.institution_id = v_wing_inst
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id AND ur2.role IN ('teacher','coordinator'))
  LIMIT 1;
  IF v_bystander IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no plain student exists in institution % to prove a non-participant sees nothing', v_wing_inst;
  END IF;

  -- ---- build the fixture: one wing pool, split 4/6 between two teachers ----
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_create_wing_target(v_wing, v_coord, 'exams_published', 10, v_today, v_today + 30) INTO v_res;
  v_pool_id := (v_res ->> 'target_id')::uuid;
  IF v_pool_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - fixture pool creation failed: %', v_res;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
  PERFORM public.tgt_split_wing_target(v_pool_id, jsonb_build_array(
    jsonb_build_object('teacher_id', v_teacher_a, 'value', 4),
    jsonb_build_object('teacher_id', v_teacher_b, 'value', 6)
  ));
  SELECT id INTO v_child_a FROM public.teacher_targets WHERE parent_target_id = v_pool_id AND owner_id = v_teacher_a AND status <> 'stopped';
  SELECT id INTO v_child_b FROM public.teacher_targets WHERE parent_target_id = v_pool_id AND owner_id = v_teacher_b AND status <> 'stopped';
  IF v_child_a IS NULL OR v_child_b IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - fixture split did not produce both child rows';
  END IF;

  -- ================================================================
  -- 1. TEACHER A sees ONLY their own child - not teacher B's, not the pool
  --    fully "as admin" (is_admin must read false for them).
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher_a::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_targets_overview() INTO v_res;
  IF (v_res ->> 'is_admin')::boolean IS DISTINCT FROM false THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: teacher A is_admin=false', 'FAIL - is_admin was ' || (v_res ->> 'is_admin'));
  ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'targets') e WHERE (e ->> 'id')::uuid = v_child_a) THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: teacher A is_admin=false', 'FAIL - teacher A cannot see their own target');
  ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'targets') e WHERE (e ->> 'id')::uuid = v_child_b) THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: teacher A is_admin=false', 'FAIL - teacher A can see teacher B''s target - cross-teacher leak');
  ELSE
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: teacher A is_admin=false', 'ok');
  END IF;

  -- ================================================================
  -- 2. ADMIN sees the pool AND both children, and the pool's aggregate
  --    (allocated=10, teacher_count=2) is computed server-side correctly.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_targets_overview() INTO v_res;
  SELECT e INTO v_elem FROM jsonb_array_elements(v_res -> 'targets') e WHERE (e ->> 'id')::uuid = v_pool_id;
  IF (v_res ->> 'is_admin')::boolean IS DISTINCT FROM true THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: admin sees pool + both children + correct aggregate', 'FAIL - is_admin was ' || (v_res ->> 'is_admin'));
  ELSIF v_elem IS NULL THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: admin sees pool + both children + correct aggregate', 'FAIL - admin cannot see the pool row at all');
  ELSIF (v_elem ->> 'allocated')::int <> 10 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: admin sees pool + both children + correct aggregate', 'FAIL - allocated was ' || (v_elem ->> 'allocated') || ', expected 10 (4+6)');
  ELSIF (v_elem ->> 'teacher_count')::int <> 2 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: admin sees pool + both children + correct aggregate', 'FAIL - teacher_count was ' || (v_elem ->> 'teacher_count') || ', expected 2');
  ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'targets') e WHERE (e ->> 'id')::uuid = v_child_a)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'targets') e WHERE (e ->> 'id')::uuid = v_child_b) THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: admin sees pool + both children + correct aggregate', 'FAIL - admin cannot see one or both children');
  ELSE
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: admin sees pool + both children + correct aggregate', 'ok');
  END IF;

  -- ================================================================
  -- 3. THE COORDINATOR (pool owner, not an admin) sees the pool + both
  --    children via tgt_owns_target's parent-owner branch.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_targets_overview() INTO v_res;
  IF (v_res ->> 'is_admin')::boolean IS DISTINCT FROM false THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: pure coordinator sees own pool + children via tgt_owns_target', 'FAIL - is_admin was ' || (v_res ->> 'is_admin'));
  ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'targets') e WHERE (e ->> 'id')::uuid = v_pool_id)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'targets') e WHERE (e ->> 'id')::uuid = v_child_a)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'targets') e WHERE (e ->> 'id')::uuid = v_child_b) THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: pure coordinator sees own pool + children via tgt_owns_target', 'FAIL - coordinator cannot see the pool or both children they own');
  ELSE
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: pure coordinator sees own pool + children via tgt_owns_target', 'ok');
  END IF;

  -- ================================================================
  -- 4. A BYSTANDER (real student, same institution, no relation to any of
  --    these rows) sees NONE of the fixture rows.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bystander::text, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT public.tgt_targets_overview() INTO v_res;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'targets') e
                WHERE (e ->> 'id')::uuid IN (v_pool_id, v_child_a, v_child_b)) THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: bystander sees none of the fixture rows', 'FAIL - a student saw a target row they have no relation to');
    ELSE
      INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: bystander sees none of the fixture rows', 'ok');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: bystander sees none of the fixture rows', 'FAIL - ' || SQLERRM);
  END;

  -- ================================================================
  -- 5. tgt_my_targets: teacher A sees exactly their own row with the right
  --    number, and NOT teacher B's.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher_a::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_my_targets() INTO v_res;
  IF jsonb_array_length(v_res -> 'targets') <> 1 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_my_targets: teacher A sees exactly their own row', 'FAIL - returned ' || jsonb_array_length(v_res -> 'targets') || ' row(s), expected 1');
  ELSIF ((v_res -> 'targets' -> 0) ->> 'id')::uuid <> v_child_a THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_my_targets: teacher A sees exactly their own row', 'FAIL - the one row returned was not teacher A''s own target');
  ELSIF ((v_res -> 'targets' -> 0) ->> 'target_value')::int <> 4 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_my_targets: teacher A sees exactly their own row', 'FAIL - target_value was ' || ((v_res -> 'targets' -> 0) ->> 'target_value') || ', expected 4');
  ELSE
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_my_targets: teacher A sees exactly their own row', 'ok');
  END IF;

  -- ================================================================
  -- 6. Unauthenticated caller refused, not silently returning empty.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', NULL, true);
  BEGIN
    PERFORM public.tgt_targets_overview();
    v_fails := v_fails + 1;
    INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: unauthenticated caller refused', 'FAIL - accepted a NULL auth.uid()');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'targets: not authenticated' THEN
      INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: unauthenticated caller refused', 'ok');
    ELSE
      v_fails := v_fails + 1;
      INSERT INTO zz_read_results VALUES (v_seq, 'tgt_targets_overview: unauthenticated caller refused', 'FAIL - wrong error: ' || SQLERRM);
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);

  v_seq := v_seq + 1;
  IF v_fails > 0 THEN
    INSERT INTO zz_read_results VALUES (v_seq, 'SUMMARY', v_fails || ' assertion(s) FAILED');
  ELSE
    INSERT INTO zz_read_results VALUES (v_seq, 'SUMMARY', 'ALL READ-RPC SCOPING ASSERTIONS PASSED');
  END IF;
END $suite$;

SELECT seq, label, status FROM zz_read_results ORDER BY seq;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM zz_read_results WHERE status LIKE 'FAIL%') THEN
    RAISE EXCEPTION 'Read-RPC scoping suite FAILED - see the SELECT above for which cell(s) failed.'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ROLLBACK;
