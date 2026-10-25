-- Deleted-user archive acceptance suite. Runs real DELETEs on auth.users so the LIVE
-- triggers capture (since 2026-10-09), forces the deferred completeness check with
-- SET CONSTRAINTS ... IMMEDIATE, all inside aborted subtransactions, then rolls
-- everything back. Assertions RECORD instead of raising.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/dua/test-capture.sql -OutFile "$env:TEMP\dua-test.json"
BEGIN;

CREATE TEMP TABLE t_out(n serial, result text, label text, detail text);

CREATE FUNCTION pg_temp.chk(p_pass boolean, p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $chk$
BEGIN
  INSERT INTO t_out(result, label, detail)
  VALUES (CASE WHEN coalesce(p_pass, false) THEN 'PASS' ELSE 'FAIL' END, p_label, p_detail);
END $chk$;

-- A check inside a rolled-back block cannot write to t_out (the rollback would erase it),
-- so it raises its result and the block's handler records it after the rollback.
CREATE FUNCTION pg_temp.done(p_pass boolean, p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $dn$
BEGIN
  RAISE EXCEPTION '%', 'DUA_RESULT' || jsonb_build_object('pass', coalesce(p_pass, false), 'label', p_label, 'detail', p_detail)::text;
END $dn$;

CREATE FUNCTION pg_temp.record(p_err text, p_label text) RETURNS void LANGUAGE plpgsql AS $rc$
DECLARE j jsonb;
BEGIN
  IF p_err LIKE 'DUA_RESULT%' THEN
    j := substr(p_err, 11)::jsonb;
    PERFORM pg_temp.chk((j->>'pass')::boolean, j->>'label', j->>'detail');
  ELSE
    PERFORM pg_temp.chk(false, p_label, p_err);
  END IF;
END $rc$;

-- Delete through the live triggers, run the deferred check now (not at commit), and
-- return the archive header(s) as jsonb; the caller then aborts.
CREATE FUNCTION pg_temp.del(p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $d$
BEGIN
  DELETE FROM auth.users WHERE id = ANY (p_ids);
  SET CONSTRAINTS auth.dua_check_after_delete IMMEDIATE;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) FROM dua.users u
           WHERE u.user_id = ANY (p_ids) AND u.kind <> 'legacy');
END $d$;

DO $test$
DECLARE
  v jsonb; v_student uuid; v_student2 uuid; v_teacher uuid; v_oly uuid; v_team uuid;
BEGIN
  SELECT id INTO v_team FROM auth.users WHERE email = 'team@salci.in';
  SELECT a.student_id INTO v_student FROM public.student_exam_attempts a GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;
  SELECT ca2.user_id INTO v_student2 FROM public.class_assignments ca1
    JOIN public.class_assignments ca2 ON ca2.class_id = ca1.class_id AND ca2.role = 'student' AND ca2.user_id <> v_student
   WHERE ca1.user_id = v_student AND ca1.role = 'student' LIMIT 1;
  SELECT o.evaluated_by INTO v_teacher FROM public.teacher_overrides o WHERE o.evaluated_by IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;
  SELECT o.auth_user_id INTO v_oly FROM public.oly_students o WHERE o.auth_user_id IS NOT NULL LIMIT 1;

  -- T1 heavy student: captured, complete, rows match
  BEGIN
    v := pg_temp.del(ARRAY[v_student]);
    PERFORM pg_temp.done(v->0->>'kind' = 'captured' AND (v->0->>'is_complete')::boolean, 'T1 heavy student captured and complete',
                        coalesce(v->0->>'completeness', ''));
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.record(SQLERRM, 'T1 heavy student');
  END;

  -- T2 app path: the intent written by admin-operations names the actor and source, and is used up
  BEGIN
    PERFORM public.dua_note_delete(ARRAY[v_teacher], v_team, 'app', false);
    v := pg_temp.del(ARRAY[v_teacher]);
    PERFORM pg_temp.done(v->0->>'source' = 'app' AND v->0->>'deleted_by' = v_team::text
                        AND v->0->>'deleted_by_name' IS NOT NULL AND v->0->>'kind' = 'captured'
                        AND EXISTS (SELECT 1 FROM dua.delete_intents d WHERE d.user_id = v_teacher
                                     AND d.consumed_at IS NOT NULL AND d.archive_id = (v->0->>'id')::uuid),
                        'T2 intent: actor named, source app, intent consumed', v::text);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.record(SQLERRM, 'T2 intent');
  END;

  -- T2b a stale intent (older than 10 minutes) and a cancelled one are both ignored
  BEGIN
    INSERT INTO dua.delete_intents (user_id, actor_id, source, created_at)
    VALUES (v_teacher, v_team, 'app:stale', now() - interval '11 minutes');
    PERFORM public.dua_note_delete(ARRAY[v_teacher], v_team, 'app:cancelled', false);
    PERFORM public.dua_cancel_delete_intent(v_teacher);
    v := pg_temp.del(ARRAY[v_teacher]);
    PERFORM pg_temp.done(v->0->>'source' = 'sql' AND v->0->>'deleted_by' IS NULL,
                        'T2b stale and cancelled intents never attribute a delete', v::text);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.record(SQLERRM, 'T2b stale intent');
  END;

  -- T3 Olympiad login: no archive at all
  BEGIN
    v := pg_temp.del(ARRAY[v_oly]);
    PERFORM pg_temp.done(jsonb_array_length(v) = 0, 'T3 Olympiad login skipped', v::text);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.record(SQLERRM, 'T3 Olympiad');
  END;

  -- T3b a SALCI student is never skipped by the Olympiad rule
  PERFORM pg_temp.chk(NOT dua.is_olympiad_account(v_student), 'T3b SALCI student not treated as Olympiad');

  -- T4 on request: header only
  BEGIN
    PERFORM set_config('salci.delete_on_request', 'on', true);
    v := pg_temp.del(ARRAY[v_student2]);
    PERFORM pg_temp.done(v->0->>'kind' = 'on_request' AND v->0->>'full_name' IS NULL AND v->0->>'email' IS NULL
                        AND NOT EXISTS (SELECT 1 FROM dua.rows r WHERE r.archive_id = (v->0->>'id')::uuid),
                        'T4 on-request keeps no name, email or rows', v::text);
    PERFORM set_config('salci.delete_on_request', 'off', true);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('salci.delete_on_request', 'off', true);
    PERFORM pg_temp.record(SQLERRM, 'T4 on request');
  END;

  -- T5 best_effort: injected capture failure still deletes and leaves a capture_failed header
  BEGIN
    PERFORM set_config('dua.test_fail', 'on', true);
    v := pg_temp.del(ARRAY[v_student2]);
    PERFORM pg_temp.done(v->0->>'kind' = 'capture_failed' AND v->0->>'error' LIKE '%dua test failure%'
                        AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_student2),
                        'T5 best_effort: delete proceeds, failure recorded', v::text);
    PERFORM set_config('dua.test_fail', 'off', true);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('dua.test_fail', 'off', true);
    PERFORM pg_temp.record(SQLERRM, 'T5 best_effort');
  END;

  -- T5b required: the same failure aborts the delete
  BEGIN
    UPDATE dua.settings SET capture_mode = 'required';
    PERFORM set_config('dua.test_fail', 'on', true);
    BEGIN
      v := pg_temp.del(ARRAY[v_student2]);
      PERFORM pg_temp.done(false, 'T5b required blocks the delete', 'delete went through');
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_temp.done(SQLERRM LIKE '%dua test failure%', 'T5b required blocks the delete', SQLERRM);
    END;
    PERFORM set_config('dua.test_fail', 'off', true);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('dua.test_fail', 'off', true);
    PERFORM pg_temp.record(SQLERRM, 'T5b required');
  END;

  -- T6 two classmates in ONE statement: both captured, both complete, shared rows not double-counted
  BEGIN
    v := pg_temp.del(ARRAY[v_student, v_student2]);
    PERFORM pg_temp.done(jsonb_array_length(v) = 2
                        AND (v->0->>'is_complete')::boolean AND (v->1->>'is_complete')::boolean,
                        'T6 multi-user statement both complete', v::text);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.record(SQLERRM, 'T6 multi-user');
  END;

  -- T7 no credential anywhere in the archive
  BEGIN
    v := pg_temp.del(ARRAY[v_teacher]);
    PERFORM pg_temp.done(NOT EXISTS (
        SELECT 1 FROM dua.rows r WHERE r.archive_id = (v->0->>'id')::uuid AND r.rows IS NOT NULL
          AND (r.rows::text ~* '"(encrypted_password|refresh_token_hmac_key|bank_account_number|pan_number|ifsc_code|fingerprint_template|face_descriptor|token)"\s*:'))
      AND NOT EXISTS (SELECT 1 FROM dua.rows r WHERE r.archive_id = (v->0->>'id')::uuid AND r.table_name LIKE 'auth.%'
                       AND r.table_name NOT IN ('auth.users', 'auth.identities') AND r.mode <> 'counts'),
      'T7 no credential columns or credential tables stored', '');
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.record(SQLERRM, 'T7 credentials');
  END;

  -- T7b a new table with a *_token column is stripped even without a policy row
  BEGIN
    CREATE TABLE public.dua_t7b (id uuid PRIMARY KEY, owner uuid REFERENCES public.profiles(id) ON DELETE CASCADE, api_token text, note text);
    INSERT INTO public.dua_t7b VALUES (gen_random_uuid(), v_student, 'SECRET-123', 'kept');
    v := pg_temp.del(ARRAY[v_student]);
    PERFORM pg_temp.done(EXISTS (SELECT 1 FROM dua.rows r WHERE r.archive_id = (v->0->>'id')::uuid AND r.table_name = 'public.dua_t7b'
                                 AND r.rows::text LIKE '%kept%' AND r.rows::text NOT LIKE '%SECRET-123%'),
                        'T7b new table captured, token column stripped', '');
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.record(SQLERRM, 'T7b new table');
  END;

  -- T8 grants
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public.dua_note_delete(uuid[], uuid, text, boolean)', 'EXECUTE')
                      AND NOT has_function_privilege('anon', 'public.dua_note_delete(uuid[], uuid, text, boolean)', 'EXECUTE')
                      AND has_function_privilege('service_role', 'public.dua_note_delete(uuid[], uuid, text, boolean)', 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', 'public.dua_cancel_delete_intent(uuid)', 'EXECUTE')
                      AND NOT has_function_privilege('anon', 'public.dua_cancel_delete_intent(uuid)', 'EXECUTE')
                      AND has_function_privilege('service_role', 'public.dua_cancel_delete_intent(uuid)', 'EXECUTE')
                      AND NOT has_schema_privilege('authenticated', 'dua', 'USAGE')
                      AND NOT has_schema_privilege('anon', 'dua', 'USAGE'),
                      'T8 grants: only service_role writes intents; dua closed');

  -- T9 guard
  PERFORM pg_temp.chk((SELECT count(*) FROM dua.unclassified_sensitive_columns()) = 0, 'T9 no unclassified sensitive columns');
END $test$;

SELECT result, label, detail FROM t_out ORDER BY n;
ROLLBACK;
