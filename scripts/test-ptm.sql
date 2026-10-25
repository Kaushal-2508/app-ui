-- PTM module acceptance suite (migrations 20260928180000, 20260928183000 and
-- 20260929170000). Runs as a real admin, wing coordinator, teachers and
-- students against real prod rows under RLS, then rolls everything back.
-- Assertions RECORD instead of raising. Section 10 covers the 2026-09-29 rule:
-- a teacher acts on every class they teach, with or without a subject.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-ptm.sql -OutFile "$env:TEMP\ptm.json"
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
  v_inst uuid; v_wing uuid; v_coord uuid; v_teacher uuid; v_teacher2 uuid; v_admin uuid;
  v_class_a uuid; v_class_b uuid; v_class_x uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
  v_today date; v_now_t time;
  v_ptm_t uuid; v_ptm_c uuid; v_ptm_school uuid; v_ptm_legacy uuid; v_ptm_fb uuid; v_ptm_old uuid;
  v_ptm_cut uuid; v_ptm_book uuid;
  v_teacher3 uuid; v_class_t3 uuid; v_class_n uuid; v_s4 uuid; v_ptm_t3 uuid; v_b3 uuid;
  v_b1 uuid; v_b2 uuid; v_state text; v_n int; v_m int; v_js jsonb; v_txt text; v_tok text;
  fn text;
BEGIN
  v_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now_t := (now() AT TIME ZONE 'Asia/Kolkata')::time;

  -- ── 0. cast (Alliance: a wing with two classes that have students) ──────
  SELECT i.id INTO v_inst FROM public.institutions i WHERE i.name = 'Alliance International School';
  SELECT wa.wing_id, wa.user_id INTO v_wing, v_coord
    FROM public.wing_assignments wa
    JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst AND w.is_active IS NOT FALSE
   WHERE public._ptm_has_hat(wa.user_id, v_inst, 'coordinator')
     AND NOT public.is_institution_admin(wa.user_id, v_inst)
     AND (SELECT count(*) FROM public.wing_class_mappings wcm
            JOIN public.classes c ON c.id = wcm.class_id AND c.is_active IS NOT FALSE
           WHERE wcm.wing_id = wa.wing_id
             AND (SELECT count(*) FROM public.class_assignments ca WHERE ca.class_id = c.id AND ca.role = 'student') >= 2) >= 2
   LIMIT 1;

  SELECT c.id INTO v_class_a FROM public.wing_class_mappings wcm
    JOIN public.classes c ON c.id = wcm.class_id AND c.is_active IS NOT FALSE
   WHERE wcm.wing_id = v_wing
     AND (SELECT count(*) FROM public.class_assignments ca WHERE ca.class_id = c.id AND ca.role = 'student') >= 2
   ORDER BY c.name, c.section LIMIT 1;
  SELECT c.id INTO v_class_b FROM public.wing_class_mappings wcm
    JOIN public.classes c ON c.id = wcm.class_id AND c.is_active IS NOT FALSE
   WHERE wcm.wing_id = v_wing AND c.id <> v_class_a
     AND (SELECT count(*) FROM public.class_assignments ca WHERE ca.class_id = c.id AND ca.role = 'student') >= 1
   ORDER BY c.name, c.section LIMIT 1;
  SELECT c.id INTO v_class_x FROM public.classes c
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND NOT EXISTS (SELECT 1 FROM public.wing_class_mappings wcm JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
                      WHERE wcm.class_id = c.id AND wa.user_id = v_coord)
     AND (SELECT count(*) FROM public.class_assignments ca WHERE ca.class_id = c.id AND ca.role = 'student') >= 1
   LIMIT 1;

  SELECT ca.user_id INTO v_s1 FROM public.class_assignments ca
   WHERE ca.class_id = v_class_a AND ca.role = 'student' AND public._ptm_student_class(ca.user_id) = v_class_a
     AND public.has_role(ca.user_id, 'student') ORDER BY ca.user_id LIMIT 1;
  SELECT ca.user_id INTO v_s2 FROM public.class_assignments ca
   WHERE ca.class_id = v_class_a AND ca.role = 'student' AND public._ptm_student_class(ca.user_id) = v_class_a
     AND public.has_role(ca.user_id, 'student') AND ca.user_id <> v_s1 ORDER BY ca.user_id LIMIT 1;
  SELECT ca.user_id INTO v_s3 FROM public.class_assignments ca
   WHERE ca.class_id = v_class_x AND ca.role = 'student' AND public._ptm_student_class(ca.user_id) = v_class_x
     AND public.has_role(ca.user_id, 'student') ORDER BY ca.user_id LIMIT 1;

  SELECT r.user_id INTO v_teacher FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
   WHERE r.role = 'teacher' AND r.institution_id = v_inst AND p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND NOT public.is_institution_admin(r.user_id, v_inst)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r2 WHERE r2.user_id = r.user_id AND r2.role = 'coordinator')
     AND NOT public.is_class_teacher_of(r.user_id, v_class_b)
   ORDER BY r.user_id LIMIT 1;
  SELECT r.user_id INTO v_teacher2 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
   WHERE r.role = 'teacher' AND r.institution_id = v_inst AND p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND NOT public.is_institution_admin(r.user_id, v_inst) AND r.user_id <> v_teacher
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r2 WHERE r2.user_id = r.user_id AND r2.role = 'coordinator')
   ORDER BY r.user_id LIMIT 1;
  SELECT p.id INTO v_admin FROM public.profiles p
   WHERE p.institution_id = v_inst AND public.is_institution_admin(p.id, v_inst) AND NOT public.is_super_admin(p.id)
   ORDER BY p.id LIMIT 1;

  -- Put the teacher (and the second teacher) on class A with a subject-less
  -- teacher row, the kind that counted before 20260929170000 and still counts.
  -- Section 10 covers a teacher who only has a subject row. Rolled back with
  -- everything else.
  INSERT INTO public.class_assignments (user_id, class_id, role, subject_id)
  SELECT v_teacher, v_class_a, 'teacher', NULL
   WHERE NOT public.is_class_teacher_of(v_teacher, v_class_a);
  INSERT INTO public.class_assignments (user_id, class_id, role, subject_id)
  SELECT v_teacher2, v_class_a, 'teacher', NULL
   WHERE NOT public.is_class_teacher_of(v_teacher2, v_class_a);

  PERFORM pg_temp.chk(v_inst IS NOT NULL AND v_wing IS NOT NULL AND v_coord IS NOT NULL AND v_class_a IS NOT NULL
                      AND v_class_b IS NOT NULL AND v_class_x IS NOT NULL AND v_s1 IS NOT NULL AND v_s2 IS NOT NULL
                      AND v_s3 IS NOT NULL AND v_teacher IS NOT NULL AND v_teacher2 IS NOT NULL AND v_admin IS NOT NULL
                      AND public.is_class_teacher_of(v_teacher, v_class_a),
    'cast found (wing, coordinator, teachers of class A, 3 students, admin)',
    format('wing=%s A=%s B=%s X=%s', v_wing, v_class_a, v_class_b, v_class_x));

  -- ── 1. grants ──────────────────────────────────────────────────────────
  FOR fn IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('ptm_manageable_scope','create_ptm_schedule','update_ptm_schedule','cancel_ptm_schedule',
                         'ptm_booking_grid','ptm_class_teachers','ptm_my_bookings','book_ptm_slot','cancel_ptm_booking',
                         'set_ptm_booking_attended','ptm_resolve_feedback_token','ptm_open_for_feedback',
                         'submit_ptm_feedback','ptm_feedback_summary','ptm_feedback_list','ptm_effective_class_ids',
                         'is_class_teacher_of','_ptm_has_hat','_ptm_student_class','ptm_classes_for_hat',
                         'can_manage_ptm','can_view_ptm_feedback','_ptm_audio_segment','ptm_audio_writable',
                         'ptm_audio_readable','_ptm_window','_ptm_class_teacher_names','_ptm_feedback_context',
                         '_ptm_dashboard_classes')
  LOOP
    PERFORM pg_temp.chk(NOT has_function_privilege('anon', fn, 'EXECUTE'), 'anon has no EXECUTE on ' || fn);
  END LOOP;
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public.ptm_classes_for_hat(uuid,text)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._ptm_feedback_context(uuid,uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.is_class_teacher_of(uuid,uuid)', 'EXECUTE'),
    'internal helpers are not callable from the browser');
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND (p.proname LIKE '%ptm%' OR p.proname = 'is_class_teacher_of')
     AND EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=X/%');
  PERFORM pg_temp.chk(v_n = 0, 'no PUBLIC EXECUTE on any PTM function', format('%s still PUBLIC', v_n));
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'create_ptm_schedule';
  PERFORM pg_temp.chk(v_n = 1, 'exactly one create_ptm_schedule (the old overload is gone)', format('%s', v_n));

  -- ── 2. backfill ────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM (
    SELECT ptm_id, parent_id FROM public.ptm_bookings WHERE cancelled_at IS NULL
     GROUP BY 1, 2 HAVING count(*) > 1) d;
  PERFORM pg_temp.chk(v_n = 0, 'no student holds two active bookings for one PTM', format('%s', v_n));
  SELECT count(*) INTO v_n FROM public.ptm_schedules WHERE feedback_token IS NULL OR char_length(feedback_token) <> 32;
  PERFORM pg_temp.chk(v_n = 0, 'every PTM has a 32-character feedback token', format('%s without', v_n));

  -- ── 3. scheduling by hat ───────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_teacher);
  v_js := public.ptm_manageable_scope('teacher');
  PERFORM pg_temp.chk(NOT (v_js->>'can_school')::boolean AND jsonb_array_length(v_js->'wings') = 0
                      AND v_js->'classes' @> jsonb_build_array(jsonb_build_object('id', v_class_a)),
    'teacher scope: the classes they teach, no wings, no school', left(v_js::text, 200));
  v_ptm_t := public.create_ptm_schedule(v_inst, 'Suite T', 'desc', v_today + 3, '10:00', '12:00', 15,
                                        ARRAY[v_class_a], 'teacher', 'class', NULL, 'Room 1', true, 60, 3);
  PERFORM pg_temp.chk(v_ptm_t IS NOT NULL, 'a teacher schedules a PTM for a class they teach');
  BEGIN
    PERFORM public.create_ptm_schedule(v_inst, 'Suite T2', NULL, v_today + 3, '10:00', '12:00', 15,
                                       ARRAY[v_class_a, v_class_b], 'teacher', 'class', NULL, NULL, false, 60, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'a teacher cannot include a class they do not teach', v_state);
  BEGIN
    PERFORM public.create_ptm_schedule(v_inst, 'Suite T3', NULL, v_today + 3, '10:00', '12:00', 15,
                                       NULL, 'teacher', 'wing', v_wing, NULL, false, 60, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'a teacher cannot schedule for a wing', v_state);
  BEGIN
    PERFORM public.create_ptm_schedule(v_inst, 'Suite T4', NULL, v_today + 3, '10:00', '12:00', 15,
                                       NULL, 'admin', 'school', NULL, NULL, false, 60, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'a teacher cannot claim the admin hat', v_state);

  PERFORM pg_temp.as_user(v_coord);
  v_ptm_c := public.create_ptm_schedule(v_inst, 'Suite C', NULL, v_today + 3, '10:00', '12:00', 15,
                                        NULL, 'coordinator', 'wing', v_wing, NULL, false, 60, 3);
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.ptm_schedule_classes WHERE ptm_id = v_ptm_c;
  SELECT count(DISTINCT c.id) INTO v_m FROM public.wing_class_mappings wcm
    JOIN public.classes c ON c.id = wcm.class_id AND c.is_active IS NOT FALSE AND c.institution_id = v_inst
   WHERE wcm.wing_id = v_wing;
  PERFORM pg_temp.chk(v_n = v_m AND v_n >= 2, 'wing PTM materialises exactly the wing''s active classes',
    format('%s rows, wing has %s', v_n, v_m));
  PERFORM pg_temp.as_user(v_coord);
  BEGIN
    PERFORM public.create_ptm_schedule(v_inst, 'Suite C2', NULL, v_today + 3, '10:00', '12:00', 15,
                                       ARRAY[v_class_a, v_class_x], 'coordinator', 'class', NULL, NULL, false, 60, 3);
    v_state := 'created';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'a coordinator cannot include a class outside their wings', v_state);

  PERFORM pg_temp.as_user(v_admin);
  v_ptm_school := public.create_ptm_schedule(v_inst, 'Suite S', NULL, v_today + 3, '10:00', '12:00', 15,
                                             NULL, 'admin', 'school', NULL, NULL, false, 60, 3);
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.ptm_schedule_classes WHERE ptm_id = v_ptm_school;
  PERFORM pg_temp.chk(v_n = 0 AND (SELECT scope_type FROM public.ptm_schedules WHERE id = v_ptm_school) = 'school',
    'admin school-wide PTM writes no class rows', format('%s rows', v_n));
  -- The live dialog's 8-argument call must still work until the new frontend ships.
  PERFORM pg_temp.as_user(v_admin);
  EXECUTE 'SELECT public.create_ptm_schedule(_institution_id => $1, _title => $2, _description => $3,
             _scheduled_date => $4, _start_time => $5, _end_time => $6, _slot_duration_minutes => $7, _class_ids => $8)'
    INTO v_ptm_legacy USING v_inst, 'Suite legacy', 'x', v_today + 4, '09:00'::time, '10:00'::time, 15, ARRAY[v_class_a];
  PERFORM pg_temp.as_owner();
  SELECT created_as_role || '/' || scope_type INTO v_txt FROM public.ptm_schedules WHERE id = v_ptm_legacy;
  PERFORM pg_temp.chk(v_txt = 'admin/class', 'the legacy 8-argument call still schedules (admin, class scope)', v_txt);

  -- ── 4. who may edit / cancel ───────────────────────────────────────────
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(public.can_manage_ptm(v_teacher, v_ptm_t), 'the creating teacher manages their PTM');
  PERFORM pg_temp.chk(NOT public.can_manage_ptm(v_teacher2, v_ptm_t), 'a second teacher of the class cannot manage a colleague''s PTM');
  PERFORM pg_temp.chk(public.can_manage_ptm(v_coord, v_ptm_t), 'the wing coordinator manages a teacher''s PTM');
  PERFORM pg_temp.chk(NOT public.can_manage_ptm(v_coord, v_ptm_school), 'a coordinator cannot manage an admin''s school PTM');
  PERFORM pg_temp.chk(NOT public.can_manage_ptm(v_teacher, v_ptm_c), 'a teacher cannot manage a coordinator''s PTM');
  PERFORM pg_temp.chk(public.can_manage_ptm(v_admin, v_ptm_c), 'an admin manages any PTM');
  PERFORM pg_temp.as_user(v_teacher2);
  BEGIN
    PERFORM public.update_ptm_schedule(v_ptm_t, 'Hijack', NULL, NULL, v_today + 3, '10:00', '12:00', true, 15, 60, 3);
    v_state := 'updated';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.chk(v_state = '42501', 'update refused for someone who cannot manage it', v_state);
  -- The notification trigger must still fire for a DIRECT update by a plain
  -- authenticated admin (the live panel does this) after its EXECUTE grant
  -- was revoked: Postgres does not check it when a trigger fires.
  PERFORM pg_temp.as_user(v_admin);
  UPDATE public.ptm_schedules SET start_time = '09:05' WHERE id = v_ptm_legacy;
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.ptm_notifications_sent
   WHERE ptm_id = v_ptm_legacy AND notification_type = 'ptm_rescheduled';
  PERFORM pg_temp.chk(v_n > 0, 'a direct reschedule still notifies (trigger fires without its grant)', format('%s notified', v_n));

  -- ── 5. booking ─────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_s1);
  v_b1 := public.book_ptm_slot(v_ptm_t, '10:00', false);
  PERFORM pg_temp.chk(v_b1 IS NOT NULL, 'a student books a slot in their class''s PTM');
  PERFORM pg_temp.as_user(v_s2);
  BEGIN PERFORM public.book_ptm_slot(v_ptm_t, '10:00', false); v_txt := 'booked';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'That slot was just taken. Pick another.', 'two families cannot hold one slot', v_txt);
  PERFORM pg_temp.as_user(v_s1);
  BEGIN PERFORM public.book_ptm_slot(v_ptm_t, '10:15', false); v_txt := 'booked';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'You already have a slot. Cancel it first.', 'one active booking per student', v_txt);
  v_b2 := public.book_ptm_slot(v_ptm_t, '10:30', true);
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.ptm_bookings WHERE ptm_id = v_ptm_t AND parent_id = v_s1 AND cancelled_at IS NULL;
  PERFORM pg_temp.chk(v_n = 1 AND (SELECT slot_time FROM public.ptm_bookings WHERE id = v_b2) = '10:30'
                      AND (SELECT cancelled_at IS NOT NULL FROM public.ptm_bookings WHERE id = v_b1),
    'replace moves the booking in one call', format('%s active', v_n));
  PERFORM pg_temp.as_user(v_s1);
  BEGIN PERFORM public.book_ptm_slot(v_ptm_t, '10:07', true); v_txt := 'booked';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'That time is not one of%', 'an off-grid time is refused', v_txt);
  BEGIN PERFORM public.book_ptm_slot(v_ptm_t, '11:55', true); v_txt := 'booked';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'That time is not one of%', 'a slot that would run past the end is refused', v_txt);
  PERFORM pg_temp.as_user(v_s3);
  BEGIN PERFORM public.book_ptm_slot(v_ptm_t, '11:00', false); v_txt := 'booked';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'This meeting is not for your class.', 'a student outside the PTM''s classes cannot book', v_txt);

  -- grid: staff see names, students see only free / taken
  PERFORM pg_temp.as_user(v_teacher);
  SELECT count(*), count(*) FILTER (WHERE g.student_name IS NOT NULL) INTO v_n, v_m
    FROM public.ptm_booking_grid(v_ptm_t, v_class_a) g;
  PERFORM pg_temp.chk(v_n = 8 AND v_m = 1, 'staff grid: 8 slots of 15 min, the booked one named', format('%s slots, %s named', v_n, v_m));
  PERFORM pg_temp.as_user(v_s2);
  SELECT count(*) FILTER (WHERE g.student_name IS NOT NULL OR g.student_id IS NOT NULL),
         count(*) FILTER (WHERE g.booking_id IS NOT NULL) INTO v_n, v_m
    FROM public.ptm_booking_grid(v_ptm_t, NULL) g;
  PERFORM pg_temp.chk(v_n = 0 AND v_m = 1, 'student grid: taken slots show, names never', format('named=%s taken=%s', v_n, v_m));
  PERFORM pg_temp.as_user(v_teacher);
  PERFORM public.set_ptm_booking_attended(v_b2, true);
  PERFORM pg_temp.as_user(v_s1);
  BEGIN PERFORM public.set_ptm_booking_attended(v_b2, false); v_state := 'set';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'a student cannot mark attendance', v_state);

  -- cutoff, and the cutoff in the institution's own timezone (§24)
  IF v_now_t < '21:00' THEN
    PERFORM pg_temp.as_user(v_teacher);
    v_ptm_cut := public.create_ptm_schedule(v_inst, 'Suite cutoff', NULL, v_today,
                   (date_trunc('minute', now() AT TIME ZONE 'Asia/Kolkata') + interval '30 minutes')::time,
                   (date_trunc('minute', now() AT TIME ZONE 'Asia/Kolkata') + interval '90 minutes')::time, 15,
                   ARRAY[v_class_a], 'teacher', 'class', NULL, NULL, true, 60, 3);
    PERFORM pg_temp.as_user(v_s2);
    BEGIN PERFORM public.book_ptm_slot(v_ptm_cut, (date_trunc('minute', now() AT TIME ZONE 'Asia/Kolkata') + interval '30 minutes')::time, false); v_txt := 'booked';
    EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
    PERFORM pg_temp.chk(v_txt = 'Booking has closed for this meeting.', 'booking inside the cutoff is refused', v_txt);

    PERFORM pg_temp.as_user(v_teacher);
    v_ptm_book := public.create_ptm_schedule(v_inst, 'Suite tz', NULL, v_today,
                   (date_trunc('minute', now() AT TIME ZONE 'Asia/Kolkata') + interval '120 minutes')::time,
                   (date_trunc('minute', now() AT TIME ZONE 'Asia/Kolkata') + interval '150 minutes')::time, 15,
                   ARRAY[v_class_a], 'teacher', 'class', NULL, NULL, true, 60, 3);
    PERFORM pg_temp.as_owner();
    PERFORM pg_temp.chk(now() < (SELECT w.booking_closes_at FROM public._ptm_window(v_ptm_book) w),
      'booking two hours ahead is open in IST');
    UPDATE public.institutions SET timezone = 'Pacific/Kiritimati' WHERE id = v_inst;
    PERFORM pg_temp.chk(now() >= (SELECT w.booking_closes_at FROM public._ptm_window(v_ptm_book) w),
      'the same wall-clock times read in the school''s own timezone (UTC+14): closed');
    UPDATE public.institutions SET timezone = 'Asia/Kolkata' WHERE id = v_inst;
  ELSE
    PERFORM pg_temp.skip('cutoff and timezone checks', 'too close to midnight IST');
  END IF;

  -- ── 6. feedback ────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_teacher);
  v_ptm_fb := public.create_ptm_schedule(v_inst, 'Suite feedback', NULL, v_today, '00:00', '00:30', 15,
                                         ARRAY[v_class_a], 'teacher', 'class', NULL, NULL, false, 60, 3);
  v_ptm_old := public.create_ptm_schedule(v_inst, 'Suite old', NULL, v_today - 10, '10:00', '11:00', 15,
                                          ARRAY[v_class_a], 'teacher', 'class', NULL, NULL, false, 60, 3);
  PERFORM pg_temp.as_user(v_s1);
  v_js := public.submit_ptm_feedback(v_ptm_fb, 4, '  Good meeting  ', NULL, NULL, NULL);
  PERFORM public.submit_ptm_feedback(v_ptm_fb, 5, 'Changed my mind', v_ptm_fb || '/' || v_s1 || '/a.webm', 12, 'audio/webm');
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.ptm_feedback WHERE ptm_id = v_ptm_fb AND student_id = v_s1;
  SELECT rating || '/' || text_message || '/' || audio_duration_seconds INTO v_txt
    FROM public.ptm_feedback WHERE ptm_id = v_ptm_fb AND student_id = v_s1;
  PERFORM pg_temp.chk(v_n = 1 AND v_txt = '5/Changed my mind/12', 'a second submit updates the same row', v_txt);
  PERFORM pg_temp.as_user(v_s1);
  BEGIN PERFORM public.submit_ptm_feedback(v_ptm_fb, 3, NULL, v_ptm_fb || '/' || v_s2 || '/b.webm', 10, 'audio/webm'); v_state := 'saved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'a recording under another student''s folder is refused', v_state);
  BEGIN PERFORM public.submit_ptm_feedback(v_ptm_old, 3, NULL, NULL, NULL, NULL); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Feedback for this meeting has closed.', 'feedback closes after end + edit days', v_txt);
  BEGIN PERFORM public.submit_ptm_feedback(v_ptm_t, 3, NULL, NULL, NULL, NULL); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Feedback opens when the meeting starts.', 'feedback is not open before the start', v_txt);
  PERFORM pg_temp.as_user(v_s3);
  BEGIN PERFORM public.submit_ptm_feedback(v_ptm_fb, 3, NULL, NULL, NULL, NULL); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'This meeting is not for your class.', 'a student outside the classes cannot give feedback', v_txt);

  -- token: resolves only its own PTM, and only in scope
  PERFORM pg_temp.as_owner();
  SELECT feedback_token INTO v_tok FROM public.ptm_schedules WHERE id = v_ptm_fb;
  PERFORM pg_temp.as_user(v_s1);
  SELECT count(*), max(r.ptm_id::text), max(r.window_state), max((r.my_feedback->>'rating')) INTO v_n, v_txt, v_state, fn
    FROM public.ptm_resolve_feedback_token(v_tok) r;
  PERFORM pg_temp.chk(v_n = 1 AND v_txt = v_ptm_fb::text AND v_state = 'open' AND fn = '5',
    'the token resolves its own PTM with the student''s saved feedback', format('%s rows, %s, %s', v_n, v_state, fn));
  SELECT count(*) INTO v_n FROM public.ptm_open_for_feedback() o WHERE o.ptm_id = v_ptm_fb;
  PERFORM pg_temp.chk(v_n = 1, 'the permanent "active" route finds the open meeting');
  PERFORM pg_temp.as_user(v_s3);
  SELECT count(*) INTO v_n FROM public.ptm_resolve_feedback_token(v_tok);
  PERFORM pg_temp.chk(v_n = 0, 'a student outside scope gets nothing for the token (same as unknown)');
  SELECT count(*) INTO v_n FROM public.ptm_resolve_feedback_token('not-a-real-token');
  PERFORM pg_temp.chk(v_n = 0, 'an unknown token returns zero rows, no error');

  -- storage rules
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(public.ptm_audio_writable(v_s1, v_ptm_fb || '/' || v_s1 || '/x.webm'), 'a student may upload into their own folder');
  PERFORM pg_temp.chk(NOT public.ptm_audio_writable(v_s1, v_ptm_fb || '/' || v_s2 || '/x.webm'), 'not into another student''s folder');
  PERFORM pg_temp.chk(NOT public.ptm_audio_writable(v_s3, v_ptm_fb || '/' || v_s3 || '/x.webm'), 'not into a PTM that is not for their class');
  PERFORM pg_temp.chk(NOT public.ptm_audio_writable(v_s1, 'garbage'), 'a malformed name is refused, not an error');
  PERFORM pg_temp.chk(public.ptm_audio_readable(v_teacher, v_ptm_fb || '/' || v_s1 || '/a.webm'), 'a teacher of the class hears the class''s voice notes');
  PERFORM pg_temp.chk(public.ptm_audio_readable(v_coord, v_ptm_fb || '/' || v_s1 || '/a.webm'), 'the wing coordinator does too');
  PERFORM pg_temp.chk(NOT public.ptm_audio_readable(v_s2, v_ptm_fb || '/' || v_s1 || '/a.webm'), 'another student does not');

  -- ── 7. dashboard ───────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_teacher);
  v_js := public.ptm_feedback_summary(v_ptm_fb, 'teacher');
  PERFORM pg_temp.as_owner();
  SELECT count(DISTINCT ca.user_id) INTO v_n FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.class_id = v_class_a AND ca.role = 'student' AND p.is_active IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ca.user_id AND r.role = 'student');
  PERFORM pg_temp.chk((v_js->>'students_in_scope')::int = v_n AND (v_js->>'responses')::int = 1
                      AND jsonb_array_length(v_js->'per_class') = 1 AND (v_js->'distribution'->>'5')::int = 1,
    'summary under the teacher hat: one class, true denominator, one response', left(v_js::text, 160));
  PERFORM pg_temp.as_user(v_teacher);
  SELECT count(*), max(l.total_count) INTO v_n, v_m FROM public.ptm_feedback_list(v_ptm_fb, 'teacher', NULL, NULL, NULL, NULL, 'newest', 20, 0) l;
  PERFORM pg_temp.chk(v_n = 1 AND v_m = 1, 'list total_count matches the rows', format('%s rows, total %s', v_n, v_m));
  BEGIN PERFORM public.ptm_feedback_summary(v_ptm_fb, 'admin'); v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'a teacher cannot read the dashboard under the admin hat', v_state);

  -- ── 8. cancel ──────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_teacher);
  BEGIN PERFORM public.cancel_ptm_schedule(v_ptm_old, 'late'); v_txt := 'cancelled';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'This meeting has already happened.', 'nobody cancels a meeting that has ended', v_txt);
  PERFORM public.cancel_ptm_schedule(v_ptm_t, 'Rain');
  PERFORM pg_temp.as_owner();
  SELECT status || '/' || cancel_reason || '/' || (cancelled_by = v_teacher) INTO v_txt FROM public.ptm_schedules WHERE id = v_ptm_t;
  PERFORM pg_temp.chk(v_txt = 'cancelled/Rain/true', 'the creating teacher cancels, with reason and author kept', v_txt);
  PERFORM pg_temp.chk(NOT public.can_manage_ptm(v_teacher, v_ptm_t), 'a cancelled PTM can no longer be managed');

  -- ── 9. RLS on the new table ────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_s2);
  SELECT count(*) INTO v_n FROM public.ptm_feedback WHERE ptm_id = v_ptm_fb;
  PERFORM pg_temp.chk(v_n = 0, 'a student cannot read another student''s feedback row');
  BEGIN
    INSERT INTO public.ptm_feedback (ptm_id, student_id, class_id, rating) VALUES (v_ptm_fb, v_s2, v_class_a, 5);
    v_state := 'inserted';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'no direct INSERT into ptm_feedback', v_state);
  PERFORM pg_temp.as_user(v_teacher);
  SELECT count(*) INTO v_n FROM public.ptm_feedback WHERE ptm_id = v_ptm_fb;
  PERFORM pg_temp.chk(v_n = 1, 'a teacher of the class reads the class''s feedback rows');

  -- ── 10. a teacher acts on every class they teach (20260929170000) ─────────
  -- A real teacher of this school with only a SUBJECT row on a class that has
  -- students, and no subject-less row there: before the change this teacher
  -- had no PTM rights on it at all.
  PERFORM pg_temp.as_owner();
  SELECT ca.user_id, ca.class_id INTO v_teacher3, v_class_t3
    FROM public.class_assignments ca
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
    JOIN public.profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE AND p.institution_id = v_inst
   WHERE ca.role = 'teacher' AND ca.subject_id IS NOT NULL
     AND ca.user_id NOT IN (v_teacher, v_teacher2)
     AND public._ptm_has_hat(ca.user_id, v_inst, 'teacher')
     AND NOT public.is_institution_admin(ca.user_id, v_inst)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r2 WHERE r2.user_id = ca.user_id AND r2.role = 'coordinator')
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments x
                      WHERE x.user_id = ca.user_id AND x.class_id = ca.class_id
                        AND x.role = 'teacher' AND x.subject_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.class_assignments s
                  WHERE s.class_id = ca.class_id AND s.role = 'student'
                    AND public._ptm_student_class(s.user_id) = ca.class_id AND public.has_role(s.user_id, 'student'))
   ORDER BY ca.user_id, ca.class_id LIMIT 1;
  SELECT s.user_id INTO v_s4 FROM public.class_assignments s
   WHERE s.class_id = v_class_t3 AND s.role = 'student'
     AND public._ptm_student_class(s.user_id) = v_class_t3 AND public.has_role(s.user_id, 'student')
   ORDER BY s.user_id LIMIT 1;
  SELECT c.id INTO v_class_n FROM public.classes c
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments x
                      WHERE x.user_id = v_teacher3 AND x.class_id = c.id AND x.role = 'teacher')
   ORDER BY c.name, c.section LIMIT 1;

  IF v_teacher3 IS NULL OR v_s4 IS NULL OR v_class_n IS NULL THEN
    PERFORM pg_temp.skip('subject-row teacher checks', 'no subject-only teacher with students found at this school');
  ELSE
    PERFORM pg_temp.chk(public.is_class_teacher_of(v_teacher3, v_class_t3),
      'a teacher with only a subject row on the class counts', format('teacher=%s class=%s', v_teacher3, v_class_t3));
    PERFORM pg_temp.chk(NOT public.is_class_teacher_of(v_teacher3, v_class_n),
      'a class they have no teacher row on does not count');
    PERFORM pg_temp.chk(NOT public.is_class_teacher_of(v_s1, v_class_a),
      'a student row never counts as teaching the class');

    PERFORM pg_temp.as_user(v_teacher3);
    v_js := public.ptm_manageable_scope('teacher');
    PERFORM pg_temp.chk(v_js->'classes' @> jsonb_build_array(jsonb_build_object('id', v_class_t3))
                        AND NOT (v_js->'classes' @> jsonb_build_array(jsonb_build_object('id', v_class_n))),
      'the subject teacher''s scope lists the class they teach, not one they do not', left(v_js::text, 200));
    v_ptm_t3 := public.create_ptm_schedule(v_inst, 'Suite T3 subject', NULL, v_today + 3, '10:00', '12:00', 15,
                                           ARRAY[v_class_t3], 'teacher', 'class', NULL, NULL, true, 60, 3);
    PERFORM pg_temp.chk(v_ptm_t3 IS NOT NULL, 'the subject teacher schedules a PTM for that class');
    BEGIN
      PERFORM public.create_ptm_schedule(v_inst, 'Suite T3 other', NULL, v_today + 3, '10:00', '12:00', 15,
                                         ARRAY[v_class_n], 'teacher', 'class', NULL, NULL, false, 60, 3);
      v_state := 'created';
    EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
    END;
    PERFORM pg_temp.chk(v_state = '42501', 'but not for a class they do not teach', v_state);

    PERFORM pg_temp.as_user(v_s4);
    v_b3 := public.book_ptm_slot(v_ptm_t3, '10:00', false);
    PERFORM pg_temp.as_user(v_teacher3);
    SELECT count(*) FILTER (WHERE g.student_name IS NOT NULL) INTO v_n
      FROM public.ptm_booking_grid(v_ptm_t3, v_class_t3) g;
    PERFORM pg_temp.chk(v_b3 IS NOT NULL AND v_n = 1, 'the subject teacher sees the booked family''s name on the grid', format('%s named', v_n));
    PERFORM public.set_ptm_booking_attended(v_b3, true);
    PERFORM public.cancel_ptm_booking(v_b3);
    PERFORM pg_temp.as_owner();
    SELECT (attended IS TRUE) AND (cancelled_at IS NOT NULL) INTO v_state FROM public.ptm_bookings WHERE id = v_b3;
    PERFORM pg_temp.chk(v_state = 'true', 'the subject teacher marks attendance and cancels a family''s booking', v_state);
    PERFORM pg_temp.chk(public.can_manage_ptm(v_teacher3, v_ptm_t3) AND NOT public.can_manage_ptm(v_teacher3, v_ptm_t),
      'the subject teacher manages their own PTM, never another teacher''s');
    PERFORM pg_temp.chk(public.can_view_ptm_feedback(v_teacher3, v_ptm_t3, v_class_t3)
                        AND (public.can_view_ptm_feedback(v_teacher3, v_ptm_fb, v_class_a)
                             = public.is_class_teacher_of(v_teacher3, v_class_a)),
      'feedback visibility follows the classes the teacher teaches');
  END IF;
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
