-- Online (residential) PTM acceptance suite (migrations 20261005160000 to
-- 20261005160300, 20261006120000, 20261006140000 teacher hours, 20261006140100
-- Meet rooms, 20261006170000 class sessions, 20261009110000 several teachers per
-- student, Together retired). Runs as a real admin, teachers and students of Alliance
-- under RLS, then rolls everything back. Assertions RECORD instead of raising.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-ptm-online.sql -OutFile "$env:TEMP\ptm-online.json"
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

CREATE FUNCTION pg_temp.skip(p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $sk$
BEGIN
  INSERT INTO t_out(result, label, detail) VALUES ('SKIP', p_label, p_detail);
END $sk$;

CREATE FUNCTION pg_temp.as_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $as$
BEGIN
  EXECUTE 'RESET ROLE';
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
  v_inst uuid; v_admin uuid; v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_class_a uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_out uuid;
  v_today date; v_d3 date; v_d4 date; v_d5 date; v_now_t time;
  v_ptm1 uuid; v_ptm1b uuid; v_ptm2 uuid; v_ptm4 uuid; v_ptm5 uuid; v_inp uuid; v_ptm6 uuid; v_ptm7 uuid;
  v_b1 uuid; v_b2 uuid; v_b4 uuid; v_b6 uuid;
  v_d6 date; v_h1 uuid; v_h2 uuid; v_rooms uuid; v_br1 uuid; v_br2 uuid; v_bpast uuid; v_rs_ts timestamp;
  v_d8 date; v_d9 date; v_class_b uuid; v_tx uuid; v_cp uuid; v_cq uuid; v_cs_a uuid; v_cs_b uuid; v_csq uuid;
  v_bk2 uuid; v_bk3 uuid; v_sess jsonb;
  v_s5 uuid; v_cr uuid; v_bk4 uuid; v_bk5 uuid;
  v_start_ts timestamp; v_start time; v_login text;
  v_n int; v_m int; v_js jsonb; v_txt text; v_state text; v_hint text; v_ts timestamptz;
  fn text;
BEGIN
  v_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now_t := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  v_d3 := v_today + 3;
  v_d4 := v_today + 4;
  v_d5 := v_today + 5;

  -- ── 0. cast: two teachers of one class with 4+ pickable students ─────────
  SELECT i.id INTO v_inst FROM public.institutions i WHERE i.name = 'Alliance International School';
  SELECT ca.user_id, ca.class_id INTO v_t1, v_class_a
    FROM public.class_assignments ca
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
    JOIN public.profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE AND p.institution_id = v_inst
   WHERE ca.role = 'teacher'
     AND public._ptm_has_hat(ca.user_id, v_inst, 'teacher')
     AND NOT public.is_institution_admin(ca.user_id, v_inst)
     AND NOT public.has_role(ca.user_id, 'coordinator')
     AND (SELECT count(*) FROM public.class_assignments s
           WHERE s.class_id = ca.class_id AND s.role = 'student'
             AND public._ptm_pickable_class(s.user_id) = ca.class_id) >= 4
     AND EXISTS (SELECT 1 FROM public.class_assignments o
                  JOIN public.profiles op ON op.id = o.user_id AND op.is_active IS NOT FALSE
                 WHERE o.class_id = ca.class_id AND o.role = 'teacher' AND o.user_id <> ca.user_id
                   AND public._ptm_has_hat(o.user_id, v_inst, 'teacher')
                   AND NOT public.is_institution_admin(o.user_id, v_inst)
                   AND NOT public.has_role(o.user_id, 'coordinator'))
   ORDER BY ca.user_id, ca.class_id LIMIT 1;
  SELECT o.user_id INTO v_t2 FROM public.class_assignments o
    JOIN public.profiles op ON op.id = o.user_id AND op.is_active IS NOT FALSE
   WHERE o.class_id = v_class_a AND o.role = 'teacher' AND o.user_id <> v_t1
     AND public._ptm_has_hat(o.user_id, v_inst, 'teacher')
     AND NOT public.is_institution_admin(o.user_id, v_inst)
     AND NOT public.has_role(o.user_id, 'coordinator')
   ORDER BY o.user_id LIMIT 1;
  SELECT r.user_id INTO v_t3 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
   WHERE r.role = 'teacher' AND p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND r.user_id NOT IN (v_t1, v_t2) AND NOT public.is_institution_admin(r.user_id, v_inst)
     AND NOT public.has_role(r.user_id, 'coordinator') AND public._ptm_has_hat(r.user_id, v_inst, 'teacher')
   ORDER BY r.user_id LIMIT 1;
  SELECT r.user_id INTO v_t4 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
   WHERE r.role = 'teacher' AND p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND r.user_id NOT IN (v_t1, v_t2, v_t3) AND NOT public.is_institution_admin(r.user_id, v_inst)
     AND NOT public.has_role(r.user_id, 'coordinator') AND public._ptm_has_hat(r.user_id, v_inst, 'teacher')
   ORDER BY r.user_id LIMIT 1;
  SELECT x[1], x[2], x[3], x[4] INTO v_s1, v_s2, v_s3, v_s4 FROM (
    SELECT array_agg(s.user_id ORDER BY s.user_id) AS x FROM (
      SELECT DISTINCT s.user_id FROM public.class_assignments s
       WHERE s.class_id = v_class_a AND s.role = 'student' AND public._ptm_pickable_class(s.user_id) = v_class_a
       ORDER BY s.user_id LIMIT 4) s) q;
  SELECT s.user_id INTO v_out FROM public.class_assignments s
    JOIN public.classes c ON c.id = s.class_id AND c.institution_id = v_inst
   WHERE s.role = 'student' AND public._ptm_pickable_class(s.user_id) = s.class_id
     AND s.class_id NOT IN (SELECT h.class_id FROM public.ptm_classes_for_hat(v_t1, 'teacher') h)
   ORDER BY s.user_id LIMIT 1;
  SELECT p.id INTO v_admin FROM public.profiles p
   WHERE p.institution_id = v_inst AND public.is_institution_admin(p.id, v_inst) AND NOT public.is_super_admin(p.id)
   ORDER BY p.id LIMIT 1;
  PERFORM pg_temp.chk(v_t1 IS NOT NULL AND v_t2 IS NOT NULL AND v_t3 IS NOT NULL AND v_s4 IS NOT NULL
                      AND v_out IS NOT NULL AND v_admin IS NOT NULL,
    'cast found (two teachers of one class, a third teacher, 4 students, an outsider, admin)',
    format('t1=%s t2=%s class=%s', v_t1, v_t2, v_class_a));

  -- ── 1. grants and private tables ─────────────────────────────────────────
  FOR fn IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND (p.proname LIKE '%ptm%' OR p.proname IN ('get_google_email', 'set_google_email'))
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    PERFORM pg_temp.chk(false, 'anon has EXECUTE on ' || fn);
  END LOOP;
  PERFORM pg_temp.chk(true, 'anon EXECUTE sweep over every PTM and Google function done');
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public._ptm_student_scope(uuid,uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._ptm_assert_teachers_free(uuid,uuid[],timestamptz,timestamptz)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._ptm_teacher_bookings(uuid[],timestamptz,timestamptz,uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._ptm_fanout(uuid,text,text,text,uuid[],text,text,jsonb)', 'EXECUTE'),
    'internal helpers are not callable from the browser');
  PERFORM pg_temp.chk(NOT has_table_privilege('authenticated', 'public.ptm_booking_meet', 'SELECT')
                  AND NOT has_table_privilege('authenticated', 'public.user_google_accounts', 'SELECT'),
    'Meet links and Google emails are not readable from the browser at all');
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('profiles', 'ptm_bookings')
     AND column_name IN ('google_email', 'meet_uri');
  PERFORM pg_temp.chk(v_n = 0, 'no google_email on profiles, no meet_uri on bookings', format('%s', v_n));

  -- ── 2. Google account ────────────────────────────────────────────────────
  -- Since 20261006120000 nobody is refused for not having set one: the login
  -- email is the account until they set another.
  PERFORM pg_temp.as_owner();
  SELECT NULLIF(lower(btrim(p.email)), '') INTO v_login FROM public.profiles p WHERE p.id = v_t1;
  PERFORM pg_temp.as_user(v_t1);
  PERFORM pg_temp.chk(public.get_google_email(NULL) IS NOT DISTINCT FROM v_login,
    'with nothing set, the Google account is the login email', coalesce(v_login, '(no login email)'));
  v_ptm7 := public.create_online_ptm(v_inst, 'Suite G0', NULL, v_d5, '10:00', '11:00', 15, 5, 'teacher', NULL, ARRAY[v_s1], 240, 3);
  PERFORM pg_temp.chk(v_ptm7 IS NOT NULL, 'a teacher with no Google account set can still schedule online');
  PERFORM public.set_google_email('  T1.Suite@Example.com ', NULL);
  PERFORM pg_temp.chk(public.get_google_email(NULL) = 't1.suite@example.com', 'own Google email saved trimmed and lower-cased');
  BEGIN PERFORM public.set_google_email('not-an-email', NULL); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Enter a valid email address.', 'a bad address is refused', v_txt);
  PERFORM pg_temp.as_user(v_t2);
  BEGIN v_txt := public.get_google_email(v_t1); v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'another teacher cannot read a colleague''s Google email', v_state);
  PERFORM pg_temp.as_user(v_s1);
  BEGIN PERFORM public.set_google_email('kid@example.com', NULL); v_state := 'saved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'a student cannot add a Google account', v_state);
  BEGIN PERFORM 1 FROM public.user_google_accounts; v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'a student cannot read the Google accounts table', v_state);
  PERFORM pg_temp.as_user(v_admin);
  PERFORM pg_temp.chk(public.get_google_email(v_t1) = 't1.suite@example.com', 'an admin reads a teacher''s Google email');
  PERFORM public.set_google_email('t2.suite@example.com', v_t2);
  PERFORM public.set_google_email('t3.suite@example.com', v_t3);

  -- ── 3. a teacher creates with students ───────────────────────────────────
  PERFORM pg_temp.as_user(v_t1);
  v_ptm1 := public.create_online_ptm(v_inst, 'Suite O1', 'desc', v_d3, '10:00', '11:00', 15, 5, 'teacher', NULL,
                                     ARRAY[v_s1, v_s2], 240, 3);
  v_ptm1b := public.create_online_ptm(v_inst, 'Suite O1', 'desc', v_d3, '10:00', '11:00', 15, 5, 'teacher', NULL,
                                      ARRAY[v_s1, v_s2], 240, 3);
  PERFORM pg_temp.chk(v_ptm1 IS NOT NULL AND v_ptm1b = v_ptm1, 'a double tap returns the same PTM, not a second one');
  PERFORM pg_temp.as_owner();
  SELECT p.mode || '/' || p.scope_type || '/' || p.slot_buffer_minutes || '/' || p.booking_cutoff_minutes INTO v_txt
    FROM public.ptm_schedules p WHERE p.id = v_ptm1;
  PERFORM pg_temp.chk(v_txt = 'online/class/5/240', 'stored as online, class scope, 5 min gap, 4 h cutoff', v_txt);
  SELECT count(*) INTO v_n FROM public.ptm_schedule_classes WHERE ptm_id = v_ptm1;
  SELECT count(*) INTO v_m FROM public.ptm_online_participants WHERE ptm_id = v_ptm1 AND teacher_id = v_t1 AND class_id = v_class_a;
  PERFORM pg_temp.chk(v_n = 0 AND v_m = 2, 'no class rows, two participants with the teacher', format('%s class rows, %s participants', v_n, v_m));
  SELECT count(*) INTO v_n FROM public._ptm_slots(v_ptm1);
  PERFORM pg_temp.chk(v_n = 3, 'slots step by duration plus gap: 10:00, 10:20, 10:40', format('%s', v_n));
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
  EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
  SELECT count(*) FILTER (WHERE nt.type = 'ptm_online_invited'),
         count(*) FILTER (WHERE nt.type = 'ptm_scheduled') INTO v_n, v_m
    FROM public.notifications nt
   WHERE (nt.metadata->>'ptm_id')::uuid = v_ptm1 AND nt.user_id IN (v_s1, v_s2);
  PERFORM pg_temp.chk(v_n = 2 AND v_m = 0, 'families get "invited", never "scheduled"', format('invited %s, scheduled %s', v_n, v_m));
  BEGIN INSERT INTO public.ptm_schedule_classes (ptm_id, class_id) VALUES (v_ptm1, v_class_a); v_state := 'inserted';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '22023', 'an online PTM refuses class rows', v_state);
  PERFORM pg_temp.as_user(v_t1);
  BEGIN
    PERFORM public.create_online_ptm(v_inst, 'Suite O2', NULL, v_d3, '15:00', '16:00', 15, 5, 'teacher', ARRAY[v_t2], NULL, 240, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_fixed', 'a teacher cannot add another teacher', v_state);
  BEGIN
    PERFORM public.create_online_ptm(v_inst, 'Suite O3', NULL, v_d3, '15:00', '16:00', 15, 5, 'teacher', NULL, ARRAY[v_out], 240, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_not_your_class', 'a teacher cannot pick a student outside their classes', v_state);

  -- ── 4. who sees it ───────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_s3);
  SELECT count(*) INTO v_n FROM public.ptm_schedules WHERE id = v_ptm1;
  SELECT count(*) INTO v_m FROM public.ptm_online_my_sessions(NULL) WHERE ptm_id = v_ptm1;
  PERFORM pg_temp.chk(v_n = 0 AND v_m = 0, 'a classmate who was not picked does not see the online PTM', format('%s/%s', v_n, v_m));
  BEGIN PERFORM public.book_ptm_slot(v_ptm1, '10:00', false); v_state := 'booked';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_not_participant', 'and cannot book in it', v_state);
  PERFORM pg_temp.as_user(v_s1);
  SELECT count(*) INTO v_n FROM public.ptm_schedules WHERE id = v_ptm1;
  SELECT count(*), max(teacher_id::text) INTO v_m, v_txt FROM public.ptm_online_my_sessions(NULL) WHERE ptm_id = v_ptm1;
  PERFORM pg_temp.chk(v_n = 1 AND v_m = 1 AND v_txt = v_t1::text, 'a picked student sees it, with their teacher', format('%s/%s', v_n, v_m));
  SELECT count(*) INTO v_n FROM public.ptm_online_participants WHERE ptm_id = v_ptm1;
  PERFORM pg_temp.chk(v_n = 1, 'a student reads only their own participant row', format('%s', v_n));

  -- ── 5. booking ───────────────────────────────────────────────────────────
  v_b1 := public.book_ptm_slot(v_ptm1, '10:00', false);
  PERFORM pg_temp.as_owner();
  SELECT b.mode || '/' || (b.teacher_id = v_t1) || '/' || (b.class_id = v_class_a) INTO v_txt FROM public.ptm_bookings b WHERE b.id = v_b1;
  PERFORM pg_temp.chk(v_txt = 'online/true/true', 'the booking is online, with the student''s own teacher and class', v_txt);
  SELECT count(*) FILTER (WHERE nt.type = 'ptm_booking_confirmed' AND nt.user_id = v_s1),
         count(*) FILTER (WHERE nt.type = 'ptm_slot_booked' AND nt.user_id = v_t1) INTO v_n, v_m
    FROM public.notifications nt WHERE (nt.metadata->>'booking_id')::uuid = v_b1;
  PERFORM pg_temp.chk(v_n = 1 AND v_m = 1, 'family and teacher are told about the booking', format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_s2);
  BEGIN PERFORM public.book_ptm_slot(v_ptm1, '10:00', false); v_state := 'booked';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE; END;
  PERFORM pg_temp.chk(v_hint = 'ptm_slot_taken' AND v_state = 'P0001' AND v_txt = 'That slot was just taken. Pick another.',
    'two families cannot hold one teacher''s slot (P0001, so the toast shows the real text)', v_state || ' ' || v_hint);
  BEGIN PERFORM public.book_ptm_slot(v_ptm1, '10:15', false); v_txt := 'booked';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'That time is not one of%', 'a time inside the gap is not a slot', v_txt);
  PERFORM pg_temp.as_user(v_s1);
  BEGIN PERFORM public.book_ptm_slot(v_ptm1, '10:20', false); v_state := 'booked';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_already_booked', 'one active booking per family', v_state);
  v_b1 := public.book_ptm_slot(v_ptm1, '10:20', true);
  PERFORM pg_temp.as_user(v_s2);
  v_b2 := public.book_ptm_slot(v_ptm1, '10:00', false);
  PERFORM pg_temp.chk(v_b1 IS NOT NULL AND v_b2 IS NOT NULL, 'replace moves a booking; the freed slot can be booked');
  -- A well-formed row (own teacher, own class) so the shape rule passes and
  -- RLS itself is what refuses it.
  BEGIN INSERT INTO public.ptm_bookings (ptm_id, parent_id, class_id, slot_time, teacher_id)
        VALUES (v_ptm1, v_s2, v_class_a, '10:40', v_t1); v_state := 'inserted';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'no direct booking insert from the browser (RLS)', v_state);
  BEGIN INSERT INTO public.ptm_bookings (ptm_id, parent_id, class_id, slot_time, teacher_id)
        VALUES (v_ptm1, v_s2, v_class_a, '10:40', v_t2); v_state := 'inserted';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state IN ('22023', '42501'), 'a booking with someone else''s teacher is refused', v_state);

  -- ── 6. who reads bookings ────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_s3);
  SELECT count(*) INTO v_n FROM public.ptm_bookings WHERE ptm_id = v_ptm1;
  PERFORM pg_temp.chk(v_n = 0, 'a classmate reads none of these bookings (was: the whole school)', format('%s', v_n));
  PERFORM pg_temp.as_user(v_s1);
  SELECT count(*) INTO v_n FROM public.ptm_bookings WHERE ptm_id = v_ptm1 AND cancelled_at IS NULL;
  PERFORM pg_temp.chk(v_n = 1, 'a family reads only its own booking', format('%s', v_n));
  BEGIN PERFORM 1 FROM public.ptm_booking_meet; v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'nobody reads the Meet table directly', v_state);
  PERFORM pg_temp.as_user(v_t1);
  SELECT count(*) INTO v_n FROM public.ptm_bookings WHERE ptm_id = v_ptm1 AND cancelled_at IS NULL;
  PERFORM pg_temp.chk(v_n = 2, 'the session teacher reads both bookings', format('%s', v_n));

  -- ── 7. Meet links: only that family and the session's staff ──────────────
  PERFORM pg_temp.as_owner();
  INSERT INTO public.ptm_booking_meet (booking_id, meet_uri, meet_space_id, meet_created_at)
  VALUES (v_b1, 'https://meet.google.com/abc-defg-hij', 'spaces/suite1', now());
  BEGIN UPDATE public.ptm_booking_meet SET meet_uri = 'javascript:alert(1)' WHERE booking_id = v_b1; v_state := 'updated';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '23514', 'only a https://meet.google.com/ link can be stored', v_state);
  PERFORM pg_temp.as_user(v_s1);
  SELECT count(*) FILTER (WHERE g.meet_uri IS NOT NULL AND g.is_mine),
         count(*) FILTER (WHERE g.meet_uri IS NOT NULL AND NOT g.is_mine),
         count(*) FILTER (WHERE g.student_name IS NOT NULL),
         max(g.slot_starts_at) FILTER (WHERE g.is_mine)
    INTO v_n, v_m, fn, v_ts
    FROM public.ptm_online_booking_grid(v_ptm1, NULL) g;
  PERFORM pg_temp.chk(v_n = 1 AND v_m = 0 AND fn = '0', 'a family sees its own link, nobody else''s, and no names',
    format('mine %s, others %s, names %s', v_n, v_m, fn));
  PERFORM pg_temp.chk(v_ts = (v_d3 + time '10:20') AT TIME ZONE 'Asia/Kolkata',
    'slot_starts_at is the slot in the school''s timezone', v_ts::text);
  SELECT count(*) INTO v_n FROM public.ptm_online_my_sessions(NULL)
   WHERE ptm_id = v_ptm1 AND meet_ready AND meet_uri = 'https://meet.google.com/abc-defg-hij'
     AND slot_starts_at = (v_d3 + time '10:20') AT TIME ZONE 'Asia/Kolkata';
  SELECT count(*) INTO v_m FROM public.ptm_my_bookings() WHERE booking_id = v_b1 AND teacher_id = v_t1 AND meet_uri IS NOT NULL;
  PERFORM pg_temp.chk(v_n = 1 AND v_m = 1, 'my sessions and my bookings carry the family''s own link', format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_s2);
  SELECT count(*) INTO v_n FROM public.ptm_online_booking_grid(v_ptm1, NULL) g WHERE g.meet_uri IS NOT NULL;
  PERFORM pg_temp.chk(v_n = 0, 'another family never gets that link', format('%s', v_n));
  PERFORM pg_temp.as_user(v_t1);
  SELECT count(*) FILTER (WHERE g.student_name IS NOT NULL), count(*) FILTER (WHERE g.meet_uri IS NOT NULL) INTO v_n, v_m
    FROM public.ptm_online_booking_grid(v_ptm1, v_t1) g;
  PERFORM pg_temp.chk(v_n = 2 AND v_m = 1, 'the session teacher sees names and the room', format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_t2);
  BEGIN PERFORM 1 FROM public.ptm_online_booking_grid(v_ptm1, v_t1); v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'another teacher of the class does not see this teacher''s session', v_state);
  BEGIN PERFORM 1 FROM public.ptm_booking_grid(v_ptm1, v_class_a); v_state := 'read';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_online_grid', 'the in-person grid refuses an online PTM', v_state);

  -- ── 8. attendance and cancel are the session teacher's ───────────────────
  PERFORM pg_temp.as_user(v_t2);
  BEGIN PERFORM public.set_ptm_booking_attended(v_b1, true); v_state := 'set';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'another teacher of the class cannot mark this session''s attendance', v_state);
  PERFORM pg_temp.as_user(v_t1);
  PERFORM public.set_ptm_booking_attended(v_b1, true);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((SELECT attended FROM public.ptm_bookings WHERE id = v_b1), 'the session teacher marks attendance');

  -- ── 9. the teacher's student list ────────────────────────────────────────
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.set_ptm_online_students(v_ptm1, ARRAY[v_s1, v_s3, v_out], NULL);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((v_js->>'added')::int = 1 AND (v_js->>'removed')::int = 1 AND (v_js->>'kept')::int = 1
                      AND (v_js->>'cancelled_bookings')::int = 1
                      AND v_js->'refused' @> jsonb_build_array(jsonb_build_object('student_id', v_out, 'reason', 'not_your_class')),
    'add one, remove one (booked), keep one, refuse the outsider by name', left(v_js::text, 200));
  PERFORM pg_temp.chk((SELECT cancelled_at IS NOT NULL FROM public.ptm_bookings WHERE id = v_b2),
    'removing a booked student cancels the booking');
  SELECT count(*) INTO v_n FROM public.notifications nt
   WHERE nt.user_id = v_s2 AND nt.type = 'ptm_booking_cancelled' AND (nt.metadata->>'booking_id')::uuid = v_b2;
  SELECT count(*) INTO v_m FROM public.ptm_notifications_sent
   WHERE ptm_id = v_ptm1 AND recipient_id = v_s2 AND notification_type = 'ptm_online_invited';
  PERFORM pg_temp.chk(v_n = 1 AND v_m = 0, 'the family is told, and a re-add would invite again', format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.ptm_online_pick_options(v_ptm1, NULL);
  PERFORM pg_temp.chk(jsonb_typeof(v_js) = 'array'
                      AND v_js @> jsonb_build_array(jsonb_build_object('student_id', v_s1, 'state', 'mine', 'booked', true))
                      AND v_js @> jsonb_build_array(jsonb_build_object('student_id', v_s2, 'state', 'free')),
    'pick options: one array, mine and booked, free', format('%s rows', jsonb_array_length(v_js)));

  -- ── 10. an admin creates with teachers; one teacher per student ──────────
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    PERFORM public.create_online_ptm(v_inst, 'Suite A0', NULL, v_d3, '12:00', '13:00', 15, 5, 'admin', ARRAY[v_t1], ARRAY[v_s1], 240, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_students_later', 'an admin does not pick students', v_state);
  IF v_t4 IS NOT NULL THEN
    BEGIN
      PERFORM public.create_online_ptm(v_inst, 'Suite A0', NULL, v_d5, '12:00', '13:00', 15, 5, 'admin', ARRAY[v_t4], NULL, 240, 3);
      v_state := 'created';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    PERFORM pg_temp.chk(v_state = 'created', 'a teacher with no Google account set can still be invited', v_state);
  END IF;
  v_ptm2 := public.create_online_ptm(v_inst, 'Suite A1', NULL, v_d3, '12:00', '13:00', 15, 5, 'admin', ARRAY[v_t1, v_t2], NULL, 240, 3);
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
  EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.notifications nt
   WHERE (nt.metadata->>'ptm_id')::uuid = v_ptm2 AND nt.type = 'ptm_scheduled' AND nt.user_id IN (v_t1, v_t2);
  SELECT count(*) INTO v_m FROM public.notifications nt
   WHERE (nt.metadata->>'ptm_id')::uuid = v_ptm2 AND nt.type = 'ptm_online_assigned' AND nt.user_id IN (v_t1, v_t2);
  PERFORM pg_temp.chk(v_n = 2 AND v_m = 2, 'both teachers are told it was scheduled and to pick students', format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.set_ptm_online_students(v_ptm2, ARRAY[v_s1], NULL);
  PERFORM pg_temp.as_user(v_t2);
  v_js := public.set_ptm_online_students(v_ptm2, ARRAY[v_s1, v_s4], NULL);
  PERFORM pg_temp.chk((v_js->>'added')::int = 2 AND jsonb_array_length(v_js->'refused') = 0,
    'a student already with another teacher can be with this one too', left(v_js::text, 200));
  PERFORM pg_temp.chk(public.can_manage_ptm(v_admin, v_ptm2) AND NOT public.can_manage_ptm(v_t1, v_ptm2)
                      AND public.can_manage_ptm(v_t1, v_ptm1) AND NOT public.can_manage_ptm(v_t2, v_ptm1),
    'online: only the creator (or an admin) manages');

  -- ── 11. one teacher, one PTM window at a time ────────────────────────────
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    PERFORM public.create_online_ptm(v_inst, 'Suite clash', NULL, v_d3, '10:30', '11:30', 15, 5, 'admin', ARRAY[v_t1], NULL, 240, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_busy' AND v_txt LIKE '%"Suite O1"%', 'an overlapping online PTM is refused, naming the other', v_txt);
  v_ptm4 := public.create_online_ptm(v_inst, 'Suite back to back', NULL, v_d3, '11:05', '11:35', 15, 0, 'admin', ARRAY[v_t1], NULL, 240, 3);
  PERFORM pg_temp.chk(v_ptm4 IS NOT NULL, 'back to back after the gap is fine (11:00 + 5 min)');
  BEGIN
    PERFORM public.update_ptm_schedule(v_ptm4, 'Suite back to back', NULL, NULL, v_d3, '10:45', '11:15', true, 15, 240, 3);
    v_state := 'updated';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_busy', 'moving an online PTM onto a busy teacher is refused', v_state);
  BEGIN
    PERFORM public.update_ptm_schedule(v_ptm4, 'Suite back to back', NULL, NULL, v_d3, '11:05', '11:35', false, 15, 240, 3);
    v_state := 'updated';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_online_booking_off', 'slot booking cannot be switched off online', v_state);
  v_inp := public.create_ptm_schedule(v_inst, 'Suite in person', NULL, v_d4, '09:00', '10:00', 15,
                                      ARRAY[v_class_a], 'admin', 'class', NULL, 'Hall', true, 60, 3);
  BEGIN
    PERFORM public.create_online_ptm(v_inst, 'Suite over in-person', NULL, v_d4, '09:30', '10:30', 15, 5, 'admin', ARRAY[v_t1], NULL, 240, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_busy', 'a teacher of a class in an in-person PTM is busy then', v_state);
  SELECT count(*) INTO v_n FROM public.ptm_teacher_busy_windows(v_d3, NULL, NULL) w WHERE w.teacher_id = v_t1;
  PERFORM pg_temp.as_user(v_t2);
  SELECT count(*) INTO v_m FROM public.ptm_teacher_busy_windows(v_d3, NULL, NULL) w WHERE w.teacher_id <> v_t2;
  PERFORM pg_temp.chk(v_n = 3 AND v_m = 0, 'busy windows: an admin sees t1 in three PTMs; a teacher sees only themself',
    format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_s1);
  SELECT count(*) INTO v_n FROM public.ptm_teacher_busy_windows(v_d3, NULL, NULL);
  PERFORM pg_temp.chk(v_n = 0, 'a student gets no busy windows', format('%s', v_n));

  -- ── 12. changing the teacher list ────────────────────────────────────────
  PERFORM pg_temp.as_user(v_s4);
  v_b4 := public.book_ptm_slot(v_ptm2, '12:00', false);
  PERFORM pg_temp.as_user(v_admin);
  v_js := public.set_ptm_online_teachers(v_ptm2, ARRAY[v_t3]);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((v_js->>'added')::int = 1 AND (v_js->>'removed')::int = 1
                      AND v_js->'refused' @> jsonb_build_array(jsonb_build_object('teacher_id', v_t2, 'reason', 'has_bookings')),
    'a teacher with bookings stays (named); one without is removed; one is added', left(v_js::text, 200));
  SELECT count(*) INTO v_n FROM public.notifications nt
   WHERE nt.user_id = v_s1 AND nt.type = 'ptm_online_uninvited' AND (nt.metadata->>'ptm_id')::uuid = v_ptm2;
  SELECT count(*) INTO v_m FROM public.ptm_online_participants WHERE ptm_id = v_ptm2 AND student_id = v_s1 AND teacher_id = v_t1;
  PERFORM pg_temp.chk(v_n = 1 AND v_m = 0, 'the removed teacher''s families are told and drop off', format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_admin);
  BEGIN PERFORM public.set_ptm_online_teachers(v_ptm1, ARRAY[v_t1, v_t2]); v_state := 'changed';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_fixed', 'a teacher''s own online PTM keeps its one teacher', v_state);

  -- ── 13. hand a session to another teacher ────────────────────────────────
  PERFORM pg_temp.as_owner();
  INSERT INTO public.ptm_booking_meet (booking_id, meet_uri, meet_space_id) VALUES (v_b4, 'https://meet.google.com/old-room-aaa', 'spaces/old');
  PERFORM pg_temp.as_user(v_admin);
  -- t2 holds v_b4; t1 left ptm2 in step 12 and is free at 12:00.
  v_js := public.swap_ptm_online_teacher(v_ptm2, v_t2, v_t1);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((v_js->>'moved_students')::int = 2 AND (v_js->>'moved_bookings')::int = 1
                      AND (v_js->>'merged_students')::int = 0
                      AND (SELECT teacher_id FROM public.ptm_bookings WHERE id = v_b4) = v_t1
                      AND EXISTS (SELECT 1 FROM public.ptm_booking_meet WHERE booking_id = v_b4
                                     AND meet_uri = 'https://meet.google.com/old-room-aaa'),
    'swap moves students and bookings; the booking keeps its room (20261006140100)', left(v_js::text, 200));
  SELECT count(*) INTO v_n FROM public.notifications nt
   WHERE nt.user_id = v_s4 AND nt.type = 'ptm_teacher_swapped' AND (nt.metadata->>'ptm_id')::uuid = v_ptm2;
  PERFORM pg_temp.chk(v_n = 1, 'the moved family is told', format('%s', v_n));

  -- ── 14. feedback and the dashboard ───────────────────────────────────────
  PERFORM pg_temp.as_user(v_t1);
  SELECT public.ptm_feedback_summary(v_ptm1, 'teacher') INTO v_js;
  PERFORM pg_temp.chk((v_js->>'students_in_scope')::int = 2 AND (v_js->'bookings'->>'total_slots')::int = 3,
    'summary: the picked students, slots per teacher', left(v_js::text, 160));
  IF v_now_t > '00:45' THEN
    v_ptm5 := public.create_online_ptm(v_inst, 'Suite feedback', NULL, v_today, '00:00', '00:30', 15, 0, 'teacher', NULL,
                                       ARRAY[v_s1], 240, 3);
    PERFORM pg_temp.as_user(v_s1);
    PERFORM public.submit_ptm_feedback(v_ptm5, 4, 'Good call', NULL, NULL, NULL);
    SELECT count(*) INTO v_n FROM public.ptm_open_for_feedback() o
     WHERE o.ptm_id = v_ptm5 AND o.mode = 'online' AND o.my_teacher_name IS NOT NULL AND o.my_class_id = v_class_a;
    PERFORM pg_temp.chk(v_n = 1, 'a family gives feedback on its online PTM (mode and teacher in the context)', format('%s', v_n));
    PERFORM pg_temp.as_user(v_s3);
    BEGIN PERFORM public.submit_ptm_feedback(v_ptm5, 4, NULL, NULL, NULL, NULL); v_state := 'saved';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    PERFORM pg_temp.chk(v_state = 'ptm_not_participant', 'a classmate who was not picked cannot', v_state);
  ELSE
    PERFORM pg_temp.skip('online feedback', 'too close to midnight IST');
  END IF;

  -- ── 14b. online booking is per slot, even once the meeting is under way ──
  -- (20261006120000) A meeting that started 30 to 35 minutes ago: its first
  -- slot has started, the one an hour in has not. The 240-minute cutoff the
  -- PTM carries does not apply online.
  IF v_now_t BETWEEN '01:00' AND '21:00' THEN
    v_start_ts := date_trunc('minute', now() AT TIME ZONE 'Asia/Kolkata') - interval '30 minutes';
    v_start_ts := v_start_ts - make_interval(mins => (extract(minute FROM v_start_ts)::int % 5));
    v_start := v_start_ts::time;
    PERFORM pg_temp.as_user(v_t1);
    v_ptm6 := public.create_online_ptm(v_inst, 'Suite live', NULL, v_today, v_start, (v_start_ts + interval '120 minutes')::time,
                                       15, 0, 'teacher', NULL, ARRAY[v_s3, v_s4], 240, 3);
    PERFORM pg_temp.as_user(v_s3);
    BEGIN PERFORM public.book_ptm_slot(v_ptm6, v_start, false); v_state := 'booked';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    PERFORM pg_temp.chk(v_state = 'ptm_slot_started', 'a slot that has started cannot be booked', v_state);
    v_b6 := public.book_ptm_slot(v_ptm6, (v_start_ts + interval '60 minutes')::time, false);
    PERFORM pg_temp.chk(v_b6 IS NOT NULL, 'a later slot can be booked while the meeting is under way (cutoff ignored online)');
    SELECT count(*) INTO v_n FROM public.ptm_online_my_sessions(v_ptm6)
     WHERE booking_id = v_b6 AND can_change
       AND booking_closes_at = (v_start_ts + interval '60 minutes') AT TIME ZONE 'Asia/Kolkata';
    PERFORM pg_temp.chk(v_n = 1, 'my sessions: booking closes at the booked slot''s start, and it can still change', format('%s', v_n));
    v_b6 := public.book_ptm_slot(v_ptm6, (v_start_ts + interval '75 minutes')::time, true);
    PERFORM public.cancel_ptm_booking(v_b6);
    PERFORM pg_temp.as_owner();
    PERFORM pg_temp.chk((SELECT cancelled_at IS NOT NULL FROM public.ptm_bookings WHERE id = v_b6),
      'a family moves and cancels a slot that has not started');
    -- s4 holds a slot that has already started (written directly, as if booked earlier).
    INSERT INTO public.ptm_bookings (ptm_id, parent_id, class_id, slot_time, status, teacher_id)
    VALUES (v_ptm6, v_s4, v_class_a, v_start, 'booked', v_t1) RETURNING id INTO v_b6;
    PERFORM pg_temp.as_user(v_s4);
    BEGIN PERFORM public.cancel_ptm_booking(v_b6); v_txt := 'cancelled';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
    PERFORM pg_temp.chk(v_txt = 'Booking changes have closed for this meeting.', 'a family cannot cancel a slot that has started', v_txt);
    BEGIN PERFORM public.book_ptm_slot(v_ptm6, (v_start_ts + interval '90 minutes')::time, true); v_state := 'moved';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    PERFORM pg_temp.chk(v_state = 'ptm_slot_started', 'nor move it', v_state);
    SELECT count(*) INTO v_n FROM public.ptm_online_my_sessions(v_ptm6) WHERE booking_id = v_b6 AND NOT can_change;
    PERFORM pg_temp.chk(v_n = 1, 'my sessions says it can no longer change', format('%s', v_n));
    PERFORM pg_temp.as_user(v_t1);
    PERFORM public.cancel_ptm_booking(v_b6);
    PERFORM pg_temp.as_owner();
    PERFORM pg_temp.chk((SELECT cancelled_at IS NOT NULL FROM public.ptm_bookings WHERE id = v_b6),
      'the session teacher can still cancel it');
  ELSE
    PERFORM pg_temp.skip('per-slot online booking', 'too close to midnight IST');
  END IF;

  -- ── 15. account deletes still work through the new tables (CLAUDE.md 21) ─
  -- t1 owns sessions, participants, bookings, a Google account and created
  -- PTMs; s1 is a participant with a booking. Each real delete runs in a
  -- subtransaction that is always rolled back (a sentinel raises on success).
  PERFORM pg_temp.as_owner();
  FOREACH fn IN ARRAY ARRAY[v_t1::text, v_s1::text] LOOP
    BEGIN
      DELETE FROM auth.users WHERE id = fn::uuid;
      RAISE EXCEPTION 'probe-ok' USING ERRCODE = 'P0001';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    PERFORM pg_temp.chk(v_txt = 'probe-ok', 'an online-PTM account can be deleted (' || CASE WHEN fn = v_t1::text THEN 'teacher' ELSE 'student' END || ')', v_txt);
  END LOOP;

  -- ── 16. a deleted PTM takes everything with it ───────────────────────────
  PERFORM pg_temp.as_owner();
  DELETE FROM public.ptm_schedules WHERE id = v_ptm2;
  SELECT count(*) INTO v_n FROM public.ptm_online_teachers WHERE ptm_id = v_ptm2;
  SELECT count(*) INTO v_m FROM public.ptm_bookings WHERE ptm_id = v_ptm2;
  PERFORM pg_temp.chk(v_n = 0 AND v_m = 0, 'deleting an online PTM removes its sessions and bookings', format('%s/%s', v_n, v_m));
  -- ── 17. a teacher's own hours (20261006140000) ───────────────────────────
  v_d6 := v_today + 6;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.create_online_ptm(uuid,text,text,date,time,time,integer,integer,text,uuid[],uuid[],integer,integer,jsonb,text,jsonb)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.set_ptm_online_teachers(uuid,uuid[],jsonb)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.set_ptm_online_teacher_hours(uuid,uuid,time,time)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._ptm_slots(uuid,uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._ptm_parse_teacher_windows(jsonb,uuid[])', 'EXECUTE')
                  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_online_ptm' AND pronargs = 13)
                  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_ptm_online_teachers' AND pronargs = 2),
    'hours: the new signatures are the only ones, granted; the helpers are not');
  PERFORM pg_temp.as_user(v_admin);
  v_h1 := public.create_online_ptm(v_inst, 'Suite H1', NULL, v_d6, '12:00', '15:00', 15, 5, 'admin',
            ARRAY[v_t1, v_t2, v_t3], NULL, 240, 3,
            jsonb_build_array(jsonb_build_object('teacher_id', v_t1, 'start_time', '12:00', 'end_time', '13:00'),
                              jsonb_build_object('teacher_id', v_t2, 'start_time', '12:00', 'end_time', '15:00')));
  PERFORM pg_temp.as_owner();
  SELECT string_agg(COALESCE(ot.start_time::text, '-') || '/' || COALESCE(ot.end_time::text, '-'), ','
                    ORDER BY CASE ot.teacher_id WHEN v_t1 THEN 1 WHEN v_t2 THEN 2 ELSE 3 END) INTO v_txt
    FROM public.ptm_online_teachers ot WHERE ot.ptm_id = v_h1;
  PERFORM pg_temp.chk(v_txt = '12:00:00/13:00:00,-/-,-/-', 'own hours stored; hours equal to the meeting''s stored as the meeting''s', v_txt);
  SELECT count(*) INTO v_n FROM public._ptm_slots(v_h1, v_t1);
  SELECT count(*) INTO v_m FROM public._ptm_slots(v_h1, v_t3);
  PERFORM pg_temp.chk(v_n = 3 AND v_m = 9, 'slots per teacher: 12:00 to 13:00 gives 3, the whole meeting 9', format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_admin);
  SELECT public.ptm_feedback_summary(v_h1, 'admin') INTO v_js;
  PERFORM pg_temp.chk((v_js->'bookings'->>'total_slots')::int = 21, 'summary total slots sum each teacher''s grid (3 + 9 + 9)',
    v_js->'bookings'->>'total_slots');
  FOREACH v_txt IN ARRAY ARRAY['outside', 'short', 'stranger', 'badtime', 'backwards'] LOOP
    BEGIN
      PERFORM public.create_online_ptm(v_inst, 'Suite H bad ' || v_txt, NULL, v_d6 + 1, '12:00', '15:00', 15, 5, 'admin', ARRAY[v_t1], NULL, 240, 3,
        CASE v_txt
          WHEN 'outside'   THEN jsonb_build_array(jsonb_build_object('teacher_id', v_t1, 'start_time', '11:00', 'end_time', '13:00'))
          WHEN 'short'     THEN jsonb_build_array(jsonb_build_object('teacher_id', v_t1, 'start_time', '12:00', 'end_time', '12:10'))
          WHEN 'stranger'  THEN jsonb_build_array(jsonb_build_object('teacher_id', v_t2, 'start_time', '12:00', 'end_time', '13:00'))
          WHEN 'badtime'   THEN jsonb_build_array(jsonb_build_object('teacher_id', v_t1, 'start_time', '25:99', 'end_time', '13:00'))
          ELSE jsonb_build_array(jsonb_build_object('teacher_id', v_t1, 'start_time', '13:00', 'end_time', '12:00')) END);
      v_state := 'created';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    PERFORM pg_temp.chk(v_state = CASE WHEN v_txt IN ('outside', 'short') THEN 'ptm_hours_outside' ELSE 'ptm_hours_invalid' END,
      'refused own hours: ' || v_txt, v_state);
  END LOOP;
  -- t1 is held only for 12:00 to 13:00 plus the gap, so 13:05 is free; t3 runs the whole meeting.
  v_h2 := public.create_online_ptm(v_inst, 'Suite H2', NULL, v_d6, '13:05', '14:00', 15, 0, 'admin', ARRAY[v_t1], NULL, 240, 3);
  PERFORM pg_temp.chk(v_h2 IS NOT NULL, 'a teacher on own hours is free after them (13:00 + 5 min gap)');
  BEGIN
    PERFORM public.create_online_ptm(v_inst, 'Suite H3', NULL, v_d6, '13:05', '14:00', 15, 0, 'admin', ARRAY[v_t3], NULL, 240, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_busy', 'a teacher on the meeting''s hours is still busy then', v_state);
  SELECT count(*) INTO v_n FROM public.ptm_teacher_busy_windows(v_d6, ARRAY[v_t1], NULL) w
   WHERE w.ptm_id = v_h1 AND w.ends_at = (v_d6 + time '13:05') AT TIME ZONE 'Asia/Kolkata';
  PERFORM pg_temp.chk(v_n = 1, 'busy windows show a teacher''s own hours plus the gap', format('%s', v_n));
  -- booking follows the teacher's grid
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.set_ptm_online_students(v_h1, ARRAY[v_s1], NULL);
  PERFORM pg_temp.as_user(v_s1);
  BEGIN PERFORM public.book_ptm_slot(v_h1, '13:20', false); v_txt := 'booked';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'That time is not one of this teacher''s slots.', 'a meeting slot outside the teacher''s hours cannot be booked', v_txt);
  v_b6 := public.book_ptm_slot(v_h1, '12:40', false);
  SELECT count(*), min(g.slot_time)::text || '-' || max(g.slot_time)::text INTO v_n, v_txt FROM public.ptm_online_booking_grid(v_h1, NULL) g;
  PERFORM pg_temp.chk(v_n = 3 AND v_txt = '12:00:00-12:40:00', 'the family''s grid is the teacher''s hours only', format('%s %s', v_n, v_txt));
  SELECT count(*) INTO v_n FROM public.ptm_online_my_sessions(v_h1)
   WHERE teacher_start_time = '12:00' AND teacher_end_time = '13:00' AND booking_id = v_b6;
  PERFORM pg_temp.chk(v_n = 1, 'my sessions carry the teacher''s hours', format('%s', v_n));
  PERFORM pg_temp.as_user(v_admin);
  SELECT count(*) FILTER (WHERE s.teacher_id = v_t1 AND s.start_time = '12:00' AND s.end_time = '13:00'),
         count(*) FILTER (WHERE s.teacher_id = v_t3 AND s.start_time IS NULL AND s.end_time IS NULL) INTO v_n, v_m
    FROM public.ptm_online_sessions(v_h1) s;
  PERFORM pg_temp.chk(v_n = 1 AND v_m = 1, 'sessions carry own hours, NULL for the meeting''s', format('%s/%s', v_n, v_m));
  -- changing hours later
  PERFORM pg_temp.as_user(v_t2);
  PERFORM public.set_ptm_online_teacher_hours(v_h1, v_t2, '13:00', '14:00');
  PERFORM pg_temp.as_user(v_t3);
  BEGIN PERFORM public.set_ptm_online_teacher_hours(v_h1, v_t2, '12:00', '13:00'); v_state := 'set';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501' AND (SELECT start_time FROM public.ptm_online_teachers WHERE ptm_id = v_h1 AND teacher_id = v_t2) = '13:00',
    'a teacher sets their own hours; another teacher cannot', v_state);
  PERFORM pg_temp.as_user(v_admin);
  BEGIN PERFORM public.set_ptm_online_teacher_hours(v_h1, v_t1, '12:00', '12:30'); v_state := 'set';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_hours_has_bookings' AND v_txt LIKE '1 family has booked outside those hours: %',
    'hours that would strand a booking are refused, naming the family', v_txt);
  BEGIN PERFORM public.set_ptm_online_teacher_hours(v_h1, v_t1, NULL, NULL); v_state := 'set';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_busy', 'widening a teacher onto their other PTM is refused as busy', v_state);
  v_js := public.set_ptm_online_teachers(v_h1, ARRAY[v_t1, v_t2, v_t3],
            jsonb_build_array(jsonb_build_object('teacher_id', v_t1, 'start_time', '12:00', 'end_time', '12:30'),
                              jsonb_build_object('teacher_id', v_t3, 'start_time', '14:00', 'end_time', '15:00')));
  PERFORM pg_temp.chk((v_js->>'hours_changed')::int = 1
                      AND v_js->'refused' @> jsonb_build_array(jsonb_build_object('teacher_id', v_t1, 'reason', 'hours_has_bookings'))
                      AND (SELECT start_time FROM public.ptm_online_teachers WHERE ptm_id = v_h1 AND teacher_id = v_t1) = '12:00'
                      AND (SELECT end_time FROM public.ptm_online_teachers WHERE ptm_id = v_h1 AND teacher_id = v_t1) = '13:00'
                      AND (SELECT start_time FROM public.ptm_online_teachers WHERE ptm_id = v_h1 AND teacher_id = v_t3) = '14:00',
    'set teachers: new hours for one, a refusal by name for the other, whose hours stay', left(v_js::text, 200));
  IF v_t4 IS NOT NULL THEN
    v_js := public.set_ptm_online_teachers(v_h1, ARRAY[v_t1, v_t2, v_t3, v_t4],
              jsonb_build_array(jsonb_build_object('teacher_id', v_t4, 'start_time', '12:00', 'end_time', '12:20')));
    PERFORM pg_temp.chk((v_js->>'added')::int = 1
                        AND (SELECT end_time FROM public.ptm_online_teachers WHERE ptm_id = v_h1 AND teacher_id = v_t4) = '12:20',
      'an added teacher gets their own hours', left(v_js::text, 200));
  END IF;
  BEGIN
    PERFORM public.update_ptm_schedule(v_h1, 'Suite H1', NULL, NULL, v_d6, '12:30', '15:00', true, 15, 240, 3);
    v_state := 'updated';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_hours_outside' AND v_txt LIKE '%own hours that no longer fit%',
    'a meeting edit that cuts a teacher''s own hours is refused, naming them', v_txt);
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public._ptm_slots(v_ptm1);
  SELECT count(*) INTO v_m FROM public._ptm_slots(v_ptm1, v_t1);
  PERFORM pg_temp.chk(v_n = 3 AND v_m = 3, 'a PTM without own hours keeps the meeting''s grid', format('%s/%s', v_n, v_m));

  -- ── 18. Meet rooms and the 15-minute reminder (20261006140100) ───────────
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public.ptm_meet_claim_due(integer)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.ptm_meet_record(uuid,text,text,boolean)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.ptm_meet_fail(uuid,text)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.ptm_meet_close_due(integer)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.ptm_meet_closed(uuid,boolean)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.ptm_meet_create_kick()', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.ptm_send_15m_reminders()', 'EXECUTE')
                  AND has_function_privilege('service_role', 'public.ptm_meet_claim_due(integer)', 'EXECUTE'),
    'room RPCs are service_role only');
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname IN ('ptm-meet-rooms-1min', 'ptm-15m-reminders-5min') AND active;
  PERFORM pg_temp.chk(v_n = 2, 'both crons scheduled', format('%s', v_n));
  IF v_now_t BETWEEN '01:00' AND '21:00' THEN
    -- A PTM today whose first slot starts 11 to 15 minutes from now.
    v_rs_ts := date_trunc('minute', now() AT TIME ZONE 'Asia/Kolkata') + interval '11 minutes';
    v_rs_ts := v_rs_ts + make_interval(mins => (5 - extract(minute FROM v_rs_ts)::int % 5) % 5);
    PERFORM pg_temp.as_user(v_t2);
    v_rooms := public.create_online_ptm(v_inst, 'Suite rooms', NULL, v_today, v_rs_ts::time, (v_rs_ts + interval '90 minutes')::time,
                                        10, 0, 'teacher', NULL, ARRAY[v_s1, v_s2], 240, 3);
    PERFORM pg_temp.as_user(v_s1);
    v_br1 := public.book_ptm_slot(v_rooms, v_rs_ts::time, false);
    PERFORM pg_temp.as_user(v_s2);
    v_br2 := public.book_ptm_slot(v_rooms, (v_rs_ts + interval '80 minutes')::time, false);
    PERFORM pg_temp.as_owner();
    SELECT count(*) FILTER (WHERE d.booking_id = v_br1), count(*) FILTER (WHERE d.booking_id = v_br2) INTO v_n, v_m
      FROM public._ptm_meet_create_due(now()) d;
    PERFORM pg_temp.chk(v_n = 1 AND v_m = 0, 'a room is due for a slot within the hour, not for one further out', format('%s/%s', v_n, v_m));
    -- A 10-minute slot is locked 25 minutes after it starts, so no room is made after that.
    SELECT count(*) FILTER (WHERE d.booking_id = v_br1) INTO v_n
      FROM public._ptm_meet_create_due((v_rs_ts + interval '20 minutes') AT TIME ZONE 'Asia/Kolkata') d;
    SELECT count(*) FILTER (WHERE d.booking_id = v_br1) INTO v_m
      FROM public._ptm_meet_create_due((v_rs_ts + interval '26 minutes') AT TIME ZONE 'Asia/Kolkata') d;
    PERFORM pg_temp.chk(v_n = 1 AND v_m = 0, 'a room is still made during the slot, never once it is due to lock', format('%s/%s', v_n, v_m));
    PERFORM pg_temp.chk(public.ptm_meet_create_kick() IS NOT NULL, 'the kick posts when a room is due (the request is rolled back with the test)');
    SELECT count(*) INTO v_n FROM public.ptm_meet_claim_due(50) c
     WHERE c.booking_id = v_br1 AND c.attempt = 1 AND c.teacher_id = v_t2
       AND c.teacher_google_email = 't2.suite@example.com' AND c.student_name IS NOT NULL
       AND c.slot_starts_at = v_rs_ts AT TIME ZONE 'Asia/Kolkata';
    PERFORM pg_temp.chk(v_n = 1, 'claim hands over the booking, its slot and the teacher''s Google account', format('%s', v_n));
    SELECT count(*) INTO v_n FROM public.ptm_meet_claim_due(50) c WHERE c.booking_id = v_br1;
    PERFORM pg_temp.chk(v_n = 0, 'a second pass does not claim it again', format('%s', v_n));
    PERFORM public.ptm_meet_fail(v_br1, 'spaces.create 503: try later');
    SELECT count(*) INTO v_n FROM public.ptm_meet_claim_due(50) c WHERE c.booking_id = v_br1;
    UPDATE public.ptm_booking_meet SET meet_claimed_at = now() - interval '3 minutes' WHERE booking_id = v_br1;
    SELECT count(*) INTO v_m FROM public.ptm_meet_claim_due(50) c WHERE c.booking_id = v_br1 AND c.attempt = 2;
    PERFORM pg_temp.chk(v_n = 0 AND v_m = 1 AND (SELECT meet_error IS NULL FROM public.ptm_booking_meet WHERE booking_id = v_br1),
      'a failed room is retried after 2 minutes, as attempt 2', format('%s/%s', v_n, v_m));
    PERFORM pg_temp.chk(public.ptm_meet_record(v_br1, 'spaces/suiteR1', 'https://meet.google.com/aaa-bbbb-ccc', false)
                        AND NOT public.ptm_meet_record(v_br1, 'spaces/suiteR1b', 'https://meet.google.com/zzz-zzzz-zzz', false),
      'record saves the room once; a late second room is not saved');
    PERFORM pg_temp.as_user(v_s1);
    SELECT count(*) INTO v_n FROM public.ptm_online_my_sessions(v_rooms)
     WHERE booking_id = v_br1 AND meet_ready AND meet_uri = 'https://meet.google.com/aaa-bbbb-ccc';
    PERFORM pg_temp.chk(v_n = 1, 'the family sees its room', format('%s', v_n));
    -- s2 moves into the hour; a room that failed 5 times is given up.
    PERFORM pg_temp.as_user(v_s2);
    v_br2 := public.book_ptm_slot(v_rooms, (v_rs_ts + interval '20 minutes')::time, true);
    PERFORM pg_temp.as_owner();
    INSERT INTO public.ptm_booking_meet (booking_id, meet_attempts, meet_claimed_at, meet_error)
    VALUES (v_br2, 5, now() - interval '1 hour', 'spaces.create 403');
    SELECT count(*) INTO v_n FROM public._ptm_meet_create_due(now()) d WHERE d.booking_id = v_br2;
    PERFORM pg_temp.as_user(v_t2);
    SELECT s.meet_failed_count INTO v_m FROM public.ptm_online_sessions(v_rooms) s WHERE s.teacher_id = v_t2;
    PERFORM pg_temp.chk(v_n = 0 AND v_m = 1, 'after 5 failures no more tries, and the teacher''s session counts it', format('%s/%s', v_n, v_m));
    -- reminders: the family once per booking, the teacher once per PTM
    PERFORM pg_temp.as_owner();
    PERFORM public.ptm_send_15m_reminders();
    PERFORM public.ptm_send_15m_reminders();
    SELECT count(*) FILTER (WHERE nt.user_id = v_s1), count(*) FILTER (WHERE nt.user_id = v_t2) INTO v_n, v_m
      FROM public.notifications nt
     WHERE nt.type = 'ptm_reminder_15m' AND (nt.metadata->>'ptm_id')::uuid = v_rooms;
    SELECT count(*) INTO fn FROM public.notifications nt
     WHERE nt.type = 'ptm_reminder_15m' AND (nt.metadata->>'ptm_id')::uuid = v_rooms AND nt.message LIKE '%meet.google%';
    PERFORM pg_temp.chk(v_n = 1 AND v_m = 1 AND fn = '0', '15-minute reminder: family and teacher once each, no link in the text',
      format('family %s, teacher %s', v_n, v_m));
    -- a swap keeps the room; a cancelled booking's room is locked
    PERFORM pg_temp.as_user(v_admin);
    PERFORM public.swap_ptm_online_teacher(v_rooms, v_t2, v_t3);
    PERFORM pg_temp.as_owner();
    PERFORM pg_temp.chk((SELECT meet_uri FROM public.ptm_booking_meet WHERE booking_id = v_br1) = 'https://meet.google.com/aaa-bbbb-ccc',
      'a swapped booking keeps its link');
    SELECT count(*) INTO v_n FROM public._ptm_meet_close_due(now()) d WHERE d.booking_id = v_br1;
    PERFORM pg_temp.as_user(v_s1);
    PERFORM public.cancel_ptm_booking(v_br1);
    PERFORM pg_temp.as_owner();
    SELECT count(*) INTO v_m FROM public.ptm_meet_close_due(50) c WHERE c.booking_id = v_br1 AND c.space_id = 'spaces/suiteR1';
    PERFORM pg_temp.chk(v_n = 0 AND v_m = 1, 'a live room is left open; once its booking is cancelled it is handed over to lock',
      format('%s/%s', v_n, v_m));
    SELECT count(*) INTO v_n FROM public.ptm_meet_close_due(50) c WHERE c.booking_id = v_br1;
    PERFORM public.ptm_meet_closed(v_br1, true);
    SELECT count(*) INTO v_m FROM public._ptm_meet_close_due(now()) d WHERE d.booking_id = v_br1;
    PERFORM pg_temp.chk(v_n = 0 AND v_m = 0 AND (SELECT meet_closed_at IS NOT NULL FROM public.ptm_booking_meet WHERE booking_id = v_br1),
      'locked once, then never again', format('%s/%s', v_n, v_m));
  ELSE
    PERFORM pg_temp.skip('Meet rooms', 'too close to midnight IST');
  END IF;
  -- a room whose slot is over is locked
  IF v_ptm5 IS NOT NULL THEN
    PERFORM pg_temp.as_owner();
    INSERT INTO public.ptm_bookings (ptm_id, parent_id, class_id, slot_time, status, teacher_id)
    VALUES (v_ptm5, v_s1, v_class_a, '00:00', 'booked', v_t1) RETURNING id INTO v_bpast;
    INSERT INTO public.ptm_booking_meet (booking_id, meet_uri, meet_space_id, meet_created_at, meet_claimed_at, meet_attempts)
    VALUES (v_bpast, 'https://meet.google.com/old-slot-xyz', 'spaces/suitePast', now() - interval '2 hours', now() - interval '2 hours', 1);
    SELECT count(*) INTO v_n FROM public._ptm_meet_close_due(now()) d WHERE d.booking_id = v_bpast;
    SELECT count(*) INTO v_m FROM public._ptm_meet_create_due(now()) d WHERE d.booking_id = v_bpast;
    PERFORM pg_temp.chk(v_n = 1 AND v_m = 0, 'a room whose slot ended 15+ minutes ago is due to lock, and never made again', format('%s/%s', v_n, v_m));
  END IF;

  -- ── 20. class sessions (20261006170000) ──────────────────────────────────
  v_d8 := v_today + 8;
  v_d9 := v_today + 9;
  PERFORM pg_temp.as_owner();
  SELECT h.class_id INTO v_class_b FROM public.ptm_classes_for_hat(v_t1, 'teacher') h
   WHERE h.class_id <> v_class_a
     AND EXISTS (SELECT 1 FROM public.class_assignments s WHERE s.class_id = h.class_id AND s.role = 'student'
                   AND public._ptm_pickable_class(s.user_id) = h.class_id)
   ORDER BY h.class_id LIMIT 1;
  SELECT x INTO v_tx FROM unnest(ARRAY[v_t3, v_t4]) x
   WHERE x IS NOT NULL AND NOT public.is_class_teacher_of(x, v_class_a) LIMIT 1;
  PERFORM pg_temp.chk(has_table_privilege('authenticated', 'public.ptm_online_class_sessions', 'SELECT')
                  AND NOT has_table_privilege('anon', 'public.ptm_online_class_sessions', 'SELECT')
                  AND NOT has_table_privilege('authenticated', 'public.ptm_online_class_sessions', 'INSERT')
                  AND NOT has_table_privilege('authenticated', 'public.ptm_online_session_teachers', 'INSERT')
                  AND has_function_privilege('authenticated', 'public.set_ptm_online_class_sessions(uuid,jsonb)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.create_online_ptm(uuid,text,text,date,time,time,integer,integer,text,uuid[],uuid[],integer,integer,jsonb,text,jsonb)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.ptm_online_booking_grid(uuid,uuid,uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._ptm_parse_class_sessions(jsonb)', 'EXECUTE')
                  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_online_ptm' AND pronargs <> 16)
                  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ptm_online_booking_grid' AND pronargs <> 3),
    'class sessions: readable table, no browser writes, one signature per RPC');
  PERFORM pg_temp.as_user(v_t1);
  BEGIN PERFORM 1 FROM public.ptm_online_class_sessions LIMIT 0; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = 'ok', 'the frontend probe reads the table without an error', v_state);

  -- Separately, two classes, t1 in both at different hours.
  v_sess := jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'start_time', '09:00', 'end_time', '10:00',
                                                 'teacher_ids', jsonb_build_array(v_t1, v_t2), 'student_ids', '[]'::jsonb));
  IF v_class_b IS NOT NULL THEN
    v_sess := v_sess || jsonb_build_array(jsonb_build_object('class_id', v_class_b, 'start_time', '10:05', 'end_time', '11:00',
                                                             'teacher_ids', jsonb_build_array(v_t1), 'student_ids', '[]'::jsonb));
  END IF;
  PERFORM pg_temp.as_user(v_admin);
  v_cp := public.create_online_ptm(v_inst, 'Suite C1', NULL, v_d8, '09:00', '12:00', 15, 5, 'admin', NULL, NULL, 240, 3,
                                   NULL, 'separate', v_sess);
  PERFORM pg_temp.as_owner();
  SELECT cs.id INTO v_cs_a FROM public.ptm_online_class_sessions cs WHERE cs.ptm_id = v_cp AND cs.class_id = v_class_a;
  SELECT cs.id INTO v_cs_b FROM public.ptm_online_class_sessions cs WHERE cs.ptm_id = v_cp AND cs.class_id = v_class_b;
  SELECT count(*) INTO v_n FROM public.ptm_online_session_teachers WHERE ptm_id = v_cp;
  SELECT count(*) INTO v_m FROM public.ptm_online_teachers WHERE ptm_id = v_cp;
  PERFORM pg_temp.chk(v_cs_a IS NOT NULL AND v_n = CASE WHEN v_class_b IS NULL THEN 2 ELSE 3 END AND v_m = 2
                      AND (SELECT online_format FROM public.ptm_schedules WHERE id = v_cp) = 'separate',
    'by class: one row per class, a seat per class and teacher, one PTM row per teacher', format('%s seats, %s teachers', v_n, v_m));
  SELECT count(*) INTO v_n FROM public._ptm_session_slots(v_cs_a);
  SELECT count(*) INTO v_m FROM public._ptm_slots(v_cp, v_t1);
  PERFORM pg_temp.chk(v_n = 3 AND v_m = CASE WHEN v_class_b IS NULL THEN 3 ELSE 6 END,
    'slots per class (09:00 to 10:00 gives 3); a teacher in two classes has both grids', format('%s/%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_admin);
  SELECT count(*) FILTER (WHERE s.class_session_id IS NOT NULL AND s.class_name IS NOT NULL AND s.format = 'separate'),
         count(*) INTO v_n, v_m FROM public.ptm_online_sessions(v_cp) s;
  PERFORM pg_temp.chk(v_n = v_m AND v_m = CASE WHEN v_class_b IS NULL THEN 2 ELSE 3 END,
    'sessions: one row per class and teacher, with the class and the format', format('%s/%s', v_n, v_m));
  SELECT count(*) INTO v_n FROM public.ptm_teacher_busy_windows(v_d8, ARRAY[v_t1], NULL) w WHERE w.ptm_id = v_cp;
  PERFORM pg_temp.chk(v_n = CASE WHEN v_class_b IS NULL THEN 1 ELSE 2 END,
    'busy windows: a teacher is held for each class''s hours, not the whole meeting', format('%s', v_n));
  IF v_class_b IS NOT NULL THEN
    -- t1 is held 10:05 to 11:05 for class B: 10:30 elsewhere is busy, the meeting's 11:30 is not checked here.
    BEGIN
      PERFORM public.create_online_ptm(v_inst, 'Suite C busy', NULL, v_d8, '10:30', '11:30', 15, 0, 'admin', NULL, NULL, 240, 3, NULL, 'separate',
        jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'teacher_ids', jsonb_build_array(v_t1))));
      v_state := 'created';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    PERFORM pg_temp.chk(v_state = 'ptm_teacher_busy', 'a class seat overlapping another PTM''s class seat is busy', v_state);
    FOREACH v_txt IN ARRAY ARRAY['09:30', '10:00'] LOOP
      BEGIN
        PERFORM public.create_online_ptm(v_inst, 'Suite C2 ' || v_txt, NULL, v_d9, '09:00', '12:00', 15, 5, 'admin', NULL, NULL, 240, 3, NULL, 'separate',
          jsonb_build_array(
            jsonb_build_object('class_id', v_class_a, 'start_time', '09:00', 'end_time', '10:00', 'teacher_ids', jsonb_build_array(v_t1)),
            jsonb_build_object('class_id', v_class_b, 'start_time', v_txt, 'end_time', '11:00', 'teacher_ids', jsonb_build_array(v_t1))));
        v_state := 'created';
      EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; v_state := v_hint; END;
      PERFORM pg_temp.chk(v_state = 'ptm_teacher_double_booked' AND v_txt LIKE '% is in % and % at the same time.%',
        'one teacher in two classes at once is refused, gap included, naming both', v_txt);
    END LOOP;
  ELSE
    PERFORM pg_temp.skip('two classes for one teacher', 'no second class for t1');
  END IF;
  IF v_tx IS NOT NULL THEN
    BEGIN
      PERFORM public.create_online_ptm(v_inst, 'Suite C3', NULL, v_d9, '09:00', '10:00', 15, 5, 'admin', NULL, NULL, 240, 3, NULL, 'separate',
        jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'teacher_ids', jsonb_build_array(v_tx))));
      v_state := 'created';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    PERFORM pg_temp.chk(v_state = 'ptm_teacher_not_in_class', 'a teacher who does not teach the class is refused', v_state);
  END IF;
  FOREACH v_txt IN ARRAY ARRAY['twice', 'noteacher', 'panelflat', 'teacherhat'] LOOP
    IF v_txt = 'teacherhat' THEN PERFORM pg_temp.as_user(v_t1); ELSE PERFORM pg_temp.as_user(v_admin); END IF;
    BEGIN
      PERFORM public.create_online_ptm(v_inst, 'Suite C4 ' || v_txt, NULL, v_d9, '09:00', '10:00', 15, 5,
        CASE WHEN v_txt = 'teacherhat' THEN 'teacher' ELSE 'admin' END,
        CASE WHEN v_txt = 'panelflat' THEN ARRAY[v_t1] END, NULL, 240, 3, NULL,
        CASE WHEN v_txt = 'panelflat' THEN 'panel' ELSE 'separate' END,
        CASE v_txt
          WHEN 'twice' THEN jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'teacher_ids', jsonb_build_array(v_t1)),
                                              jsonb_build_object('class_id', v_class_a, 'teacher_ids', jsonb_build_array(v_t2)))
          WHEN 'noteacher' THEN jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'teacher_ids', '[]'::jsonb))
          WHEN 'teacherhat' THEN jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'teacher_ids', jsonb_build_array(v_t1)))
          ELSE NULL END);
      v_state := 'created';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    -- Together is retired (20261009110000): 'panel' is ignored, so panelflat is an ordinary PTM.
    PERFORM pg_temp.chk(v_state = CASE WHEN v_txt = 'teacherhat' THEN 'ptm_teacher_fixed'
                                       WHEN v_txt = 'panelflat' THEN 'created' ELSE 'ptm_sessions_invalid' END,
      'class list: ' || v_txt, v_state);
  END LOOP;

  -- Separately: teachers pick from their classes; booking follows the class.
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.set_ptm_online_students(v_cp, ARRAY[v_s1, v_s2, v_out], NULL);
  PERFORM pg_temp.chk((v_js->>'added')::int = 2
                      AND v_js->'refused' @> jsonb_build_array(jsonb_build_object('student_id', v_out, 'reason', 'not_your_class'))
                      AND (SELECT count(*) FROM public.ptm_online_participants op
                            WHERE op.ptm_id = v_cp AND op.class_session_id = v_cs_a AND op.teacher_id = v_t1) = 2,
    'a teacher''s picks land in the class of each student; a student of no class of theirs is refused', left(v_js::text, 200));
  v_js := public.ptm_online_pick_options(v_cp, NULL);
  PERFORM pg_temp.chk(v_js @> jsonb_build_array(jsonb_build_object('student_id', v_s1, 'state', 'mine'))
                      AND NOT v_js @> jsonb_build_array(jsonb_build_object('student_id', v_out)),
    'pick options: only the teacher''s classes in this PTM', format('%s rows', jsonb_array_length(v_js)));
  PERFORM pg_temp.as_user(v_t2);
  v_js := public.set_ptm_online_students(v_cp, ARRAY[v_s1], NULL);
  PERFORM pg_temp.chk((v_js->>'added')::int = 1 AND jsonb_array_length(v_js->'refused') = 0,
    'Separately: another teacher of the class may pick the same student', left(v_js::text, 200));
  PERFORM pg_temp.as_user(v_s1);
  IF v_class_b IS NOT NULL THEN
    BEGIN PERFORM public.book_ptm_slot(v_cp, '10:25', false, v_t1); v_txt := 'booked';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
    PERFORM pg_temp.chk(v_txt = 'That time is not one of this class''s slots.', 'another class''s slot cannot be booked', v_txt);
  END IF;
  v_bk2 := public.book_ptm_slot(v_cp, '09:20', false, v_t1);
  SELECT count(*), min(g.slot_time)::text || '-' || max(g.slot_time)::text INTO v_n, v_txt FROM public.ptm_online_booking_grid(v_cp, v_t1) g;
  PERFORM pg_temp.chk(v_n = 3 AND v_txt = '09:00:00-09:40:00'
                      AND (SELECT class_session_id FROM public.ptm_bookings WHERE id = v_bk2) = v_cs_a,
    'the family books inside its class''s hours; the booking carries the class session', format('%s %s', v_n, v_txt));
  PERFORM pg_temp.as_user(v_t1);
  SELECT count(*), count(*) FILTER (WHERE g.student_name IS NOT NULL) INTO v_n, v_m
    FROM public.ptm_online_booking_grid(v_cp, v_t1, v_cs_a) g;
  PERFORM pg_temp.chk(v_n = 3 AND v_m = 1, 'the teacher''s grid for one class', format('%s/%s', v_n, v_m));

  -- Changing the classes after creation.
  PERFORM pg_temp.as_user(v_admin);
  v_sess := jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'start_time', '09:00', 'end_time', '09:30',
                                                 'teacher_ids', jsonb_build_array(v_t1)));
  IF v_class_b IS NOT NULL THEN
    v_sess := v_sess || jsonb_build_array(jsonb_build_object('class_id', v_class_b, 'start_time', '09:30', 'end_time', '10:30',
                                                             'teacher_ids', jsonb_build_array(v_t1)));
  END IF;
  v_js := public.set_ptm_online_class_sessions(v_cp, v_sess);
  PERFORM pg_temp.chk((v_js->>'removed')::int = 1 AND (v_js->>'hours_changed')::int = 0
                      AND v_js->'refused' @> jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'reason', 'hours_has_bookings'))
                      AND (v_class_b IS NULL OR v_js->'refused' @> jsonb_build_array(jsonb_build_object('class_id', v_class_b, 'teacher_id', v_t1, 'reason', 'double_booked')))
                      AND NOT EXISTS (SELECT 1 FROM public.ptm_online_teachers WHERE ptm_id = v_cp AND teacher_id = v_t2),
    'set classes: a teacher without bookings leaves (and the PTM); stranding hours and a double booking are refused by name',
    left(v_js::text, 300));
  v_js := public.set_ptm_online_class_sessions(v_cp,
            jsonb_build_array(jsonb_build_object('class_id', COALESCE(v_class_b, v_class_a), 'teacher_ids', jsonb_build_array(v_t1))));
  PERFORM pg_temp.chk(v_class_b IS NULL OR (v_js->'refused' @> jsonb_build_array(jsonb_build_object('class_id', v_class_a, 'reason', 'has_bookings'))
                      AND EXISTS (SELECT 1 FROM public.ptm_online_class_sessions WHERE id = v_cs_a)),
    'a class with a booked family is not removed', left(v_js::text, 200));
  FOREACH v_txt IN ARRAY ARRAY['flat', 'hours', 'empty'] LOOP
    BEGIN
      IF v_txt = 'flat' THEN PERFORM public.set_ptm_online_teachers(v_cp, ARRAY[v_t1]);
      ELSIF v_txt = 'hours' THEN PERFORM public.set_ptm_online_teacher_hours(v_cp, v_t1, '09:00', '10:00');
      ELSE PERFORM public.set_ptm_online_class_sessions(v_cp, '[]'::jsonb); END IF;
      v_state := 'done';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
    PERFORM pg_temp.chk(v_state = CASE WHEN v_txt = 'empty' THEN 'ptm_sessions_invalid' ELSE 'ptm_has_class_sessions' END,
      'by class, refused: ' || v_txt, v_state);
  END LOOP;
  BEGIN
    PERFORM public.update_ptm_schedule(v_cp, 'Suite C1', NULL, NULL, v_d8, '09:30', '12:00', true, 15, 240, 3);
    v_state := 'updated';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_hours_outside' AND v_txt LIKE '%own hours that no longer fit%',
    'a meeting edit that cuts a class''s own hours is refused', v_txt);
  IF v_t4 IS NOT NULL THEN
    v_js := public.swap_ptm_online_teacher(v_cp, v_t1, v_t4);
    PERFORM pg_temp.as_owner();
    PERFORM pg_temp.chk((SELECT teacher_id FROM public.ptm_bookings WHERE id = v_bk2) = v_t4
                        AND NOT EXISTS (SELECT 1 FROM public.ptm_online_session_teachers WHERE ptm_id = v_cp AND teacher_id = v_t1)
                        AND EXISTS (SELECT 1 FROM public.ptm_online_session_teachers WHERE class_session_id = v_cs_a AND teacher_id = v_t4),
      'a swap hands over every class seat and booking', left(v_js::text, 200));
  END IF;

  -- ── 20b. several teachers per student (20261009110000) ─────────────────
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'book_ptm_slot' AND pronargs <> 4)
                      AND NOT EXISTS (SELECT 1 FROM public.ptm_schedules WHERE online_format <> 'separate')
                      AND has_function_privilege('authenticated', 'public.book_ptm_slot(uuid,time,boolean,uuid)', 'EXECUTE'),
    'book_ptm_slot takes the teacher; no Together PTM is left');
  PERFORM pg_temp.as_user(v_admin);
  v_cq := public.create_online_ptm(v_inst, 'Suite M1', NULL, v_d9, '14:00', '15:00', 15, 5, 'admin', ARRAY[v_t1, v_t2], NULL, 240, 3,
                                   NULL, 'panel', NULL);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((SELECT online_format FROM public.ptm_schedules WHERE id = v_cq) = 'separate',
    'asking for Together makes an ordinary online PTM');
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.set_ptm_online_students(v_cq, ARRAY[v_s3, v_s4], NULL);
  PERFORM pg_temp.as_user(v_t2);
  v_js := public.set_ptm_online_students(v_cq, ARRAY[v_s3], NULL);
  PERFORM pg_temp.chk((v_js->>'added')::int = 1, 'a second teacher picks the same student', left(v_js::text, 200));
  v_js := public.ptm_online_pick_options(v_cq, NULL);
  PERFORM pg_temp.chk(v_js @> jsonb_build_array(jsonb_build_object('student_id', v_s3, 'state', 'mine',
                          'with_teachers', jsonb_build_array((SELECT full_name FROM public.profiles WHERE id = v_t1))))
                      AND v_js @> jsonb_build_array(jsonb_build_object('student_id', v_s4, 'state', 'free'))
                      AND NOT v_js::text LIKE '%"taken"%',
    'pick options: mine for this teacher, the other teacher named in with_teachers, nothing taken',
    format('%s rows', jsonb_array_length(v_js)));
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.notifications nt
   WHERE nt.type = 'ptm_online_invited' AND (nt.metadata->>'ptm_id')::uuid = v_cq AND nt.user_id = v_s3;
  PERFORM pg_temp.chk(v_n = 2, 'the family is invited once by each teacher', format('%s', v_n));
  PERFORM pg_temp.as_user(v_s3);
  SELECT count(*) INTO v_n FROM public.ptm_online_my_sessions(v_cq) s WHERE s.teacher_id IN (v_t1, v_t2);
  PERFORM pg_temp.chk(v_n = 2, 'my sessions: one row per teacher', format('%s', v_n));
  BEGIN PERFORM public.book_ptm_slot(v_cq, '14:00', false); v_state := 'booked';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_ambiguous', 'with two teachers, booking must name one', v_state);
  BEGIN PERFORM 1 FROM public.ptm_online_booking_grid(v_cq, NULL); v_state := 'read';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_teacher_ambiguous', 'and so must the grid', v_state);
  BEGIN PERFORM public.book_ptm_slot(v_cq, '14:00', false, v_t3); v_state := 'booked';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_not_participant', 'a teacher the family is not with is refused', v_state);
  v_bk2 := public.book_ptm_slot(v_cq, '14:00', false, v_t1);
  BEGIN PERFORM public.book_ptm_slot(v_cq, '14:00', false, v_t2); v_state := 'booked';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_family_double_booked'
                      AND v_txt LIKE 'You have a slot with ' || (SELECT full_name FROM public.profiles WHERE id = v_t1) || ' at 14:00.%',
    'a family''s two slots may not overlap; the other teacher and time are named', v_txt);
  v_bk3 := public.book_ptm_slot(v_cq, '14:20', false, v_t2);
  SELECT count(*) INTO v_n FROM public.ptm_online_booking_grid(v_cq, v_t2) g WHERE g.is_mine AND g.slot_time = '14:20';
  PERFORM pg_temp.chk(v_n = 1 AND v_bk3 IS NOT NULL, 'back to back after the gap, a slot with each teacher; the grid marks the one with that teacher',
    format('%s', v_n));
  BEGIN PERFORM public.book_ptm_slot(v_cq, '14:40', false, v_t1); v_state := 'booked';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; v_state := v_hint; END;
  PERFORM pg_temp.chk(v_state = 'ptm_already_booked', 'still one booking per teacher', v_state);
  v_bk3 := public.book_ptm_slot(v_cq, '14:40', true, v_t2);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((SELECT cancelled_at IS NULL FROM public.ptm_bookings WHERE id = v_bk2)
                      AND (SELECT slot_time FROM public.ptm_bookings WHERE id = v_bk3) = '14:40',
    'changing the slot with one teacher leaves the other booking alone');
  SELECT count(*) INTO v_n FROM public.notifications nt
   WHERE nt.type = 'ptm_booking_confirmed' AND (nt.metadata->>'booking_id')::uuid = v_bk2
     AND nt.message LIKE '%with ' || (SELECT full_name FROM public.profiles WHERE id = v_t1) || '%';
  PERFORM pg_temp.chk(v_n = 1, 'the booking confirmation names the teacher', format('%s', v_n));
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.set_ptm_online_students(v_cq, ARRAY[v_s4], NULL);
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((v_js->>'cancelled_bookings')::int = 1
                      AND (SELECT cancelled_at IS NOT NULL FROM public.ptm_bookings WHERE id = v_bk2)
                      AND (SELECT cancelled_at IS NULL FROM public.ptm_bookings WHERE id = v_bk3)
                      AND EXISTS (SELECT 1 FROM public.ptm_online_participants WHERE ptm_id = v_cq AND student_id = v_s3 AND teacher_id = v_t2),
    'one teacher dropping the student cancels only the booking with that teacher', left(v_js::text, 200));

  -- ── 19. account deletes with own hours and rooms (CLAUDE.md 21) ──────────
  PERFORM pg_temp.as_owner();
  FOREACH fn IN ARRAY ARRAY[v_t1::text, v_t2::text, v_s1::text, v_s3::text] LOOP
    BEGIN
      DELETE FROM auth.users WHERE id = fn::uuid;
      RAISE EXCEPTION 'probe-ok' USING ERRCODE = 'P0001';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
    END;
    PERFORM pg_temp.chk(v_txt = 'probe-ok', 'delete still works after hours and rooms (' || fn || ')', v_txt);
  END LOOP;
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
