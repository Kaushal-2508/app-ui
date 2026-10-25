-- Substitution module acceptance suite (migration 20260925140000 + the
-- useUpsertSubstitution fix). Runs as real admins / teachers / students
-- against real prod rows under RLS, then rolls everything back.
-- Assertions RECORD instead of raising, so one failure cannot hide the rest.
-- Time-dependent checks record SKIP when prod has no suitable periods right now.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-substitutions.sql -OutFile "$env:TEMP\subs.json"
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

DO $test$
DECLARE
  v_days  text[] := ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_slot uuid; v_inst uuid; v_t0 uuid; v_day text; v_ay text; v_ps uuid; v_class uuid;
  v_start time; v_end time; v_tz text; v_today date; v_now timestamp; v_date date;
  v_admin uuid; v_teacher uuid; v_student uuid; v_coord uuid;
  v_free uuid[]; v_cand uuid; v_cand2 uuid; v_id uuid; v_sub2 uuid; v_n int; v_m int; v_txt text;
  v_row public.tt_substitutions%ROWTYPE; v_js jsonb;
  v_t2 uuid; v_inst2 uuid; v_tz2 text; v_today2 date; v_now2 timestamp;
  fn text;
BEGIN
  -- ── 1. grants ──────────────────────────────────────────────────────────
  FOREACH fn IN ARRAY ARRAY[
    'public.tt_create_pending_subs_for_absent_staff(uuid,date)',
    'public.tt_get_free_teachers_for_slot(uuid,date)',
    'public.tt_run_attendance_cron_pass()',
    'public.tt_run_attendance_pass_for_institution(uuid)',
    'public.tt_assign_substitute(uuid,uuid)',
    'public.tt_my_covers(date,date)',
    'public.tt_timetable_ay_code(uuid,date)'] LOOP
    PERFORM pg_temp.chk(NOT has_function_privilege('anon', fn, 'EXECUTE'), 'anon has no EXECUTE on ' || fn);
  END LOOP;
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public.tt_create_pending_subs_for_absent_staff(uuid,date)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.tt_run_attendance_cron_pass()', 'EXECUTE'),
    'authenticated cannot call the cron-only functions');
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.tt_run_attendance_pass_for_institution(uuid)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.tt_get_free_teachers_for_slot(uuid,date)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.tt_assign_substitute(uuid,uuid)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.tt_my_covers(date,date)', 'EXECUTE'),
    'authenticated keeps the client-facing functions');

  -- ── 2. source-level: no UTC / CURRENT_DATE left in the engine ──────────
  SELECT string_agg(p.proname, ',') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('tt_substitutions_cancel_on_late_checkin','tt_run_attendance_pass_for_institution','tt_create_pending_subs_for_absent_staff')
     AND (p.prosrc ILIKE '%''UTC''%' OR p.prosrc ILIKE '%CURRENT_DATE%');
  PERFORM pg_temp.chk(v_txt IS NULL, 'no UTC / CURRENT_DATE in the substitution engine', coalesce(v_txt, ''));

  -- ── 3. stale pending backlog is closed ─────────────────────────────────
  SELECT count(*) INTO v_n
    FROM public.tt_substitutions t
    JOIN public.tt_slots s ON s.id = t.slot_id
    JOIN public.institutions i ON i.id = s.institution_id
   WHERE t.status = 'pending'
     AND t.date < (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date;
  PERFORM pg_temp.chk(v_n = 0, 'no pending cover dated before the school''s today', v_n::text);

  -- ── fixture: a taught period, preferring one that overlaps a period on a
  --    DIFFERENT structure (the case the old busy rule missed) ───────────
  SELECT s.id, s.institution_id, s.teacher_id, s.day, s.academic_year, s.period_slot_id, s.class_id,
         ps.start_time, ps.end_time, COALESCE(i.timezone, 'Asia/Kolkata')
    INTO v_slot, v_inst, v_t0, v_day, v_ay, v_ps, v_class, v_start, v_end, v_tz
    FROM public.tt_slots s
    JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
    JOIN public.classes c ON c.id = s.class_id AND c.is_active IS NOT FALSE
    JOIN public.institutions i ON i.id = s.institution_id
   WHERE s.slot_type = 'theory' AND s.teacher_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.institution_id = s.institution_id AND ur.role = 'school_admin'
                    AND NOT public.is_super_admin(ur.user_id)
                    AND public.get_user_institution(ur.user_id) = s.institution_id)
   ORDER BY EXISTS (
              SELECT 1 FROM public.tt_slots s2 JOIN public.tt_period_slots p2 ON p2.id = s2.period_slot_id
               WHERE s2.institution_id = s.institution_id AND s2.day = s.day AND s2.academic_year = s.academic_year
                 AND p2.structure_id <> ps.structure_id AND p2.start_time < ps.end_time AND p2.end_time > ps.start_time
                 AND s2.teacher_id IS NOT NULL AND s2.teacher_id <> s.teacher_id) DESC,
            s.id
   LIMIT 1;

  v_now   := now() AT TIME ZONE v_tz;
  v_today := v_now::date;
  -- next occurrence of the slot's weekday strictly after today
  v_date  := v_today + (((array_position(v_days, v_day) - extract(isodow FROM v_today)::int) + 6) % 7 + 1);

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
   WHERE ur.institution_id = v_inst AND ur.role = 'school_admin'
     AND NOT public.is_super_admin(ur.user_id)
     AND public.get_user_institution(ur.user_id) = v_inst
   LIMIT 1;
  SELECT ur.user_id INTO v_teacher FROM public.user_roles ur
   WHERE ur.institution_id = v_inst AND ur.role = 'teacher'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id
                      AND x.role IN ('school_admin','super_school_admin','coordinator','super_admin'))
     AND NOT public.tt_is_timetable_manager(ur.user_id)
   LIMIT 1;
  SELECT ur.user_id INTO v_student FROM public.user_roles ur
   WHERE ur.institution_id = v_inst AND ur.role = 'student' LIMIT 1;
  SELECT ur.user_id INTO v_coord FROM public.user_roles ur
   WHERE ur.institution_id = v_inst AND ur.role = 'coordinator'
     AND EXISTS (SELECT 1 FROM public.wing_assignments wa WHERE wa.user_id = ur.user_id)
   LIMIT 1;

  PERFORM pg_temp.chk(v_slot IS NOT NULL AND v_admin IS NOT NULL AND v_teacher IS NOT NULL,
    'fixture found', format('slot=%s %s %s-%s date=%s admin=%s teacher=%s student=%s coord=%s',
      v_slot, v_day, v_start, v_end, v_date, v_admin, v_teacher, v_student, v_coord));

  PERFORM pg_temp.chk(public.tt_timetable_ay_code(v_inst, v_today) = v_ay,
    'timetable year resolves to the slots'' year', coalesce(public.tt_timetable_ay_code(v_inst, v_today), 'NULL') || ' vs ' || v_ay);

  -- clean slate for the fixture dates (rolled back)
  DELETE FROM public.tt_substitutions WHERE slot_id = v_slot AND date IN (v_date, v_date + 7);
  INSERT INTO public.tt_substitutions (slot_id, date, original_teacher_id, status, source)
  VALUES (v_slot, v_date, v_t0, 'pending', 'auto') RETURNING id INTO v_id;

  -- ── 4. free teachers: caller check, overlap across structures ──────────
  PERFORM pg_temp.as_user(v_teacher);
  SELECT count(*) INTO v_n FROM public.tt_get_free_teachers_for_slot(v_slot, v_date);
  RESET ROLE;
  PERFORM pg_temp.chk(v_n = 0, 'a plain teacher gets no free-teacher list', v_n::text);

  PERFORM pg_temp.as_user(v_admin);
  SELECT array_agg(f.teacher_id ORDER BY f.rank, f.full_name) INTO v_free
    FROM public.tt_get_free_teachers_for_slot(v_slot, v_date) f;
  RESET ROLE;
  PERFORM pg_temp.chk(coalesce(array_length(v_free, 1), 0) > 0, 'admin gets a free-teacher list', coalesce(array_length(v_free, 1), 0)::text);
  PERFORM pg_temp.chk(NOT (v_t0 = ANY (coalesce(v_free, ARRAY[]::uuid[]))), 'the absent teacher is never offered');

  SELECT count(*) INTO v_n FROM unnest(coalesce(v_free, ARRAY[]::uuid[])) t(id)
   WHERE EXISTS (
     SELECT 1 FROM public.tt_slots s2 JOIN public.tt_period_slots p2 ON p2.id = s2.period_slot_id
      WHERE s2.institution_id = v_inst AND s2.day = v_day AND s2.academic_year = v_ay
        AND p2.start_time < v_end AND p2.end_time > v_start
        AND (s2.teacher_id = t.id
             OR EXISTS (SELECT 1 FROM public.optional_group_subjects ogs
                          JOIN public.class_assignments ca ON ca.class_id = s2.class_id
                               AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher'
                         WHERE ogs.group_id = s2.optional_group_id AND ca.user_id = t.id)));
  SELECT count(DISTINCT s2.teacher_id) INTO v_m
    FROM public.tt_slots s2 JOIN public.tt_period_slots p2 ON p2.id = s2.period_slot_id
   WHERE s2.institution_id = v_inst AND s2.day = v_day AND s2.academic_year = v_ay
     AND s2.period_slot_id <> v_ps AND p2.start_time < v_end AND p2.end_time > v_start
     AND s2.teacher_id IS NOT NULL AND s2.teacher_id <> v_t0;
  PERFORM pg_temp.chk(v_n = 0, 'nobody offered is teaching an overlapping period (any structure, baskets included)',
    format('offered-but-busy=%s; teachers busy on another period row at that time=%s', v_n, v_m));

  v_cand := v_free[1];

  -- ── 5. the manual save (useUpsertSubstitution payload) ─────────────────
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    EXECUTE $q$INSERT INTO public.tt_substitutions (slot_id, date, substitute_teacher_id)
               VALUES ($1, $2, $3) ON CONFLICT (slot_id, date, subject_id) DO NOTHING$q$
      USING v_slot, v_date, v_cand;
    PERFORM pg_temp.chk(false, 'old conflict key slot_id,date,subject_id fails', 'ACCEPTED');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.chk(SQLSTATE = '42703', 'old conflict key slot_id,date,subject_id fails with 42703', SQLSTATE || ' :: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO public.tt_substitutions
      (slot_id, date, substitute_teacher_id, reason, status, assigned_by, assigned_at, cancelled_reason, created_by)
    VALUES (v_slot, v_date, v_cand, 'suite', 'assigned', v_admin, now(), NULL, v_admin)
    ON CONFLICT (slot_id, date) DO UPDATE SET
      substitute_teacher_id = EXCLUDED.substitute_teacher_id, reason = EXCLUDED.reason,
      status = EXCLUDED.status, assigned_by = EXCLUDED.assigned_by, assigned_at = EXCLUDED.assigned_at,
      cancelled_reason = EXCLUDED.cancelled_reason, created_by = EXCLUDED.created_by
    RETURNING id INTO v_sub2;
    PERFORM pg_temp.chk(v_sub2 = v_id, 'admin save updates the pending row, no duplicate', coalesce(v_sub2::text, 'null'));
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.chk(false, 'admin save updates the pending row, no duplicate', SQLSTATE || ' :: ' || SQLERRM);
  END;
  RESET ROLE;
  SELECT * INTO v_row FROM public.tt_substitutions WHERE id = v_id;
  PERFORM pg_temp.chk(v_row.status = 'assigned' AND v_row.substitute_teacher_id = v_cand AND v_row.source = 'auto'
                      AND v_row.original_teacher_id = v_t0,
    'row is assigned, source and original teacher kept', format('%s/%s sub=%s orig=%s', v_row.status, v_row.source, v_row.substitute_teacher_id, v_row.original_teacher_id));

  PERFORM pg_temp.as_user(v_teacher);
  BEGIN
    INSERT INTO public.tt_substitutions (slot_id, date, substitute_teacher_id, status)
    VALUES (v_slot, v_date, v_teacher, 'assigned')
    ON CONFLICT (slot_id, date) DO UPDATE SET substitute_teacher_id = EXCLUDED.substitute_teacher_id;
    PERFORM pg_temp.chk(false, 'a plain teacher cannot write a cover', 'ACCEPTED');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.chk(SQLSTATE = '42501', 'a plain teacher cannot write a cover', SQLSTATE || ' :: ' || SQLERRM);
  END;
  RESET ROLE;

  -- ── 6. tt_my_covers, both directions ───────────────────────────────────
  PERFORM pg_temp.as_user(v_cand);
  SELECT count(*) INTO v_n FROM public.tt_my_covers(v_date, v_date) c
   WHERE c.substitution_id = v_id AND c.cover_role = 'covering';
  RESET ROLE;
  PERFORM pg_temp.chk(v_n = 1, 'the substitute sees the cover as "covering"', v_n::text);

  PERFORM pg_temp.as_user(v_t0);
  SELECT c.other_teacher_name INTO v_txt FROM public.tt_my_covers(v_date, v_date) c
   WHERE c.substitution_id = v_id AND c.cover_role = 'covered';
  RESET ROLE;
  PERFORM pg_temp.chk(v_txt IS NOT DISTINCT FROM (SELECT full_name FROM public.profiles WHERE id = v_cand),
    'the original teacher sees "covered by" the substitute', coalesce(v_txt, 'null'));

  PERFORM pg_temp.as_user(v_teacher);
  SELECT count(*) INTO v_n FROM public.tt_my_covers(v_date, v_date) c WHERE c.substitution_id = v_id;
  RESET ROLE;
  PERFORM pg_temp.chk(v_n = 0 OR v_teacher IN (v_cand, v_t0), 'an unrelated teacher does not see it', v_n::text);

  -- ── 7. read access: staff yes, students no ─────────────────────────────
  PERFORM pg_temp.as_user(v_admin);
  SELECT count(*) INTO v_n FROM public.tt_substitutions WHERE id = v_id;
  RESET ROLE;
  PERFORM pg_temp.chk(v_n = 1, 'admin can read the cover', v_n::text);
  IF v_student IS NOT NULL THEN
    PERFORM pg_temp.as_user(v_student);
    SELECT count(*) INTO v_n FROM public.tt_substitutions;
    RESET ROLE;
    PERFORM pg_temp.chk(v_n = 0, 'a student reads no cover rows', v_n::text);
  ELSE
    PERFORM pg_temp.skip('a student reads no cover rows', 'no student in fixture school');
  END IF;

  -- ── 8. assign through the RPC (Substitutions tab) ──────────────────────
  INSERT INTO public.tt_substitutions (slot_id, date, original_teacher_id, status, source)
  VALUES (v_slot, v_date + 7, v_t0, 'pending', 'auto') RETURNING id INTO v_sub2;
  v_txt := NULL;
  PERFORM pg_temp.as_user(v_admin);
  SELECT f.teacher_id INTO v_cand2 FROM public.tt_get_free_teachers_for_slot(v_slot, v_date + 7) f LIMIT 1;
  BEGIN
    PERFORM public.tt_assign_substitute(v_sub2, v_cand2);
  EXCEPTION WHEN others THEN
    v_txt := SQLSTATE || ' :: ' || SQLERRM;
  END;
  RESET ROLE;
  SELECT * INTO v_row FROM public.tt_substitutions WHERE id = v_sub2;
  PERFORM pg_temp.chk(v_row.status = 'assigned' AND v_row.substitute_teacher_id = v_cand2 AND v_row.assigned_by = v_admin,
    'tt_assign_substitute assigns', coalesce(v_txt, format('%s sub=%s', v_row.status, v_row.substitute_teacher_id)));

  -- ── 9. delete: blocked delete returns no row, allowed delete returns it ─
  PERFORM pg_temp.as_user(v_teacher);
  WITH d AS (DELETE FROM public.tt_substitutions WHERE id = v_id RETURNING 1) SELECT count(*) INTO v_n FROM d;
  RESET ROLE;
  PERFORM pg_temp.chk(v_n = 0, 'a plain teacher''s DELETE returns zero rows', v_n::text);
  PERFORM pg_temp.as_user(v_admin);
  WITH d AS (DELETE FROM public.tt_substitutions WHERE id = v_id RETURNING 1) SELECT count(*) INTO v_n FROM d;
  RESET ROLE;
  PERFORM pg_temp.chk(v_n = 1, 'admin DELETE returns the deleted row', v_n::text);

  -- ── 10. the attendance pass: runs for an admin, refuses anon ───────────
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    PERFORM * FROM public.tt_run_attendance_pass_for_institution(v_inst);
    v_txt := 'ok';
  EXCEPTION WHEN others THEN
    v_txt := SQLSTATE || ' :: ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.chk(v_txt = 'ok', 'admin can run the attendance pass', v_txt);

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM public.tt_run_attendance_pass_for_institution(v_inst);
    v_txt := 'ACCEPTED';
  EXCEPTION WHEN others THEN
    v_txt := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.chk(v_txt = '42501', 'anon cannot run the attendance pass', v_txt);

  -- ── 11. coordinator cover list still works (calls the free-teacher fn) ─
  IF v_coord IS NOT NULL THEN
    PERFORM pg_temp.as_user(v_coord);
    BEGIN
      v_js := public.dash5_coord_cover(NULL);
      v_txt := 'ok total=' || (v_js->>'total');
    EXCEPTION WHEN others THEN
      v_txt := SQLSTATE || ' :: ' || SQLERRM;
    END;
    RESET ROLE;
    PERFORM pg_temp.chk(v_txt LIKE 'ok%', 'dash5_coord_cover still answers for a coordinator', v_txt);
  ELSE
    PERFORM pg_temp.skip('dash5_coord_cover still answers for a coordinator', 'no coordinator with a wing');
  END IF;

  -- ── 12. late check-in cancels only periods not yet started (§24), and a
  --        re-absence re-opens them ──────────────────────────────────────
  -- The regression band: periods that have ALREADY STARTED in school time but
  -- start after UTC-wall-clock + 5 min. The old trigger cancelled exactly
  -- these. Prefer a teacher who also has periods still ahead, so the cancel
  -- and re-open halves can run too; fall back to band-only.
  SELECT s.teacher_id, s.institution_id, COALESCE(i.timezone, 'Asia/Kolkata')
    INTO v_t2, v_inst2, v_tz2
    FROM public.tt_slots s
    JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
    JOIN public.classes c ON c.id = s.class_id AND c.is_active IS NOT FALSE
    JOIN public.institutions i ON i.id = s.institution_id
   WHERE s.teacher_id IS NOT NULL
     AND s.slot_type NOT IN ('free','break')
     AND s.day = public.tt_dow_to_text((now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date)
     AND s.academic_year = public.tt_timetable_ay_code(s.institution_id, (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date)
   GROUP BY s.teacher_id, s.institution_id, i.timezone
  HAVING bool_or(ps.start_time > ((now() AT TIME ZONE 'UTC')::time + INTERVAL '10 minutes')
             AND ps.start_time < ((now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::time - INTERVAL '10 minutes'))
   ORDER BY bool_or(ps.start_time > ((now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::time + INTERVAL '10 minutes')) DESC
   LIMIT 1;

  IF v_t2 IS NULL THEN
    PERFORM pg_temp.skip('late check-in keeps covers for periods already taught', 'no period today falls between UTC and school wall-clock time');
    PERFORM pg_temp.skip('late check-in cancels covers for periods still ahead');
    PERFORM pg_temp.skip('re-absence re-opens the periods still ahead');
  ELSE
    v_now2   := now() AT TIME ZONE v_tz2;
    v_today2 := v_now2::date;
    DELETE FROM public.tt_substitutions t USING public.tt_slots s
     WHERE s.id = t.slot_id AND s.teacher_id = v_t2 AND t.date = v_today2;
    DELETE FROM public.staff_attendance_records WHERE staff_id = v_t2 AND date = v_today2;
    INSERT INTO public.staff_attendance_records (institution_id, staff_id, date, status, auto_marked_absent)
    VALUES (v_inst2, v_t2, v_today2, 'absent', true);
    PERFORM public.tt_create_pending_subs_for_absent_staff(v_inst2, v_today2);

    UPDATE public.staff_attendance_records SET status = 'present'
     WHERE staff_id = v_t2 AND date = v_today2;

    SELECT count(*) FILTER (WHERE ps.start_time < v_now2::time - INTERVAL '5 minutes' AND t.status = 'cancelled'),
           count(*) FILTER (WHERE ps.start_time < v_now2::time - INTERVAL '5 minutes' AND t.status = 'pending')
      INTO v_n, v_m
      FROM public.tt_substitutions t
      JOIN public.tt_slots s ON s.id = t.slot_id
      JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
     WHERE s.teacher_id = v_t2 AND t.date = v_today2;
    PERFORM pg_temp.chk(v_n = 0 AND v_m > 0, 'late check-in keeps covers for periods already taught',
      format('past cancelled=%s past still pending=%s', v_n, v_m));

    SELECT count(*) FILTER (WHERE t.status = 'pending'),
           count(*) FILTER (WHERE t.status = 'cancelled')
      INTO v_n, v_m
      FROM public.tt_substitutions t
      JOIN public.tt_slots s ON s.id = t.slot_id
      JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
     WHERE s.teacher_id = v_t2 AND t.date = v_today2
       AND ps.start_time > v_now2::time + INTERVAL '5 minutes';
    IF v_n + v_m = 0 THEN
      PERFORM pg_temp.skip('late check-in cancels covers for periods still ahead', 'the fixture teacher has no periods left today');
      PERFORM pg_temp.skip('re-absence re-opens the periods still ahead');
      RETURN;
    END IF;
    PERFORM pg_temp.chk(v_n = 0 AND v_m > 0, 'late check-in cancels covers for periods still ahead',
      format('future pending=%s future cancelled=%s', v_n, v_m));

    UPDATE public.staff_attendance_records SET status = 'absent'
     WHERE staff_id = v_t2 AND date = v_today2;
    PERFORM public.tt_create_pending_subs_for_absent_staff(v_inst2, v_today2);
    SELECT count(*) FILTER (WHERE t.status = 'pending'),
           count(*) FILTER (WHERE t.status = 'cancelled')
      INTO v_n, v_m
      FROM public.tt_substitutions t
      JOIN public.tt_slots s ON s.id = t.slot_id
      JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
     WHERE s.teacher_id = v_t2 AND t.date = v_today2
       AND ps.start_time > v_now2::time + INTERVAL '5 minutes';
    PERFORM pg_temp.chk(v_n > 0 AND v_m = 0, 're-absence re-opens the periods still ahead',
      format('future pending=%s future cancelled=%s', v_n, v_m));
  END IF;
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
