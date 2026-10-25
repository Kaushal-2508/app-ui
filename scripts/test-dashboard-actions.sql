-- Dashboard action cards acceptance suite: my_dashboard_actions / _my_dashboard_actions
-- (migration 20261003120000). Uses real prod people and periods on a FUTURE working day
-- (nobody writes future-dated attendance, covers or holidays), pins the clock through the
-- private twin, then rolls everything back. Assertions RECORD instead of raising, so one
-- failure cannot hide the rest; counts that prod may already hold are checked as deltas.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-dashboard-actions.sql -OutFile "$env:TEMP\actions.json"
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
RETURNS void LANGUAGE plpgsql AS $skip$
BEGIN
  INSERT INTO t_out(result, label, detail) VALUES ('SKIP', p_label, p_detail);
END $skip$;

CREATE FUNCTION pg_temp.as_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $as$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $as$;

-- The school's wall clock on day d at time t, as the timestamptz the twin receives.
CREATE FUNCTION pg_temp.at_local(p_tz text, p_d date, p_t time)
RETURNS timestamptz LANGUAGE sql AS $at$ SELECT (p_d + p_t) AT TIME ZONE p_tz $at$;

CREATE FUNCTION pg_temp.no_cards(js jsonb)
RETURNS boolean LANGUAGE sql AS $nc$
  SELECT js->>'check_in' IS NULL AND js->>'cover' IS NULL AND js->>'leave' IS NULL AND js->>'check_out' IS NULL
$nc$;

DO $test$
DECLARE
  v_inst uuid; v_tz text; v_slot uuid; v_class uuid; v_t0 uuid; v_day text; v_ay text;
  v_start time; v_end time; v_label text; v_class_name text;
  v_admin uuid; v_teacher uuid; v_coord uuid; v_wing uuid; v_student uuid; v_other_student uuid;
  v_d date; v_e date; v_row uuid; v_txt text; v_js jsonb;
  v_t_students int; v_c_students int; v_a_staff int; v_c_staff int;
BEGIN
  -- ── 1. grants and source ───────────────────────────────────────────────
  PERFORM pg_temp.chk(to_regprocedure('public.my_dashboard_actions(text)') IS NOT NULL
                  AND to_regprocedure('public._my_dashboard_actions(uuid,text,timestamp with time zone)') IS NOT NULL,
    'both functions exist');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.my_dashboard_actions(text)', 'EXECUTE'),
    'anon cannot call my_dashboard_actions');
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.my_dashboard_actions(text)', 'EXECUTE'),
    'authenticated can call my_dashboard_actions');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public._my_dashboard_actions(uuid,text,timestamp with time zone)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._my_dashboard_actions(uuid,text,timestamp with time zone)', 'EXECUTE'),
    'nobody but the owner can call the twin');
  PERFORM pg_temp.chk(
    (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.my_dashboard_actions(text)'::regprocedure)
    AND NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public._my_dashboard_actions(uuid,text,timestamp with time zone)'::regprocedure),
    'the wrapper is SECURITY DEFINER, the twin is not');
  SELECT p.prosrc INTO v_txt FROM pg_proc p
   WHERE p.oid = 'public._my_dashboard_actions(uuid,text,timestamp with time zone)'::regprocedure;
  PERFORM pg_temp.chk(v_txt NOT ILIKE '%now()%' AND v_txt NOT ILIKE '%current_date%'
                  AND v_txt NOT ILIKE '%''UTC''%' AND v_txt NOT ILIKE '%auth.uid%',
    'the twin reads only the caller and clock it is given');

  -- ── fixture ────────────────────────────────────────────────────────────
  -- A timetabled period (between 09:00 and 15:00) in a school that has a plain school admin,
  -- a student in that class and a second plain teacher of that class; prefer a school with a
  -- plain coordinator who holds a wing there.
  SELECT s.id, s.institution_id, s.class_id, s.teacher_id, s.day, s.academic_year,
         ps.start_time, ps.end_time, ps.label, c.name, COALESCE(i.timezone, 'Asia/Kolkata')
    INTO v_slot, v_inst, v_class, v_t0, v_day, v_ay, v_start, v_end, v_label, v_class_name, v_tz
    FROM public.tt_slots s
    JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
    JOIN public.classes c ON c.id = s.class_id AND COALESCE(c.is_active, true)
    JOIN public.institutions i ON i.id = s.institution_id
   WHERE s.teacher_id IS NOT NULL
     AND s.slot_type NOT IN ('free', 'break')
     AND ps.start_time >= time '09:00' AND ps.end_time <= time '15:00'
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.institution_id = s.institution_id AND ur.role = 'school_admin'
                    AND NOT public.is_super_admin(ur.user_id)
                    AND public.get_user_institution(ur.user_id) = s.institution_id
                    AND NOT EXISTS (SELECT 1 FROM public.user_roles x
                                     WHERE x.user_id = ur.user_id AND x.role IN ('teacher', 'coordinator')))
     AND EXISTS (SELECT 1 FROM public.class_assignments st WHERE st.class_id = s.class_id AND st.role = 'student')
     AND EXISTS (SELECT 1 FROM public.class_assignments ta
                  WHERE ta.class_id = s.class_id AND ta.role = 'teacher' AND ta.user_id <> s.teacher_id
                    AND public.get_user_institution(ta.user_id) = s.institution_id
                    AND EXISTS (SELECT 1 FROM public.user_roles r
                                 WHERE r.user_id = ta.user_id AND r.institution_id = s.institution_id AND r.role = 'teacher')
                    AND NOT EXISTS (SELECT 1 FROM public.user_roles x
                                     WHERE x.user_id = ta.user_id
                                       AND x.role IN ('school_admin', 'super_school_admin', 'coordinator', 'super_admin')))
   ORDER BY EXISTS (SELECT 1 FROM public.user_roles ur
                      JOIN public.wing_assignments wa ON wa.user_id = ur.user_id
                      JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = s.institution_id
                     WHERE ur.institution_id = s.institution_id AND ur.role = 'coordinator'
                       AND NOT EXISTS (SELECT 1 FROM public.user_roles x
                                        WHERE x.user_id = ur.user_id
                                          AND x.role IN ('teacher', 'school_admin', 'super_school_admin', 'super_admin'))) DESC,
            s.id
   LIMIT 1;

  IF v_slot IS NULL THEN
    PERFORM pg_temp.skip('fixture', 'no school has a plain admin, a timetabled period and a second plain teacher');
    RETURN;
  END IF;

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
   WHERE ur.institution_id = v_inst AND ur.role = 'school_admin'
     AND NOT public.is_super_admin(ur.user_id)
     AND public.get_user_institution(ur.user_id) = v_inst
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role IN ('teacher', 'coordinator'))
   ORDER BY ur.user_id LIMIT 1;
  SELECT ta.user_id INTO v_teacher FROM public.class_assignments ta
   WHERE ta.class_id = v_class AND ta.role = 'teacher' AND ta.user_id <> v_t0
     AND public.get_user_institution(ta.user_id) = v_inst
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ta.user_id AND r.institution_id = v_inst AND r.role = 'teacher')
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ta.user_id
                      AND x.role IN ('school_admin', 'super_school_admin', 'coordinator', 'super_admin'))
   ORDER BY ta.user_id LIMIT 1;
  SELECT st.user_id INTO v_student FROM public.class_assignments st
   WHERE st.class_id = v_class AND st.role = 'student' ORDER BY st.user_id LIMIT 1;
  SELECT ur.user_id INTO v_other_student FROM public.user_roles ur
   WHERE ur.institution_id = v_inst AND ur.role = 'student' AND NOT public.student_in_class(ur.user_id, v_class)
   ORDER BY ur.user_id LIMIT 1;
  SELECT ur.user_id, wa.wing_id INTO v_coord, v_wing
    FROM public.user_roles ur
    JOIN public.wing_assignments wa ON wa.user_id = ur.user_id
    JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst
   WHERE ur.institution_id = v_inst AND ur.role = 'coordinator'
     AND public.get_user_institution(ur.user_id) = v_inst
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id
                      AND x.role IN ('teacher', 'school_admin', 'super_school_admin', 'super_admin'))
   ORDER BY ur.user_id, wa.wing_id LIMIT 1;

  -- The test day: the first working day after today that falls on the period's weekday.
  SELECT d INTO v_d
    FROM public._staff_leave_workdays(v_inst, (now() AT TIME ZONE v_tz)::date + 1, (now() AT TIME ZONE v_tz)::date + 21) AS d
   WHERE public.tt_dow_to_text(d) = v_day
   ORDER BY d LIMIT 1;

  PERFORM pg_temp.chk(v_admin IS NOT NULL AND v_teacher IS NOT NULL AND v_student IS NOT NULL AND v_d IS NOT NULL,
    'fixture found', format('inst=%s day=%s period=%s %s-%s class=%s admin=%s teacher=%s coord=%s student=%s',
      v_inst, v_d, v_label, v_start, v_end, v_class_name, v_admin, v_teacher, v_coord, v_student));
  IF v_admin IS NULL OR v_teacher IS NULL OR v_student IS NULL OR v_d IS NULL THEN
    RETURN;
  END IF;

  -- Known settings for the school (rolled back): 08:00 to 16:00, 30 minutes of grace.
  INSERT INTO public.attendance_settings (institution_id, staff_check_in_time, staff_check_out_time,
                                          staff_late_check_in_allowed, staff_late_grace_minutes)
  VALUES (v_inst, time '08:00', time '16:00', true, 30)
  ON CONFLICT (institution_id) DO UPDATE
    SET staff_check_in_time = EXCLUDED.staff_check_in_time,
        staff_check_out_time = EXCLUDED.staff_check_out_time,
        staff_late_check_in_allowed = EXCLUDED.staff_late_check_in_allowed,
        staff_late_grace_minutes = EXCLUDED.staff_late_grace_minutes;

  -- Clean slate on the test day (an approved leave may already have written on_leave rows).
  DELETE FROM public.staff_attendance_records WHERE institution_id = v_inst AND date = v_d;
  DELETE FROM public.tt_substitutions t USING public.tt_slots s
   WHERE s.id = t.slot_id AND s.institution_id = v_inst AND t.date = v_d;

  -- ── 2. view resolution: p_view can only narrow ─────────────────────────
  v_js := public._my_dashboard_actions(v_teacher, 'admin', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->>'view' = 'teacher', 'a teacher asking for the admin view gets the teacher view', v_js->>'view');
  v_js := public._my_dashboard_actions(v_admin, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->>'view' = 'admin', 'an admin who does not teach gets the admin view', v_js->>'view');
  IF v_coord IS NOT NULL THEN
    v_js := public._my_dashboard_actions(v_coord, NULL, pg_temp.at_local(v_tz, v_d, time '07:00'));
    PERFORM pg_temp.chk(v_js->>'view' = 'coordinator', 'a coordinator with no view asked gets the coordinator view', v_js->>'view');
    v_js := public._my_dashboard_actions(v_coord, 'admin', pg_temp.at_local(v_tz, v_d, time '07:00'));
    PERFORM pg_temp.chk(v_js->>'view' = 'coordinator', 'a coordinator asking for the admin view stays coordinator', v_js->>'view');
  ELSE
    PERFORM pg_temp.skip('coordinator view resolution', 'no plain coordinator with a wing in the fixture school');
  END IF;

  -- ── 3. empty answers ───────────────────────────────────────────────────
  v_js := public._my_dashboard_actions(NULL, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(pg_temp.no_cards(v_js) AND v_js->>'view' IS NULL, 'no caller: no cards', v_js::text);
  v_js := public._my_dashboard_actions(v_student, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(pg_temp.no_cards(v_js) AND v_js->>'view' IS NULL, 'a student: no cards', v_js::text);
  -- Prod's only super admin has no school, which would short-circuit before the super-admin
  -- test; give the plain admin (who has one) the role for a moment instead (rolled back).
  INSERT INTO public.user_roles (user_id, role, institution_id) VALUES (v_admin, 'super_admin', NULL);
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(pg_temp.no_cards(v_js) AND v_js->>'view' IS NULL, 'a super admin who has a school: no cards', v_js::text);
  DELETE FROM public.user_roles WHERE user_id = v_admin AND role = 'super_admin';

  -- ── 4. check-in and check-out ──────────────────────────────────────────
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'state' = 'due' AND v_js->'check_in'->>'by' = '08:00'
                  AND v_js->'check_in'->>'until' = '16:00',
    'no row before check-in time: due, by 08:00, until 16:00', v_js->>'check_in');
  PERFORM pg_temp.chk(v_js->>'date' = to_char(v_d, 'YYYY-MM-DD'), 'the answer carries the school''s date', v_js->>'date');
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int = 32400, 'refresh lands on check-out time, nine hours away', v_js->>'refresh_in_s');
  PERFORM pg_temp.chk(v_js->>'cover' IS NULL, 'teacher view before any check-in: no cover', v_js::text);
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '00:30'));
  PERFORM pg_temp.chk(v_js->>'date' = to_char(v_d, 'YYYY-MM-DD'),
    'just after the school''s midnight (still the previous UTC day): the school''s date', v_js->>'date');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '10:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'state' = 'due', 'still due when late', v_js->>'check_in');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '16:00'));
  PERFORM pg_temp.chk(v_js->>'check_in' IS NULL, 'gone at check-out time', v_js->>'check_in');

  INSERT INTO public.staff_attendance_records (institution_id, staff_id, date, status, auto_marked_absent)
  VALUES (v_inst, v_teacher, v_d, 'absent', true) RETURNING id INTO v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'state' = 'absent', 'auto-marked absent: the card says so', v_js->>'check_in');
  UPDATE public.staff_attendance_records SET auto_marked_absent = false WHERE id = v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'state' = 'absent', 'admin-marked absent: the same card', v_js->>'check_in');
  UPDATE public.staff_attendance_records SET status = 'on_leave' WHERE id = v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk(v_js->>'check_in' IS NULL AND v_js->>'check_out' IS NULL, 'on leave: no check-in, no check-out', v_js::text);

  UPDATE public.staff_attendance_records
     SET status = 'present', check_in_at = pg_temp.at_local(v_tz, v_d, time '08:05')
   WHERE id = v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '15:59'));
  PERFORM pg_temp.chk(v_js->>'check_in' IS NULL AND v_js->>'check_out' IS NULL, 'checked in, before check-out time: nothing', v_js::text);
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int = 60, 'checked in: refresh lands on check-out time', v_js->>'refresh_in_s');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '16:00'));
  PERFORM pg_temp.chk(v_js->'check_out'->>'record_id' = v_row::text AND v_js->'check_out'->>'since' = '16:00',
    'at check-out time: a check-out card for today''s row', v_js->>'check_out');
  UPDATE public.staff_attendance_records SET check_out_at = pg_temp.at_local(v_tz, v_d, time '16:10') WHERE id = v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '16:20'));
  PERFORM pg_temp.chk(v_js->>'check_out' IS NULL, 'checked out: the card is gone', v_js->>'check_out');
  DELETE FROM public.staff_attendance_records WHERE id = v_row;

  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '23:30'));
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int = 1800, 'late evening: refresh at the school''s midnight', v_js->>'refresh_in_s');

  INSERT INTO public.cal_events (institution_id, academic_year, title, kind, starts_on, ends_on)
  VALUES (v_inst, v_ay, 'Action cards test holiday', 'holiday', v_d, v_d);
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->>'check_in' IS NULL, 'holiday: no check-in card', v_js->>'check_in');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS FALSE, 'holiday: the attendance pass is not due', v_js->>'pass_due');
  DELETE FROM public.cal_events WHERE institution_id = v_inst AND title = 'Action cards test holiday';

  SELECT g::date INTO v_e
    FROM generate_series((now() AT TIME ZONE v_tz)::date + 1, (now() AT TIME ZONE v_tz)::date + 14, interval '1 day') AS g
   WHERE NOT EXISTS (SELECT 1 FROM public._staff_leave_workdays(v_inst, g::date, g::date))
   ORDER BY 1 LIMIT 1;
  IF v_e IS NULL THEN
    PERFORM pg_temp.skip('non-working day: no check-in card', 'the school works every day of the next two weeks');
  ELSE
    v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_e, time '07:00'));
    PERFORM pg_temp.chk(v_js->>'check_in' IS NULL, 'non-working day: no check-in card', format('%s %s', v_e, v_js->>'check_in'));
  END IF;

  -- ── 5. pass_due ────────────────────────────────────────────────────────
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '08:29'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS FALSE, 'before check-in time + grace: pass not due', v_js->>'pass_due');
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int = 60, 'admin before the cutoff: refresh lands on the cutoff', v_js->>'refresh_in_s');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '08:31'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS TRUE, 'after check-in time + grace: pass due for the admin view', v_js->>'pass_due');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '08:31'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS FALSE, 'teacher view after the cutoff: the pass is never due', v_js->>'pass_due');
  IF v_coord IS NOT NULL THEN
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, time '08:31'));
    PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS TRUE, 'coordinator view after the cutoff: the pass is due', v_js->>'pass_due');
  END IF;

  -- ── 6. cover ───────────────────────────────────────────────────────────
  INSERT INTO public.tt_substitutions (slot_id, date, original_teacher_id, status, source)
  VALUES (v_slot, v_d, v_t0, 'pending', 'auto');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
  PERFORM pg_temp.chk(v_js->>'cover' IS NULL, 'no staff check-in that day: no cover card', v_js->>'cover');

  INSERT INTO public.staff_attendance_records (institution_id, staff_id, date, check_in_at, status)
  VALUES (v_inst, v_admin, v_d, pg_temp.at_local(v_tz, v_d, time '07:55'), 'present');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
  PERFORM pg_temp.chk((v_js->'cover'->>'pending')::int = 1
                  AND v_js->'cover'->'next'->>'label' = v_label
                  AND v_js->'cover'->'next'->>'class_name' = v_class_name
                  AND v_js->'cover'->'next'->>'start' = to_char(v_start, 'HH24:MI'),
    'admin: the pending period, with its label, class and start', v_js->>'cover');
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int <= extract(epoch FROM (v_end - (v_start - interval '1 minute')))::int,
    'refresh no later than the open period''s end', v_js->>'refresh_in_s');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, v_end));
  PERFORM pg_temp.chk(v_js->>'cover' IS NULL, 'the period is over: no longer counted', v_js->>'cover');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
  PERFORM pg_temp.chk(v_js->>'cover' IS NULL, 'teacher view: never a cover card', v_js->>'cover');

  IF v_coord IS NOT NULL THEN
    INSERT INTO public.wing_class_mappings (wing_id, class_id) VALUES (v_wing, v_class)
    ON CONFLICT (wing_id, class_id) DO NOTHING;
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk((v_js->'cover'->>'pending')::int = 1, 'coordinator: a pending period in their wing counts', v_js->>'cover');
  ELSE
    PERFORM pg_temp.skip('coordinator cover', 'no plain coordinator with a wing in the fixture school');
  END IF;

  -- ── 7. leave (deltas: prod may already hold pending requests) ──────────
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  v_t_students := COALESCE((v_js->'leave'->>'students')::int, 0);
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '09:00'));
  v_a_staff := COALESCE((v_js->'leave'->>'staff')::int, 0);
  IF v_coord IS NOT NULL THEN
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, time '09:00'));
    v_c_students := COALESCE((v_js->'leave'->>'students')::int, 0);
    v_c_staff := COALESCE((v_js->'leave'->>'staff')::int, 0);
  END IF;

  INSERT INTO public.leave_requests (institution_id, student_id, class_id, leave_type, start_date, end_date,
                                     reason, status, source, created_at)
  VALUES (v_inst, v_student, v_class, 'sick', v_d, v_d, 'action cards test', 'pending', 'student',
          pg_temp.at_local(v_tz, v_d, time '09:00') - interval '3 days');
  IF v_other_student IS NOT NULL THEN
    -- a request filed against this class by a student who is not (or no longer) in it
    INSERT INTO public.leave_requests (institution_id, student_id, class_id, leave_type, start_date, end_date,
                                       reason, status, source)
    VALUES (v_inst, v_other_student, v_class, 'sick', v_d, v_d, 'action cards test stranded', 'pending', 'student');
  END IF;
  INSERT INTO public.staff_leave_requests (institution_id, user_id, leave_type, start_date, end_date, reason, status)
  VALUES (v_inst, v_teacher, 'casual', v_d, v_d, 'action cards test', 'pending'),
         (v_inst, v_admin, 'casual', v_d, v_d, 'action cards test own', 'pending');

  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk((v_js->'leave'->>'students')::int = v_t_students + 1,
    'teacher: their section''s pending leave counts once; a stranded request does not',
    format('%s -> %s', v_t_students, v_js->>'leave'));
  PERFORM pg_temp.chk((v_js->'leave'->>'oldest_days')::int >= 3, 'oldest waiting covers the request filed 3 days ago', v_js->>'leave');
  PERFORM pg_temp.chk((v_js->'leave'->>'staff')::int = 0, 'teacher: never staff leave', v_js->>'leave');

  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk(COALESCE((v_js->'leave'->>'students')::int, 0) = 0, 'admin: never student leave (owner, 2026-10-03)', v_js->>'leave');
  PERFORM pg_temp.chk((v_js->'leave'->>'staff')::int = v_a_staff + 1,
    'admin: a teacher''s pending leave counts, their own does not', format('%s -> %s', v_a_staff, v_js->>'leave'));

  IF v_coord IS NOT NULL THEN
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, time '09:00'));
    PERFORM pg_temp.chk((v_js->'leave'->>'students')::int = v_c_students + 1,
      'coordinator: their wing''s pending student leave counts', format('%s -> %s', v_c_students, v_js->>'leave'));
    PERFORM pg_temp.chk((v_js->'leave'->>'staff')::int = v_c_staff + 1,
      'coordinator: a wing teacher''s leave counts, an admin''s does not', format('%s -> %s', v_c_staff, v_js->>'leave'));

    -- Dual roles are never unioned (§25): the wing coordinator also teaches (rolled back).
    INSERT INTO public.user_roles (user_id, role, institution_id) VALUES (v_coord, 'teacher', v_inst);
    v_js := public._my_dashboard_actions(v_coord, NULL, pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk(v_js->>'view' = 'teacher', 'teacher+coordinator: the default view is teacher', v_js->>'view');
    v_js := public._my_dashboard_actions(v_coord, 'teacher', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk(v_js->>'cover' IS NULL AND COALESCE((v_js->'leave'->>'staff')::int, 0) = 0
                    AND (v_js->>'pass_due')::boolean IS FALSE,
      'teacher+coordinator in the teacher view: no wing cover, no staff leave, no pass kick', v_js::text);
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk(v_js->>'view' = 'coordinator' AND (v_js->'cover'->>'pending')::int = 1
                    AND (v_js->'leave'->>'staff')::int = v_c_staff + 1,
      'teacher+coordinator in the coordinator view: the wing scope', v_js::text);
    DELETE FROM public.user_roles WHERE user_id = v_coord AND role = 'teacher' AND institution_id = v_inst;

    -- An admin who also coordinates: the coordinator view's staff leave is the wing rung only.
    INSERT INTO public.user_roles (user_id, role, institution_id) VALUES (v_coord, 'school_admin', v_inst);
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, time '09:00'));
    PERFORM pg_temp.chk(v_js->>'view' = 'coordinator' AND (v_js->'leave'->>'staff')::int = v_c_staff + 1,
      'admin+coordinator in the coordinator view: wing staff leave only, never the whole school', v_js::text);
    DELETE FROM public.user_roles WHERE user_id = v_coord AND role = 'school_admin' AND institution_id = v_inst;

    DELETE FROM public.wing_assignments WHERE user_id = v_coord;
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk(v_js->>'cover' IS NULL AND COALESCE((v_js->'leave'->>'students')::int, 0) = 0
                    AND COALESCE((v_js->'leave'->>'staff')::int, 0) = 0,
      'a coordinator with no wing: no cover, no leave (never the whole school)', v_js::text);
  ELSE
    PERFORM pg_temp.skip('coordinator leave', 'no plain coordinator with a wing in the fixture school');
  END IF;

  -- ── 8. no settings row: the client defaults, and the pass would do nothing ─
  DELETE FROM public.attendance_settings WHERE institution_id = v_inst;
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '08:31'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS FALSE, 'no settings row: pass not due', v_js->>'pass_due');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'by' = '08:00' AND v_js->'check_in'->>'until' = '16:00',
    'no settings row: 08:00 to 16:00, the client defaults', v_js->>'check_in');

  -- ── 9. the public wrapper, as the signed-in user (LAST: it switches role) ─
  PERFORM pg_temp.as_user(v_teacher);
  v_js := public.my_dashboard_actions('admin');
  PERFORM pg_temp.chk(v_js->>'view' = 'teacher', 'wrapper: the caller comes from the JWT and the view cannot widen', v_js->>'view');
  PERFORM pg_temp.as_user(v_student);
  v_js := public.my_dashboard_actions(NULL);
  PERFORM pg_temp.chk(v_js->>'view' IS NULL AND pg_temp.no_cards(v_js), 'wrapper: a student gets the empty answer', v_js::text);
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
