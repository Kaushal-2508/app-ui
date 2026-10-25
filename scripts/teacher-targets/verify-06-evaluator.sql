-- Verify Task 6: the nightly evaluator (tgt_evaluate_targets) and its cron job.
--
-- The single most important property here is that a CLOSED period is frozen:
-- that is the entire reason teacher_target_periods exists as a ledger rather
-- than a live view (20260915120100's own header comment). A naive re-run
-- proving "the totals happen not to have changed" would pass even on a BROKEN
-- implementation, if no new exam/homework happened to be published between
-- the two calls - that is a vacuous pass. Part 2 instead TAMPERS a closed
-- period directly to sentinel values no real recompute could ever produce
-- (424242 / 999999), re-runs the evaluator, and asserts the sentinel survives
-- untouched - a broken WHERE-guard or a missing CONTINUE WHEN would revert it
-- to the real (small) recomputed numbers and this would fail loudly.

-- ============================================================
-- PART 1: structural checks (existence, identity, shape, grants, cron).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='tgt_evaluate_targets') THEN
    RAISE EXCEPTION 'FAIL: tgt_evaluate_targets is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='tt_evaluate_targets') THEN
    RAISE EXCEPTION 'FAIL: a tt_-named evaluator exists - this module uses tgt_ only, tt_ is the Timetable module''s namespace';
  END IF;

  -- Cron- and ops-only: NOT client callable, unlike Task 5's two read RPCs.
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND routine_name='tgt_evaluate_targets'
                AND grantee IN ('anon','PUBLIC','authenticated')) THEN
    RAISE EXCEPTION 'FAIL: tgt_evaluate_targets must be cron-only, not client-callable';
  END IF;

  -- Identity + shape: one optional uuid arg, jsonb return, SECURITY DEFINER,
  -- and VOLATILE (never STABLE/IMMUTABLE - it writes).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='tgt_evaluate_targets'
      AND pg_get_function_identity_arguments(p.oid) = '_institution_id uuid'
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND p.pronargdefaults = 1
      AND p.provolatile = 'v'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_evaluate_targets does not have the documented (_institution_id uuid DEFAULT NULL)->jsonb VOLATILE SECURITY DEFINER shape';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'teacher-targets-daily') THEN
    RAISE EXCEPTION 'FAIL: cron job teacher-targets-daily is not scheduled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'teacher-targets-daily'
                    AND schedule = '35 0 * * *'
                    AND active
                    AND command LIKE '%tgt_evaluate_targets%') THEN
    RAISE EXCEPTION 'FAIL: teacher-targets-daily is not active on schedule 35 0 * * * calling tgt_evaluate_targets';
  END IF;

  RAISE NOTICE 'PASS: verify-06 part 1, structural checks';
END $$;

-- ============================================================
-- PART 2: behavioural proofs, against a real institution/admin/teacher.
-- Wrapped in an explicit transaction that always ends in ROLLBACK.
-- ============================================================
BEGIN;

CREATE TEMP TABLE zz_eval_results (
  seq    int PRIMARY KEY,
  label  text NOT NULL,
  status text NOT NULL
);

DO $suite$
DECLARE
  v_inst        uuid;
  v_admin       uuid;
  v_teacher     uuid;
  v_target_id   uuid;
  v_res         jsonb;
  v_seq         int := 0;
  v_fails       int := 0;
  v_today       date := CURRENT_DATE;  -- fixture window only
  v_count_1     int;
  v_sum_1       bigint;
  v_count_2     int;
  v_sum_2       bigint;
  v_p1_ach      int;
  v_p1_tgt      int;
  v_p1_status   text;
BEGIN
  -- ---- discover a real institution with both an admin and an eligible
  -- plain teacher. Fail loud, not silently, if none exists. ----
  SELECT p.id, p.institution_id INTO v_admin, v_inst
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('school_admin','super_school_admin')
  WHERE EXISTS (
    SELECT 1 FROM public.profiles pt
    JOIN public.user_roles urt ON urt.user_id = pt.id AND urt.role = 'teacher'
    WHERE pt.institution_id = p.institution_id
      AND pt.is_active IS NOT FALSE
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                        WHERE ur2.user_id = pt.id
                          AND ur2.role IN ('school_admin','super_school_admin','super_admin','coordinator'))
  )
  LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no institution has both an admin and an eligible plain teacher; the suite was SKIPPED, not satisfied';
  END IF;

  SELECT p.id INTO v_teacher
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'teacher'
  WHERE p.institution_id = v_inst
    AND p.is_active IS NOT FALSE
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id
                        AND ur2.role IN ('school_admin','super_school_admin','super_admin','coordinator'))
  ORDER BY p.id
  LIMIT 1;
  IF v_teacher IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - discovery query found a teacher but the follow-up lookup found none in institution %', v_inst;
  END IF;

  -- ---- fixture: one teacher-scope target, cadence 5 days, window spans
  -- both past (closed periods) and future (stays open/active), so a real
  -- evaluator run genuinely produces both a closed and an open period, and
  -- the target itself stays 'active' (ends_on > today) for a second sweep.
  --
  -- With starts_on = today-12, ends_on = today+5, cadence 5 days, tgt_periods
  -- deterministically yields exactly 3 periods up to "today":
  --   period 1: today-12 .. today-8   (end < today -> CLOSES this run)
  --   period 2: today-7  .. today-3   (end < today -> CLOSES this run)
  --   period 3: today-2  .. today+2   (end >= today -> stays OPEN)
  -- ----
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_create_teacher_targets('exams_published', 1, v_today - 12, v_today + 5,
                                           ARRAY[v_teacher], 'day', 5) INTO v_res;
  SELECT id INTO v_target_id FROM public.teacher_targets
    WHERE owner_id = v_teacher AND scope = 'teacher' AND starts_on = v_today - 12 AND ends_on = v_today + 5
    ORDER BY created_at DESC LIMIT 1;
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - fixture target creation failed: %', v_res;
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ================================================================
  -- 1. FIRST RUN produces exactly the 3 expected periods, with the exact
  --    boundaries the period math dictates, 2 closed + 1 open.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM public.tgt_evaluate_targets(v_inst);

  SELECT count(*) INTO v_count_1 FROM public.teacher_target_periods WHERE target_id = v_target_id;
  IF v_count_1 <> 3 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_eval_results VALUES (v_seq, 'first run: exactly 3 periods created', 'FAIL - found ' || v_count_1 || ', expected 3');
  ELSIF NOT EXISTS (SELECT 1 FROM public.teacher_target_periods
                      WHERE target_id = v_target_id AND period_index = 1
                        AND period_start = v_today - 12 AND period_end = v_today - 8
                        AND status <> 'open' AND closed_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.teacher_target_periods
                      WHERE target_id = v_target_id AND period_index = 2
                        AND period_start = v_today - 7 AND period_end = v_today - 3
                        AND status <> 'open' AND closed_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.teacher_target_periods
                      WHERE target_id = v_target_id AND period_index = 3
                        AND period_start = v_today - 2 AND period_end = v_today + 2
                        AND status = 'open' AND closed_at IS NULL) THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_eval_results VALUES (v_seq, 'first run: exactly 3 periods created', 'FAIL - period boundaries or open/closed split did not match the documented math');
  ELSE
    INSERT INTO zz_eval_results VALUES (v_seq, 'first run: exactly 3 periods created', 'ok');
  END IF;

  -- ================================================================
  -- 2. IDEMPOTENCY: two immediate runs leave this fixture's row count and
  --    achieved-value total identical.
  -- ================================================================
  v_seq := v_seq + 1;
  SELECT count(*), COALESCE(sum(achieved_value), 0) INTO v_count_1, v_sum_1
  FROM public.teacher_target_periods WHERE target_id = v_target_id;

  PERFORM public.tgt_evaluate_targets(v_inst);

  SELECT count(*), COALESCE(sum(achieved_value), 0) INTO v_count_2, v_sum_2
  FROM public.teacher_target_periods WHERE target_id = v_target_id;

  IF v_count_2 <> v_count_1 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_eval_results VALUES (v_seq, 'idempotency: second run changes neither row count nor achieved totals', 'FAIL - row count went from ' || v_count_1 || ' to ' || v_count_2);
  ELSIF v_sum_2 <> v_sum_1 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_eval_results VALUES (v_seq, 'idempotency: second run changes neither row count nor achieved totals', 'FAIL - achieved total went from ' || v_sum_1 || ' to ' || v_sum_2);
  ELSE
    INSERT INTO zz_eval_results VALUES (v_seq, 'idempotency: second run changes neither row count nor achieved totals', 'ok');
  END IF;

  -- ================================================================
  -- 3. THE closed-period freeze, proved with a sentinel no real recompute
  --    could ever produce. Tamper period 1 directly (bypassing the
  --    evaluator entirely), re-run, and prove the sentinel survives.
  -- ================================================================
  v_seq := v_seq + 1;
  UPDATE public.teacher_target_periods
  SET achieved_value = 424242, target_value = 999999
  WHERE target_id = v_target_id AND period_index = 1;

  PERFORM public.tgt_evaluate_targets(v_inst);

  SELECT achieved_value, target_value, status
    INTO v_p1_ach, v_p1_tgt, v_p1_status
  FROM public.teacher_target_periods
  WHERE target_id = v_target_id AND period_index = 1;

  IF v_p1_ach <> 424242 OR v_p1_tgt <> 999999 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_eval_results VALUES (v_seq, 'closed period 1 is never rewritten (sentinel survives a re-run)', 'FAIL - sentinel was overwritten: achieved=' || v_p1_ach || ' target=' || v_p1_tgt || ' - a closed period got recomputed');
  ELSIF v_p1_status = 'open' THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_eval_results VALUES (v_seq, 'closed period 1 is never rewritten (sentinel survives a re-run)', 'FAIL - period 1 was reopened');
  ELSE
    INSERT INTO zz_eval_results VALUES (v_seq, 'closed period 1 is never rewritten (sentinel survives a re-run)', 'ok');
  END IF;

  -- Row count must still be exactly 3 after the tamper + third run: no
  -- duplicate row was created for period 1 either.
  v_seq := v_seq + 1;
  SELECT count(*) INTO v_count_2 FROM public.teacher_target_periods WHERE target_id = v_target_id;
  IF v_count_2 <> 3 THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_eval_results VALUES (v_seq, 'row count still exactly 3 after tamper + third run', 'FAIL - found ' || v_count_2);
  ELSE
    INSERT INTO zz_eval_results VALUES (v_seq, 'row count still exactly 3 after tamper + third run', 'ok');
  END IF;

  -- ================================================================
  -- 4. Every closed period in the whole table (not just this fixture) has
  --    closed_at set - the invariant verify-06 was originally asked to hold.
  -- ================================================================
  v_seq := v_seq + 1;
  IF EXISTS (SELECT 1 FROM public.teacher_target_periods
              WHERE target_id = v_target_id AND status <> 'open' AND closed_at IS NULL) THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_eval_results VALUES (v_seq, 'every closed period on this fixture has closed_at set', 'FAIL - a closed period has no closed_at');
  ELSE
    INSERT INTO zz_eval_results VALUES (v_seq, 'every closed period on this fixture has closed_at set', 'ok');
  END IF;

  v_seq := v_seq + 1;
  IF v_fails > 0 THEN
    INSERT INTO zz_eval_results VALUES (v_seq, 'SUMMARY', v_fails || ' assertion(s) FAILED');
  ELSE
    INSERT INTO zz_eval_results VALUES (v_seq, 'SUMMARY', 'ALL EVALUATOR ASSERTIONS PASSED');
  END IF;
END $suite$;

SELECT seq, label, status FROM zz_eval_results ORDER BY seq;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM zz_eval_results WHERE status LIKE 'FAIL%') THEN
    RAISE EXCEPTION 'Evaluator suite FAILED - see the SELECT above for which cell(s) failed.'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ROLLBACK;
