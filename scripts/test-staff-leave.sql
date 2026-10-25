-- Staff leave acceptance suite (migrations 20260928160000 + 20260928161000).
-- Runs as real teachers / coordinators / admins / a super admin against real
-- prod rows under RLS, then rolls everything back. Assertions RECORD instead of
-- raising, so one failure cannot hide the rest.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-staff-leave.sql -OutFile "$env:TEMP\staff-leave.json"
BEGIN;

CREATE TEMP TABLE t_out(n serial, result text, label text, detail text);
GRANT ALL ON t_out TO PUBLIC;
GRANT USAGE ON SEQUENCE t_out_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.chk(p_pass boolean, p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $chk$
BEGIN
  INSERT INTO t_out(result, label, detail)
  VALUES (CASE WHEN coalesce(p_pass, false) THEN 'PASS' ELSE 'FAIL' END, p_label, p_detail);
END $chk$;

CREATE FUNCTION pg_temp.as_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $as$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $as$;

CREATE FUNCTION pg_temp.as_owner()
RETURNS void LANGUAGE plpgsql AS $ow$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
END $ow$;

DO $test$
DECLARE
  v_inst uuid; v_coord uuid; v_teacher uuid; v_teacher2 uuid; v_admin uuid; v_admin2 uuid; v_super uuid;
  v_req uuid; v_req_past uuid; v_req_coord uuid; v_req_admin uuid; v_req_t2 uuid;
  v_state text; v_n int; v_m int; v_js jsonb; v_expect int; v_txt text;
  v_fut_from date := date '2026-10-03';   -- a Saturday
  v_fut_to   date := date '2026-10-05';   -- the Monday after (Sunday in between)
  v_past_from date := date '2026-09-21';  -- Monday
  v_past_to   date := date '2026-09-22';  -- Tuesday
  fn text;
BEGIN
  -- ── 0. cast ────────────────────────────────────────────────────────────
  SELECT wa.user_id, ca.user_id, cl.institution_id INTO v_coord, v_teacher, v_inst
    FROM public.wing_assignments wa
    JOIN public.user_roles rc ON rc.user_id = wa.user_id AND rc.role = 'coordinator'
    JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
    JOIN public.class_assignments ca ON ca.class_id = wcm.class_id AND ca.role = 'teacher'
    JOIN public.classes cl ON cl.id = ca.class_id AND cl.institution_id = rc.institution_id
    JOIN public.profiles pt ON pt.id = ca.user_id AND pt.institution_id = cl.institution_id
    JOIN public.profiles pc ON pc.id = wa.user_id AND pc.institution_id = cl.institution_id
   WHERE ca.user_id <> wa.user_id
     AND NOT public.is_institution_admin(ca.user_id, cl.institution_id)
     AND NOT public.is_institution_admin(wa.user_id, cl.institution_id)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ca.user_id AND r.role = 'coordinator')
   ORDER BY (cl.institution_id = (SELECT id FROM public.institutions WHERE name = 'Alliance International School')) DESC
   LIMIT 1;

  SELECT ur.user_id INTO v_teacher2
    FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.institution_id = v_inst
   WHERE ur.role = 'teacher' AND ur.institution_id = v_inst AND ur.user_id <> v_teacher
     AND NOT public.is_institution_admin(ur.user_id, v_inst)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ur.user_id AND r.role = 'coordinator')
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments ca
                       JOIN public.wing_class_mappings wcm ON wcm.class_id = ca.class_id
                       JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
                      WHERE ca.user_id = ur.user_id AND wa.user_id = v_coord)
   LIMIT 1;

  SELECT p.id INTO v_admin FROM public.profiles p
   WHERE p.institution_id = v_inst AND public.is_institution_admin(p.id, v_inst)
     AND NOT public.is_super_admin(p.id) ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_admin2 FROM public.profiles p
   WHERE p.institution_id = v_inst AND public.is_institution_admin(p.id, v_inst)
     AND NOT public.is_super_admin(p.id) AND p.id <> v_admin ORDER BY p.id LIMIT 1;
  SELECT ur.user_id INTO v_super FROM public.user_roles ur WHERE ur.role = 'super_admin' LIMIT 1;

  PERFORM pg_temp.chk(v_inst IS NOT NULL AND v_coord IS NOT NULL AND v_teacher IS NOT NULL
                      AND v_admin IS NOT NULL AND v_admin2 IS NOT NULL AND v_super IS NOT NULL,
    'cast found (coordinator + wing teacher + 2 admins + super admin)',
    format('inst=%s coord=%s teacher=%s teacher2=%s admin=%s admin2=%s', v_inst, v_coord, v_teacher, v_teacher2, v_admin, v_admin2));

  -- ── 1. grants ──────────────────────────────────────────────────────────
  FOREACH fn IN ARRAY ARRAY[
    'public.review_staff_leave(uuid,text,text)', 'public.can_review_staff_leave(uuid,uuid,uuid)',
    'public.admin_institution_counts()', 'public.admin_user_roster()',
    'public._staff_leave_workdays(uuid,date,date)', 'public._staff_leave_apply_days(uuid)',
    'public._staff_leave_revert_days(uuid)'] LOOP
    PERFORM pg_temp.chk(NOT has_function_privilege('anon', fn, 'EXECUTE'), 'anon has no EXECUTE on ' || fn);
  END LOOP;
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public._staff_leave_apply_days(uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._staff_leave_revert_days(uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._staff_leave_workdays(uuid,date,date)', 'EXECUTE'),
    'authenticated cannot call the internal day writers');
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('review_staff_leave','can_review_staff_leave','admin_institution_counts','admin_user_roster',
                       '_staff_leave_workdays','_staff_leave_apply_days','_staff_leave_revert_days')
     AND EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=X/%');
  PERFORM pg_temp.chk(v_n = 0, 'no PUBLIC EXECUTE left in proacl', format('%s functions still PUBLIC', v_n));

  -- ── 2. backfill wrote the pre-RPC approvals ────────────────────────────
  SELECT count(*) INTO v_n FROM public.staff_leave_requests q
   WHERE q.status = 'approved'
     AND NOT EXISTS (SELECT 1 FROM public.staff_attendance_records a
                      WHERE a.staff_id = q.user_id AND a.remarks = 'Approved leave ' || q.id)
     AND EXISTS (SELECT 1 FROM public._staff_leave_workdays(q.institution_id, q.start_date, q.end_date));
  PERFORM pg_temp.chk(v_n = 0, 'every earlier approval now has its on-leave days', format('%s without', v_n));

  -- ── 3. the frontend probe ──────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_teacher);
  BEGIN
    PERFORM public.review_staff_leave('00000000-0000-0000-0000-000000000000', 'probe');
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '22023', 'probe raises 22023 before touching anything', v_state);

  -- ── 4. the teacher applies; the ways to cheat are closed ──────────────
  INSERT INTO public.staff_leave_requests (user_id, institution_id, leave_type, start_date, end_date, reason)
  VALUES (v_teacher, v_inst, 'casual', v_fut_from, v_fut_to, 'suite') RETURNING id INTO v_req;
  PERFORM pg_temp.chk(v_req IS NOT NULL, 'teacher applies for own leave');

  BEGIN
    INSERT INTO public.staff_leave_requests (user_id, institution_id, leave_type, start_date, end_date, reason, status)
    VALUES (v_teacher, v_inst, 'casual', v_fut_from, v_fut_to, 'suite', 'approved');
    v_state := 'inserted';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'teacher cannot insert an already-approved request', v_state);

  UPDATE public.staff_leave_requests SET status = 'approved' WHERE id = v_req;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM pg_temp.chk(v_n = 0, 'teacher cannot approve own leave by UPDATE', format('%s rows updated', v_n));

  BEGIN
    PERFORM public.review_staff_leave(v_req, 'approved');
    v_state := 'decided';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'teacher cannot decide own leave through the RPC', v_state);

  -- a second teacher outside the coordinator's wing
  IF v_teacher2 IS NOT NULL THEN
    PERFORM pg_temp.as_owner();
    PERFORM pg_temp.as_user(v_teacher2);
    INSERT INTO public.staff_leave_requests (user_id, institution_id, leave_type, start_date, end_date, reason)
    VALUES (v_teacher2, v_inst, 'sick', v_fut_from, v_fut_from, 'suite') RETURNING id INTO v_req_t2;
    SELECT count(*) INTO v_n FROM public.staff_leave_requests WHERE id = v_req;
    PERFORM pg_temp.chk(v_n = 0, 'a teacher cannot see another teacher''s request');
  END IF;

  -- ── 5. the wing coordinator reviews ────────────────────────────────────
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_coord);
  SELECT count(*) INTO v_n FROM public.staff_leave_requests WHERE id = v_req;
  PERFORM pg_temp.chk(v_n = 1, 'coordinator sees a request from a teacher in the wing');
  IF v_req_t2 IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.staff_leave_requests WHERE id = v_req_t2;
    PERFORM pg_temp.chk(v_n = 0, 'coordinator does not see a teacher outside the wing');
    BEGIN
      PERFORM public.review_staff_leave(v_req_t2, 'approved');
      v_state := 'decided';
    EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
    END;
    PERFORM pg_temp.chk(v_state = '42501', 'coordinator cannot decide a teacher outside the wing', v_state);
  END IF;

  v_js := public.review_staff_leave(v_req, 'approved', 'enjoy');
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_expect FROM public._staff_leave_workdays(v_inst, v_fut_from, v_fut_to);
  SELECT count(*) INTO v_n FROM public.staff_attendance_records
   WHERE staff_id = v_teacher AND status = 'on_leave' AND remarks = 'Approved leave ' || v_req;
  PERFORM pg_temp.chk(v_n = v_expect AND v_expect BETWEEN 1 AND 2,
    'approval writes on_leave on the working days only', format('rows=%s workdays=%s result=%s', v_n, v_expect, v_js));
  SELECT count(*) INTO v_n FROM public.staff_attendance_records
   WHERE staff_id = v_teacher AND date = date '2026-10-04';
  PERFORM pg_temp.chk(v_n = 0, 'no on_leave row on the Sunday', format('%s rows', v_n));
  SELECT status || '/' || coalesce(reviewed_by::text, '-') || '/' || coalesce(reviewer_notes, '-') INTO v_txt
    FROM public.staff_leave_requests WHERE id = v_req;
  PERFORM pg_temp.chk(v_txt = 'approved/' || v_coord || '/enjoy', 'request stamped approved by the coordinator', v_txt);

  PERFORM pg_temp.as_user(v_coord);
  v_js := public.review_staff_leave(v_req, 'approved');
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_m FROM public.staff_attendance_records
   WHERE staff_id = v_teacher AND remarks = 'Approved leave ' || v_req;
  PERFORM pg_temp.chk((v_js->>'unchanged')::boolean AND v_m = v_expect, 'approving again changes nothing', v_js::text);

  -- ── 6. the teacher cannot withdraw it any more ─────────────────────────
  PERFORM pg_temp.as_user(v_teacher);
  DELETE FROM public.staff_leave_requests WHERE id = v_req;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM pg_temp.chk(v_n = 0, 'an approved request cannot be deleted by its owner', format('%s deleted', v_n));

  -- ── 7. the admin overturns it; the future days go back to the pass ─────
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_admin);
  v_js := public.review_staff_leave(v_req, 'rejected', 'short staffed');
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.staff_attendance_records
   WHERE staff_id = v_teacher AND date BETWEEN v_fut_from AND v_fut_to AND remarks LIKE '%' || v_req || '%';
  PERFORM pg_temp.chk(v_n = 0 AND (v_js->>'removed')::int = v_expect,
    'overturning removes the future on_leave rows', v_js::text);

  -- ── 8. past days: approve then overturn turns them back to absent ──────
  PERFORM pg_temp.as_user(v_teacher);
  INSERT INTO public.staff_leave_requests (user_id, institution_id, leave_type, start_date, end_date, reason)
  VALUES (v_teacher, v_inst, 'casual', v_past_from, v_past_to, 'suite past') RETURNING id INTO v_req_past;
  PERFORM pg_temp.as_owner();
  -- Deterministic past days (rolled back with everything else): the Monday
  -- was auto-marked absent, the Tuesday has no row at all. Both are days the
  -- leave must cover, so both must turn on_leave and then back to absent.
  DELETE FROM public.staff_attendance_records
   WHERE staff_id = v_teacher AND date BETWEEN v_past_from AND v_past_to;
  INSERT INTO public.staff_attendance_records (institution_id, staff_id, date, status, auto_marked_absent)
  VALUES (v_inst, v_teacher, v_past_from, 'absent', true);
  -- a balance row, so the charge and the refund are visible
  INSERT INTO public.staff_leave_balances (institution_id, user_id, academic_year, annual_total, annual_used,
                                           sick_total, sick_used, casual_total, casual_used)
  VALUES (v_inst, v_teacher, '2099-00', 10, 0, 10, 0, 10, 0)
  ON CONFLICT (institution_id, user_id, academic_year) DO NOTHING;
  PERFORM pg_temp.as_user(v_admin);
  v_js := public.review_staff_leave(v_req_past, 'approved');
  PERFORM pg_temp.as_owner();
  v_m := (v_js->>'marked')::int;
  SELECT casual_used INTO v_n FROM public.staff_leave_balances
   WHERE user_id = v_teacher AND institution_id = v_inst AND academic_year = '2099-00';
  PERFORM pg_temp.chk(v_n = v_m AND v_m = (SELECT count(*) FROM public._staff_leave_workdays(v_inst, v_past_from, v_past_to)),
    'approval covers the absent day and the empty day, and charges the balance by exactly those',
    format('casual_used=%s marked=%s skipped=%s', v_n, v_m, v_js->>'skipped'));
  PERFORM pg_temp.as_user(v_admin);
  v_js := public.review_staff_leave(v_req_past, 'rejected');
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.staff_attendance_records
   WHERE staff_id = v_teacher AND date BETWEEN v_past_from AND v_past_to
     AND status = 'absent' AND remarks = 'Leave ' || v_req_past || ' not approved';
  PERFORM pg_temp.chk(v_n = v_m AND (v_js->>'reverted')::int = v_m,
    'overturning turns the past on_leave days back to absent', format('absent=%s reverted=%s', v_n, v_js->>'reverted'));
  SELECT casual_used INTO v_n FROM public.staff_leave_balances
   WHERE user_id = v_teacher AND institution_id = v_inst AND academic_year = '2099-00';
  PERFORM pg_temp.chk(v_n = 0, 'overturning gives the days back to the balance', format('casual_used=%s', v_n));

  -- ── 9. the ladder above the teacher ────────────────────────────────────
  PERFORM pg_temp.as_user(v_admin);
  INSERT INTO public.staff_leave_requests (user_id, institution_id, leave_type, start_date, end_date, reason)
  VALUES (v_admin, v_inst, 'annual', v_fut_from, v_fut_from, 'suite admin') RETURNING id INTO v_req_admin;
  BEGIN
    PERFORM public.review_staff_leave(v_req_admin, 'approved');
    v_state := 'decided';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'an admin cannot decide their own leave', v_state);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_coord);
  BEGIN
    PERFORM public.review_staff_leave(v_req_admin, 'approved');
    v_state := 'decided';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'a coordinator cannot decide an admin''s leave', v_state);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_admin2);
  v_js := public.review_staff_leave(v_req_admin, 'approved');
  PERFORM pg_temp.chk(v_js->>'status' = 'approved', 'another admin decides an admin''s leave', v_js::text);

  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_coord);
  INSERT INTO public.staff_leave_requests (user_id, institution_id, leave_type, start_date, end_date, reason)
  VALUES (v_coord, v_inst, 'casual', v_fut_from, v_fut_from, 'suite coord') RETURNING id INTO v_req_coord;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_teacher);
  BEGIN
    PERFORM public.review_staff_leave(v_req_coord, 'approved');
    v_state := 'decided';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'a teacher cannot decide a coordinator''s leave', v_state);

  -- ── 10. withdraw still works while pending ─────────────────────────────
  DELETE FROM public.staff_leave_requests WHERE id = v_req_coord;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM pg_temp.chk(v_n = 0, 'a teacher cannot delete someone else''s pending request', format('%s deleted', v_n));
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_coord);
  DELETE FROM public.staff_leave_requests WHERE id = v_req_coord;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM pg_temp.chk(v_n = 1, 'the owner withdraws their own pending request', format('%s deleted', v_n));

  -- ── 11. super-admin platform counts ────────────────────────────────────
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    PERFORM * FROM public.admin_institution_counts();
    v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'a school admin cannot read platform counts', v_state);
  BEGIN
    PERFORM public.admin_user_roster();
    v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'a school admin cannot read the platform roster', v_state);

  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.as_user(v_super);
  SELECT count(*), sum(c.students) FILTER (WHERE c.institution_id = v_inst) INTO v_n, v_m
    FROM public.admin_institution_counts() c;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_n = (SELECT count(*) FROM public.institutions)
                      AND v_m = public.institution_student_count(v_inst),
    'platform counts: one row per institution, students = the canonical roster',
    format('rows=%s students(inst)=%s canonical=%s', v_n, v_m, public.institution_student_count(v_inst)));
  PERFORM pg_temp.as_user(v_super);
  v_js := public.admin_user_roster();
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(jsonb_array_length(v_js) = (SELECT count(*) FROM public.profiles),
    'platform roster returns every profile in one value',
    format('%s entries, %s bytes', jsonb_array_length(v_js), octet_length(v_js::text)));
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
