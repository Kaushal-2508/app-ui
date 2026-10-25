-- save_class_attendance / review_student_leave acceptance suite.
-- Runs as a real teacher against real prod rows, then rolls everything back.
-- Assertions RECORD instead of raising, so one failure cannot hide the rest.
BEGIN;

CREATE TEMP TABLE t_out(n serial, result text, label text, detail text);

CREATE FUNCTION pg_temp.chk(p_pass boolean, p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $chk$
BEGIN
  INSERT INTO t_out(result, label, detail)
  VALUES (CASE WHEN coalesce(p_pass, false) THEN 'PASS' ELSE 'FAIL' END, p_label, p_detail);
END $chk$;

DO $test$
DECLARE
  v_teacher uuid; v_class uuid; v_inst uuid; v_tz text; v_today date;
  v_s1 uuid; v_s2 uuid; v_outsider uuid; v_stranger uuid;
  v_res jsonb; v_status text; v_remarks text; v_marked uuid;
  v_lv public.leave_requests%ROWTYPE; v_req_id uuid; v_n int; v_err text;
BEGIN
  -- ── fixture: a PLAIN teacher (no admin bypass) with a 2+ student class ────
  SELECT ca.user_id, ca.class_id INTO v_teacher, v_class
  FROM public.class_assignments ca
  JOIN public.classes c ON c.id = ca.class_id
  WHERE ca.role = 'teacher'
    AND (SELECT count(*) FROM public.class_assignments s
          WHERE s.class_id = ca.class_id AND s.role = 'student') >= 2
    AND NOT public.is_super_admin(ca.user_id)
    AND NOT public.is_institution_admin(ca.user_id, c.institution_id)
  LIMIT 1;

  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = v_class;
  SELECT i.timezone INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT user_id INTO v_s1 FROM public.class_assignments
   WHERE class_id = v_class AND role = 'student' ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_s2 FROM public.class_assignments
   WHERE class_id = v_class AND role = 'student' AND user_id <> v_s1 ORDER BY user_id LIMIT 1;
  SELECT ur.user_id INTO v_outsider FROM public.user_roles ur
   WHERE ur.role = 'student'
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments ca
                      WHERE ca.user_id = ur.user_id AND ca.class_id = v_class AND ca.role='student')
   LIMIT 1;
  SELECT ur.user_id INTO v_stranger FROM public.user_roles ur
   WHERE ur.role = 'teacher'
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments ca
                      WHERE ca.user_id = ur.user_id AND ca.class_id = v_class AND ca.role='teacher')
     AND NOT public.is_institution_admin(ur.user_id, v_inst)
     AND NOT public.is_super_admin(ur.user_id)
   LIMIT 1;

  PERFORM pg_temp.chk(v_teacher IS NOT NULL AND v_s1 IS NOT NULL AND v_s2 IS NOT NULL,
    'fixture resolved',
    format('teacher=%s class=%s date=%s', v_teacher, v_class, v_today));

  -- Deterministic start (rolled back with everything else).
  DELETE FROM public.attendance_records WHERE class_id = v_class AND date >= v_today - 40;
  DELETE FROM public.leave_requests WHERE class_id = v_class AND end_date >= v_today - 40;

  -- ── 1. leave + absent in one save ────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s1, 'status','leave', 'leave_type','sick', 'reason','Fever, parent called'),
    jsonb_build_object('student_id', v_s2, 'status','absent')));
  RESET ROLE;

  PERFORM pg_temp.chk((v_res->>'marked')::int = 2, 'save marks every row', v_res::text);
  PERFORM pg_temp.chk((v_res->>'leaves_created')::int = 1, 'one leave record created', v_res::text);

  SELECT status, remarks, marked_by INTO v_status, v_remarks, v_marked
    FROM public.attendance_records WHERE class_id=v_class AND student_id=v_s1 AND date=v_today;
  PERFORM pg_temp.chk(v_status = 'leave', 'attendance status is leave', coalesce(v_status,'null'));
  PERFORM pg_temp.chk(v_remarks = 'Leave marked by teacher', 'teacher-leave remark stamped', coalesce(v_remarks,'null'));
  PERFORM pg_temp.chk(v_marked = v_teacher, 'roster save owns the row', coalesce(v_marked::text,'null'));

  SELECT status INTO v_status FROM public.attendance_records
   WHERE class_id=v_class AND student_id=v_s2 AND date=v_today;
  PERFORM pg_temp.chk(v_status = 'absent', 'absent row written', coalesce(v_status,'null'));

  SELECT * INTO v_lv FROM public.leave_requests
   WHERE student_id=v_s1 AND start_date=v_today AND end_date=v_today;
  PERFORM pg_temp.chk(v_lv.id IS NOT NULL, 'leave_requests row exists');
  PERFORM pg_temp.chk(v_lv.status='approved' AND v_lv.source='staff' AND v_lv.reviewed_by=v_teacher,
    'born approved, source=staff, reviewer recorded',
    format('status=%s source=%s reviewed_by=%s', v_lv.status, v_lv.source, v_lv.reviewed_by));
  PERFORM pg_temp.chk(v_lv.leave_type='sick' AND v_lv.reason='Fever, parent called' AND v_lv.institution_id=v_inst,
    'type / reason / institution carried through',
    format('%s | %s', v_lv.leave_type, v_lv.reason));

  SELECT count(*) INTO v_n FROM public.notifications
   WHERE user_id=v_s1 AND type='leave_decision' AND title='Marked on leave'
     AND created_at > now() - interval '2 minutes';
  PERFORM pg_temp.chk(v_n >= 1, 'student notified', format('%s notification(s)', v_n));

  -- ── 2. idempotent re-save ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s1, 'status','leave', 'leave_type','sick', 'reason','Fever, parent called')));
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.leave_requests
   WHERE student_id=v_s1 AND start_date=v_today AND end_date=v_today;
  PERFORM pg_temp.chk((v_res->>'leaves_created')::int = 0 AND v_n = 1,
    'double-save creates no duplicate leave', format('created=%s rows=%s', v_res->>'leaves_created', v_n));

  -- ── 3. flipping off leave withdraws the teacher-marked record ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s1, 'status','present')));
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.leave_requests
   WHERE student_id=v_s1 AND start_date=v_today AND end_date=v_today;
  SELECT status, remarks INTO v_status, v_remarks FROM public.attendance_records
   WHERE class_id=v_class AND student_id=v_s1 AND date=v_today;
  PERFORM pg_temp.chk((v_res->>'leaves_withdrawn')::int = 1 AND v_n = 0,
    'flip to present withdraws the leave', format('withdrawn=%s rows=%s', v_res->>'leaves_withdrawn', v_n));
  PERFORM pg_temp.chk(v_status='present' AND v_remarks IS NULL,
    'stale leave remark cleared', format('status=%s remarks=%s', v_status, coalesce(v_remarks,'null')));

  -- ── 4. a student's OWN application is never withdrawn by a flip ──────────
  INSERT INTO public.leave_requests
    (institution_id, student_id, class_id, leave_type, start_date, end_date, reason, status, source, reviewed_by, reviewed_at)
  VALUES (v_inst, v_s2, v_class, 'family', v_today, v_today, 'Wedding', 'approved', 'student', v_teacher, now());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s2, 'status','absent')));
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.leave_requests
   WHERE student_id=v_s2 AND source='student' AND start_date=v_today;
  PERFORM pg_temp.chk((v_res->>'leaves_withdrawn')::int = 0 AND v_n = 1,
    'student application survives the flip', format('withdrawn=%s rows=%s', v_res->>'leaves_withdrawn', v_n));

  -- ── 5. an approved application covering the day is reused, not duplicated,
  --       and NOT rewritten - the teacher is told it was kept ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s2, 'status','leave', 'leave_type','other', 'reason','x')));
  RESET ROLE;
  SELECT leave_type, reason INTO v_status, v_remarks FROM public.leave_requests
   WHERE student_id=v_s2 AND source='student' AND start_date=v_today;
  PERFORM pg_temp.chk((v_res->>'leaves_created')::int = 0,
    'existing approved leave reused', v_res::text);
  PERFORM pg_temp.chk(v_status='family' AND v_remarks='Wedding',
    'a student application is never rewritten', format('%s | %s', v_status, v_remarks));
  PERFORM pg_temp.chk((v_res->>'leaves_kept')::int = 1,
    'kept-as-is is reported back to the caller', v_res::text);

  -- ── 5b. correcting a leave THIS screen created does land ────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s1, 'status','leave', 'leave_type','sick', 'reason','Fever')));
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s1, 'status','leave', 'leave_type','family', 'reason','Family function')));
  RESET ROLE;
  SELECT leave_type, reason INTO v_status, v_remarks FROM public.leave_requests
   WHERE student_id=v_s1 AND source='staff' AND start_date=v_today AND end_date=v_today;
  PERFORM pg_temp.chk(v_status='family' AND v_remarks='Family function',
    're-typed type and reason overwrite the teacher''s own leave',
    format('%s | %s', coalesce(v_status,'null'), coalesce(v_remarks,'null')));
  PERFORM pg_temp.chk((v_res->>'leaves_updated')::int = 1 AND (v_res->>'leaves_created')::int = 0,
    'the correction is reported as an update, not a new leave', v_res::text);
  SELECT count(*) INTO v_n FROM public.leave_requests
   WHERE student_id=v_s1 AND start_date=v_today AND end_date=v_today;
  PERFORM pg_temp.chk(v_n = 1, 'correcting does not stack a second leave', format('%s row(s)', v_n));

  -- reset s1 for the checks that follow
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s1, 'status','present')));
  RESET ROLE;

  -- ── 6. a student outside the class is rejected ───────────────────────────
  IF v_outsider IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
        jsonb_build_object('student_id', v_outsider, 'status','absent')));
      RESET ROLE;
      PERFORM pg_temp.chk(false, 'out-of-class student rejected', 'ACCEPTED');
    EXCEPTION WHEN sqlstate '42501' THEN
      RESET ROLE;
      PERFORM pg_temp.chk(true, 'out-of-class student rejected', SQLERRM);
    END;
  END IF;

  -- ── 7. a teacher not assigned to the class is rejected ───────────────────
  IF v_stranger IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
        jsonb_build_object('student_id', v_s1, 'status','absent')));
      RESET ROLE;
      PERFORM pg_temp.chk(false, 'unassigned teacher rejected', 'ACCEPTED');
    EXCEPTION WHEN sqlstate '42501' THEN
      RESET ROLE;
      PERFORM pg_temp.chk(true, 'unassigned teacher rejected', SQLERRM);
    END;
  END IF;

  -- ── 8. the roster cannot write holiday / sick / casual ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
      jsonb_build_object('student_id', v_s1, 'status','holiday')));
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'roster limited to present/absent/leave', 'holiday ACCEPTED');
  EXCEPTION WHEN sqlstate '22023' THEN
    RESET ROLE;
    PERFORM pg_temp.chk(true, 'roster limited to present/absent/leave', SQLERRM);
  END;

  -- ── 9. the edit window still bites an ordinary roster save ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_res := public.save_class_attendance(v_class, v_today - 30, jsonb_build_array(
      jsonb_build_object('student_id', v_s1, 'status','absent')));
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'edit window enforced for the roster', 'OLD DATE ACCEPTED');
  EXCEPTION WHEN others THEN
    RESET ROLE;
    v_err := SQLERRM;
    PERFORM pg_temp.chk(v_err LIKE '%older than%', 'edit window enforced for the roster', v_err);
  END;

  -- ── 10. future-dated approval now works, writes leave, claims no marker ──
  INSERT INTO public.leave_requests
    (institution_id, student_id, class_id, leave_type, start_date, end_date, reason, status, source)
  VALUES (v_inst, v_s1, v_class, 'family', v_today + 3, v_today + 4, 'Trip', 'pending', 'student')
  RETURNING id INTO v_req_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_res := public.review_student_leave(v_req_id, 'approved', NULL);
    RESET ROLE;
    SELECT status, marked_by INTO v_status, v_marked FROM public.attendance_records
     WHERE class_id=v_class AND student_id=v_s1 AND date=v_today + 3;
    PERFORM pg_temp.chk((v_res->>'dates_marked')::int >= 1, 'future-dated approval succeeds', v_res::text);
    PERFORM pg_temp.chk(v_status = 'leave', 'approved leave writes leave', coalesce(v_status,'null'));
    PERFORM pg_temp.chk(v_marked IS NULL, 'approval does not claim the class-day', coalesce(v_marked::text,'null'));
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'future-dated approval succeeds', SQLERRM);
  END;

  -- ── 11. the leave exemption does not leak to a later roster save ─────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_res := public.save_class_attendance(v_class, v_today - 30, jsonb_build_array(
      jsonb_build_object('student_id', v_s2, 'status','absent')));
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'leave exemption does not leak', 'OLD DATE ACCEPTED AFTER APPROVAL');
  EXCEPTION WHEN others THEN
    RESET ROLE;
    v_err := SQLERRM;
    PERFORM pg_temp.chk(v_err LIKE '%older than%', 'leave exemption does not leak', v_err);
  END;

  -- ── 12. retroactive approval (older than the window) now works ───────────
  INSERT INTO public.leave_requests
    (institution_id, student_id, class_id, leave_type, start_date, end_date, reason, status, source)
  VALUES (v_inst, v_s2, v_class, 'sick', v_today - 20, v_today - 20, 'Was ill', 'pending', 'student')
  RETURNING id INTO v_req_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_res := public.review_student_leave(v_req_id, 'approved', NULL);
    RESET ROLE;
    SELECT status INTO v_status FROM public.attendance_records
     WHERE class_id=v_class AND student_id=v_s2 AND date=v_today - 20;
    PERFORM pg_temp.chk(v_status = 'leave', 'retroactive approval succeeds', format('%s | %s', coalesce(v_status,'null'), v_res::text));
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'retroactive approval succeeds', SQLERRM);
  END;

  -- ── 13. a rejection still writes absent ──────────────────────────────────
  INSERT INTO public.leave_requests
    (institution_id, student_id, class_id, leave_type, start_date, end_date, reason, status, source)
  VALUES (v_inst, v_s1, v_class, 'other', v_today - 1, v_today - 1, 'No reason', 'pending', 'student')
  RETURNING id INTO v_req_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_res := public.review_student_leave(v_req_id, 'rejected', NULL);
    RESET ROLE;
    SELECT status INTO v_status FROM public.attendance_records
     WHERE class_id=v_class AND student_id=v_s1 AND date=v_today - 1;
    PERFORM pg_temp.chk(v_status = 'absent', 'rejection writes absent', coalesce(v_status,'null'));
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'rejection writes absent', SQLERRM);
  END;

  -- ── 13b. rejecting a FUTURE leave leaves those days unmarked ────────────
  --        ("not on leave" is not "absent", and notify_student_absent would
  --         have told the student they were absent on a date not yet reached)
  DELETE FROM public.attendance_records
   WHERE class_id=v_class AND student_id=v_s2 AND date IN (v_today + 5, v_today + 6);
  INSERT INTO public.leave_requests
    (institution_id, student_id, class_id, leave_type, start_date, end_date, reason, status, source)
  VALUES (v_inst, v_s2, v_class, 'other', v_today + 5, v_today + 6, 'Trip', 'pending', 'student')
  RETURNING id INTO v_req_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_res := public.review_student_leave(v_req_id, 'rejected', NULL);
    RESET ROLE;
    SELECT count(*) INTO v_n FROM public.attendance_records
     WHERE class_id=v_class AND student_id=v_s2 AND date IN (v_today + 5, v_today + 6);
    PERFORM pg_temp.chk(v_n = 0 AND (v_res->>'dates_deferred')::int = 2 AND (v_res->>'dates_marked')::int = 0,
      'rejecting a future leave writes no absent rows', format('%s row(s) | %s', v_n, v_res::text));
    -- Filter on the DATE the notification is about: this student legitimately
    -- picked up a "Marked Absent" for TODAY earlier in the suite.
    SELECT count(*) INTO v_n FROM public.notifications
     WHERE user_id=v_s2 AND type='attendance' AND title='Marked Absent'
       AND (metadata->>'date')::date IN (v_today + 5, v_today + 6);
    PERFORM pg_temp.chk(v_n = 0, 'no false "Marked Absent" for a future date', format('%s notification(s)', v_n));
    SELECT status INTO v_status FROM public.leave_requests WHERE id = v_req_id;
    PERFORM pg_temp.chk(v_status = 'rejected', 'the rejection itself still lands', coalesce(v_status,'null'));
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'rejecting a future leave writes no absent rows', SQLERRM);
  END;

  -- ── 13c. a student cannot forge source='staff' on their own leave ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.leave_requests
      (institution_id, student_id, class_id, leave_type, start_date, end_date, reason, source)
    VALUES (v_inst, v_s1, v_class, 'other', v_today + 8, v_today + 8, 'forged', 'staff');
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'student cannot forge source=staff', 'INSERT ACCEPTED');
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(SQLSTATE = '42501', 'student cannot forge source=staff', SQLSTATE || ' :: ' || SQLERRM);
  END;

  -- and a plain student application still works
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.leave_requests
      (institution_id, student_id, class_id, leave_type, start_date, end_date, reason)
    VALUES (v_inst, v_s1, v_class, 'other', v_today + 8, v_today + 8, 'Genuine application');
    RESET ROLE;
    SELECT source INTO v_status FROM public.leave_requests
     WHERE student_id=v_s1 AND start_date=v_today + 8;
    PERFORM pg_temp.chk(v_status = 'student', 'a genuine application still inserts', coalesce(v_status,'null'));
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'a genuine application still inserts', SQLSTATE || ' :: ' || SQLERRM);
  END;

  -- ── 13d. approving a student application is byte-identical to a
  --         teacher-marked leave, apart from `source` ──────────────────────
  DELETE FROM public.attendance_records WHERE class_id=v_class AND date=v_today;
  DELETE FROM public.leave_requests WHERE class_id=v_class AND start_date=v_today;
  INSERT INTO public.leave_requests
    (institution_id, student_id, class_id, leave_type, start_date, end_date, reason, status, source)
  VALUES (v_inst, v_s2, v_class, 'sick', v_today, v_today, 'Applied for it', 'pending', 'student')
  RETURNING id INTO v_req_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.review_student_leave(v_req_id, 'approved', NULL);
  -- and the teacher marks the OTHER student on leave for the same day
  v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
    jsonb_build_object('student_id', v_s1, 'status','leave', 'leave_type','sick', 'reason','Marked by me')));
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.attendance_records ar
   WHERE ar.class_id=v_class AND ar.date=v_today AND ar.student_id IN (v_s1, v_s2)
     AND ar.status = 'leave' AND ar.method = 'manual';
  PERFORM pg_temp.chk(v_n = 2, 'both paths produce the same attendance status', format('%s of 2 rows are leave', v_n));
  SELECT count(*) INTO v_n FROM public.leave_requests lr
   WHERE lr.class_id=v_class AND lr.start_date=v_today AND lr.status='approved'
     AND lr.reviewed_by = v_teacher AND lr.student_id IN (v_s1, v_s2);
  PERFORM pg_temp.chk(v_n = 2, 'both paths leave an approved, reviewer-stamped record', format('%s of 2', v_n));
  SELECT count(DISTINCT source) INTO v_n FROM public.leave_requests lr
   WHERE lr.class_id=v_class AND lr.start_date=v_today AND lr.student_id IN (v_s1, v_s2);
  PERFORM pg_temp.chk(v_n = 2, 'only `source` tells the two paths apart', format('%s distinct source values', v_n));

  -- ── 13e. the re-created RLS read policies still gate correctly ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.leave_requests WHERE class_id = v_class;
  RESET ROLE;
  PERFORM pg_temp.chk(v_n > 0, 'the class teacher can still read their class leaves', format('%s row(s)', v_n));

  IF v_stranger IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.leave_requests WHERE class_id = v_class;
    RESET ROLE;
    PERFORM pg_temp.chk(v_n = 0, 'an unrelated teacher reads none of them', format('%s row(s)', v_n));
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.leave_requests WHERE student_id <> v_s1;
  RESET ROLE;
  PERFORM pg_temp.chk(v_n = 0, 'a student reads only their own leaves', format('%s foreign row(s)', v_n));

  -- ── 14. anon cannot execute the new RPC ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', NULL, true);
  SET LOCAL ROLE anon;
  BEGIN
    v_res := public.save_class_attendance(v_class, v_today, jsonb_build_array(
      jsonb_build_object('student_id', v_s1, 'status','absent')));
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'anon cannot execute the RPC', 'ACCEPTED');
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(SQLSTATE = '42501', 'anon cannot execute the RPC', SQLSTATE || ' :: ' || SQLERRM);
  END;
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
