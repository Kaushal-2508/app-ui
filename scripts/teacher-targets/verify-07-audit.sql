-- Verify Task 7: audit coverage for teacher_targets / teacher_target_periods,
-- including the first UPDATE arm anywhere in tg_audit_row's history.
--
-- A name-only trigger-exists check would pass even if someone attached the
-- WRONG function, a statement-level trigger (which tg_audit_row's NEW/OLD-
-- reading body cannot consume), or the UPDATE arm to the wrong table (the
-- ledger, which must stay silent). Part 1 pins identity (tgfoid = tg_audit_row,
-- row-level, not statement-level) and the explicit negative (no UPDATE trigger
-- on teacher_target_periods). Part 2 proves the whole thing behaviourally: a
-- real create, a real edit and a real delete, through the actual write RPCs,
-- each produce (or in the ledger-update case, deliberately do NOT produce) the
-- expected system_audit_logs row.

-- ============================================================
-- PART 1: structural checks (existence, identity, shape).
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['teacher_targets','teacher_target_periods'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
                    WHERE c.relname=t AND tr.tgname='zzz_audit_ins' AND NOT tr.tgisinternal
                      AND tr.tgfoid = 'public.tg_audit_row'::regproc
                      AND (tr.tgtype::int & 1) = 1) THEN
      RAISE EXCEPTION 'FAIL: % has no row-level INSERT audit trigger calling tg_audit_row', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
                    WHERE c.relname=t AND tr.tgname='zzz_audit_del' AND NOT tr.tgisinternal
                      AND tr.tgfoid = 'public.tg_audit_row'::regproc
                      AND (tr.tgtype::int & 1) = 1) THEN
      RAISE EXCEPTION 'FAIL: % has no row-level DELETE audit trigger calling tg_audit_row', t;
    END IF;
  END LOOP;

  -- The new arm: an EDIT to a target must leave a trace. Row-level (not the
  -- brief's original statement-level REFERENCING NEW TABLE sketch, which
  -- tg_audit_row's NEW/OLD-reading body cannot consume).
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
                  WHERE c.relname='teacher_targets' AND tr.tgname='zzz_audit_upd'
                    AND NOT tr.tgisinternal
                    AND tr.tgfoid = 'public.tg_audit_row'::regproc
                    AND (tr.tgtype::int & 1) = 1) THEN
    RAISE EXCEPTION 'FAIL: teacher_targets has no row-level UPDATE audit trigger calling tg_audit_row';
  END IF;

  -- The explicit negative: the ledger must NEVER get an UPDATE trigger, or
  -- the nightly evaluator would drown the one edit that matters in noise.
  IF EXISTS (SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
              WHERE c.relname='teacher_target_periods' AND tr.tgname='zzz_audit_upd'
                AND NOT tr.tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: teacher_target_periods has an UPDATE audit trigger - it must not, the nightly evaluator rewrites open rows every night';
  END IF;

  -- Argument identity: both entity labels are exactly as documented, and the
  -- UPDATE trigger really is attached with the SAME label as the INSERT/DELETE
  -- pair on teacher_targets (a copy-paste onto the wrong label would still
  -- pass a bare existence check).
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid
                  WHERE c.relname='teacher_targets' AND tr.tgname='zzz_audit_upd'
                    AND pg_get_triggerdef(tr.oid) LIKE '%tg_audit_row(''Teacher target'', '''')%') THEN
    RAISE EXCEPTION 'FAIL: teacher_targets'' zzz_audit_upd does not call tg_audit_row(''Teacher target'', '''')';
  END IF;

  RAISE NOTICE 'PASS: verify-07 part 1, structural checks';
END $$;

-- ============================================================
-- PART 2: behavioural proof - a real create, edit and delete, through the
-- real write RPCs, each land (or deliberately do not land) the right
-- system_audit_logs row. Wrapped in an explicit BEGIN ... ROLLBACK.
-- ============================================================
BEGIN;

CREATE TEMP TABLE zz_audit_results (
  seq    int PRIMARY KEY,
  label  text NOT NULL,
  status text NOT NULL
);

DO $suite$
DECLARE
  v_wing        uuid;
  v_wing_inst   uuid;
  v_coord       uuid;
  v_admin       uuid;
  v_teacher     uuid;
  v_res         jsonb;
  v_pool_id     uuid;
  v_child_id    uuid;
  v_direct_id   uuid;
  v_target3     uuid;
  v_period_id   uuid;
  v_cnt         int;
  v_seq         int := 0;
  v_fails       int := 0;
  v_today       date := CURRENT_DATE;
BEGIN
  -- ---- discover real accounts (same shape as verify-04/05/06) ----
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
  WHERE p.institution_id = v_wing_inst LIMIT 1;

  SELECT p.id INTO v_teacher
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'teacher'
  WHERE p.institution_id = v_wing_inst
    AND p.is_active IS NOT FALSE
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id
                        AND ur2.role IN ('school_admin','super_school_admin','super_admin','coordinator'))
  ORDER BY p.id LIMIT 1;
  IF v_teacher IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify - no plain active teacher exists in institution %', v_wing_inst;
  END IF;

  -- ================================================================
  -- 1. CREATE: a real INSERT through the write RPC lands an audit row.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_create_wing_target(v_wing, v_coord, 'exams_published', 10, v_today, v_today + 30) INTO v_res;
  v_pool_id := (v_res ->> 'target_id')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
  PERFORM public.tgt_split_wing_target(v_pool_id, jsonb_build_array(jsonb_build_object('teacher_id', v_teacher, 'value', 5)));
  SELECT id INTO v_child_id FROM public.teacher_targets WHERE parent_target_id = v_pool_id AND owner_id = v_teacher AND status <> 'stopped';

  IF v_child_id IS NULL THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_audit_results VALUES (v_seq, 'CREATE: split-off child audited on insert', 'FAIL - fixture child was not created');
  ELSIF NOT EXISTS (SELECT 1 FROM public.system_audit_logs
                      WHERE entity_type = 'Teacher target' AND entity_id = v_child_id
                        AND action = 'teacher_target_created'
                        AND (new_values ->> 'target_value')::int = 5) THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_audit_results VALUES (v_seq, 'CREATE: split-off child audited on insert', 'FAIL - no teacher_target_created row for the new child with target_value 5');
  ELSE
    INSERT INTO zz_audit_results VALUES (v_seq, 'CREATE: split-off child audited on insert', 'ok');
  END IF;

  -- ================================================================
  -- 2. EDIT: "who changed the number from 4 to 2" - here, active -> stopped,
  --    via tgt_stop_target's UPDATE. This is the new arm under test.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_create_teacher_targets('homework_published', 7, v_today, v_today + 30, ARRAY[v_teacher]) INTO v_res;
  SELECT id INTO v_direct_id FROM public.teacher_targets
    WHERE owner_id = v_teacher AND scope = 'teacher' AND parent_target_id IS NULL AND target_value = 7
    ORDER BY created_at DESC LIMIT 1;
  IF v_direct_id IS NULL THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_audit_results VALUES (v_seq, 'EDIT: tgt_stop_target audited with old/new status', 'FAIL - direct-assign fixture was not created');
  ELSE
    PERFORM public.tgt_stop_target(v_direct_id);
    IF NOT EXISTS (SELECT 1 FROM public.system_audit_logs
                     WHERE entity_type = 'Teacher target' AND entity_id = v_direct_id
                       AND action = 'teacher_target_updated'
                       AND old_values ->> 'status' = 'active'
                       AND new_values ->> 'status' = 'stopped') THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_audit_results VALUES (v_seq, 'EDIT: tgt_stop_target audited with old/new status', 'FAIL - no teacher_target_updated row showing active -> stopped');
    ELSE
      INSERT INTO zz_audit_results VALUES (v_seq, 'EDIT: tgt_stop_target audited with old/new status', 'ok');
    END IF;
  END IF;

  -- ================================================================
  -- 3. DELETE: tgt_split_wing_target's wholesale DELETE of an un-historied
  --    child (re-splitting the pool with an EMPTY allocation list) is
  --    audited too.
  -- ================================================================
  v_seq := v_seq + 1;
  IF v_child_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
    PERFORM public.tgt_split_wing_target(v_pool_id, '[]'::jsonb);
    IF EXISTS (SELECT 1 FROM public.teacher_targets WHERE id = v_child_id) THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_audit_results VALUES (v_seq, 'DELETE: re-split removing a child is audited', 'FAIL - the child row was not actually deleted by the empty re-split, fixture assumption broken');
    ELSIF NOT EXISTS (SELECT 1 FROM public.system_audit_logs
                        WHERE entity_type = 'Teacher target' AND entity_id = v_child_id
                          AND action = 'teacher_target_deleted') THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_audit_results VALUES (v_seq, 'DELETE: re-split removing a child is audited', 'FAIL - no teacher_target_deleted row for the removed child');
    ELSE
      INSERT INTO zz_audit_results VALUES (v_seq, 'DELETE: re-split removing a child is audited', 'ok');
    END IF;
  ELSE
    v_fails := v_fails + 1;
    INSERT INTO zz_audit_results VALUES (v_seq, 'DELETE: re-split removing a child is audited', 'FAIL - prerequisite child fixture missing, cannot test');
  END IF;

  -- ================================================================
  -- 4. THE LEDGER: an INSERT into teacher_target_periods (via the real
  --    evaluator) IS audited; a subsequent UPDATE of that SAME open row
  --    (also via the real evaluator, on conflict) is deliberately NOT.
  -- ================================================================
  v_seq := v_seq + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SELECT public.tgt_create_teacher_targets('exams_published', 3, v_today, v_today + 30, ARRAY[v_teacher]) INTO v_res;
  SELECT id INTO v_target3 FROM public.teacher_targets
    WHERE owner_id = v_teacher AND scope = 'teacher' AND parent_target_id IS NULL AND target_value = 3
    ORDER BY created_at DESC LIMIT 1;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF v_target3 IS NULL THEN
    v_fails := v_fails + 1;
    INSERT INTO zz_audit_results VALUES (v_seq, 'LEDGER: period insert audited, period update is not', 'FAIL - prerequisite target3 fixture missing');
  ELSE
    PERFORM public.tgt_evaluate_targets(v_wing_inst);
    SELECT id INTO v_period_id FROM public.teacher_target_periods WHERE target_id = v_target3 AND period_index = 1;

    IF v_period_id IS NULL THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_audit_results VALUES (v_seq, 'LEDGER: period insert audited, period update is not', 'FAIL - evaluator did not create a period row');
    ELSIF NOT EXISTS (SELECT 1 FROM public.system_audit_logs
                        WHERE entity_type = 'Teacher target period' AND entity_id = v_period_id
                          AND action = 'teacher_target_period_created') THEN
      v_fails := v_fails + 1;
      INSERT INTO zz_audit_results VALUES (v_seq, 'LEDGER: period insert audited, period update is not', 'FAIL - no teacher_target_period_created row for the new open period');
    ELSE
      SELECT count(*) INTO v_cnt FROM public.system_audit_logs
        WHERE entity_type = 'Teacher target period' AND entity_id = v_period_id;

      -- Re-run: the period is still open (ends_on far in the future), so this
      -- genuinely fires an UPDATE via ON CONFLICT ... DO UPDATE.
      PERFORM public.tgt_evaluate_targets(v_wing_inst);

      IF EXISTS (SELECT 1 FROM public.system_audit_logs
                  WHERE entity_type = 'Teacher target period' AND entity_id = v_period_id
                    AND action LIKE '%updated%') THEN
        v_fails := v_fails + 1;
        INSERT INTO zz_audit_results VALUES (v_seq, 'LEDGER: period insert audited, period update is not', 'FAIL - a teacher_target_period UPDATE was audited - the ledger must stay silent on UPDATE');
      ELSIF (SELECT count(*) FROM public.system_audit_logs
              WHERE entity_type = 'Teacher target period' AND entity_id = v_period_id) <> v_cnt THEN
        v_fails := v_fails + 1;
        INSERT INTO zz_audit_results VALUES (v_seq, 'LEDGER: period insert audited, period update is not', 'FAIL - audit row count for this period changed after a second evaluator run');
      ELSE
        INSERT INTO zz_audit_results VALUES (v_seq, 'LEDGER: period insert audited, period update is not', 'ok');
      END IF;
    END IF;
  END IF;

  v_seq := v_seq + 1;
  IF v_fails > 0 THEN
    INSERT INTO zz_audit_results VALUES (v_seq, 'SUMMARY', v_fails || ' assertion(s) FAILED');
  ELSE
    INSERT INTO zz_audit_results VALUES (v_seq, 'SUMMARY', 'ALL AUDIT ASSERTIONS PASSED');
  END IF;
END $suite$;

SELECT seq, label, status FROM zz_audit_results ORDER BY seq;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM zz_audit_results WHERE status LIKE 'FAIL%') THEN
    RAISE EXCEPTION 'Audit suite FAILED - see the SELECT above for which cell(s) failed.'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ROLLBACK;
