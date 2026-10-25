DO $$
DECLARE
  v_class uuid; v_inst uuid; v_admin uuid; v_ptm uuid;
  v_expected int; v_actual int; v_total_rows int; v_dupes int;
BEGIN
  -- A class with both students and teachers, restricted to a demo
  -- institution (never a real school) and ranked by teacher-assignment
  -- rows so a teacher of multiple subjects is actually present and the
  -- duplicate-row check below is not vacuously true.
  SELECT c.id, c.institution_id INTO v_class, v_inst
    FROM public.classes c
    JOIN public.institutions i ON i.id = c.institution_id AND i.is_demo = true
    JOIN public.class_assignments ca ON ca.class_id = c.id AND ca.role='teacher'
   WHERE EXISTS (SELECT 1 FROM public.class_assignments s
                  WHERE s.class_id = c.id AND s.role = 'student')
   GROUP BY c.id, c.institution_id
   ORDER BY count(*) DESC LIMIT 1;
  IF v_class IS NULL THEN RAISE EXCEPTION 'SETUP: no class with both students and teachers'; END IF;

  SELECT id INTO v_admin FROM public.profiles WHERE institution_id = v_inst LIMIT 1;

  INSERT INTO public.ptm_schedules
    (institution_id, title, scheduled_date, start_time, end_time, class_id, created_by)
  VALUES (v_inst, 'ZZ TEST PTM', current_date + 7, '10:00', '13:00', v_class, v_admin)
  RETURNING id INTO v_ptm;

  -- tg_ptm_notify_scheduled is a DEFERRABLE INITIALLY DEFERRED constraint
  -- trigger as of Task 7 (it must see ptm_schedule_classes junction rows
  -- that don't exist until after the INSERT statement completes), so it
  -- fires at COMMIT rather than here. This script never commits - it rolls
  -- back via the RAISE EXCEPTION at the end - so force it to run now,
  -- inside this same transaction, or every count below reads zero.
  SET CONSTRAINTS ALL IMMEDIATE;

  -- auth.uid() is NULL here, so the actor is created_by (v_admin).
  SELECT count(*) INTO v_expected
    FROM public.ptm_audience(v_ptm) a WHERE a.user_id IS DISTINCT FROM v_admin;
  SELECT count(*) INTO v_actual
    FROM public.notifications WHERE metadata->>'ptm_id' = v_ptm::text;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'FAIL: notified % but audience is %', v_actual, v_expected;
  END IF;
  IF v_actual = 0 THEN RAISE EXCEPTION 'FAIL: nobody was notified'; END IF;

  -- A teacher of N subjects in this class must get exactly ONE row.
  SELECT count(*) INTO v_dupes FROM (
    SELECT user_id FROM public.notifications
     WHERE metadata->>'ptm_id' = v_ptm::text
     GROUP BY user_id HAVING count(*) > 1) d;
  IF v_dupes > 0 THEN RAISE EXCEPTION 'FAIL: % recipients got duplicate rows', v_dupes; END IF;

  -- The creating admin must NOT be in their own audience.
  IF EXISTS (SELECT 1 FROM public.notifications
              WHERE metadata->>'ptm_id' = v_ptm::text AND user_id = v_admin) THEN
    RAISE EXCEPTION 'FAIL: the actor notified themselves';
  END IF;

  -- A description-only edit must notify nobody new.
  UPDATE public.ptm_schedules SET description = 'edited' WHERE id = v_ptm;
  SELECT count(*) INTO v_total_rows
    FROM public.notifications WHERE metadata->>'ptm_id' = v_ptm::text;
  IF v_total_rows <> v_actual THEN
    RAISE EXCEPTION 'FAIL: a description edit notified % extra', v_total_rows - v_actual;
  END IF;

  -- Rescheduling TWICE must notify BOTH times (the claim-delete).
  UPDATE public.ptm_schedules SET scheduled_date = current_date + 8 WHERE id = v_ptm;
  UPDATE public.ptm_schedules SET scheduled_date = current_date + 9 WHERE id = v_ptm;
  SELECT count(*) INTO v_total_rows
    FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type = 'ptm_rescheduled';
  IF v_total_rows <> v_expected * 2 THEN
    RAISE EXCEPTION 'FAIL: two reschedules produced % rows, expected % (the claim-delete is missing)',
      v_total_rows, v_expected * 2;
  END IF;

  RAISE EXCEPTION 'PASS-ROLLBACK: audience=% dupes=0 reschedules=% (rolling back)', v_expected, v_total_rows;
END $$;
