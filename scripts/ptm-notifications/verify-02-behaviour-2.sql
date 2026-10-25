-- Spec test 9: trigger resilience, asserted statically. All three trigger
-- functions MUST carry the catch-all, or a failed notification can abort a
-- PTM write. Checked against pg_proc rather than by deliberately breaking
-- _ptm_fanout, because this runs against prod.
DO $$
DECLARE v_unguarded text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_unguarded
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('tg_ptm_notify_scheduled','tg_ptm_notify_changed','tg_ptm_notify_booking')
     AND p.prosrc NOT ILIKE '%EXCEPTION WHEN OTHERS%';
  IF v_unguarded IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: unguarded trigger functions: %', v_unguarded;
  END IF;

  -- Every verification path in this file runs as the definer, so a
  -- function that lost SECURITY DEFINER or its pinned search_path would
  -- pass every other check here and still fail for every real client.
  SELECT string_agg(p.proname, ', ') INTO v_unguarded
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('tg_ptm_notify_scheduled','tg_ptm_notify_changed','tg_ptm_notify_booking')
     AND (NOT p.prosecdef
          OR coalesce(array_to_string(p.proconfig, ','), '') NOT ILIKE '%search_path%');
  IF v_unguarded IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: not SECURITY DEFINER / search_path pinned: %', v_unguarded;
  END IF;

  RAISE NOTICE 'PASS: all three trigger functions are exception-wrapped and SECURITY DEFINER';
END $$;

-- Spec tests 3, 6, 7: school-wide count, cancel-once, booking isolation.
DO $$
DECLARE
  v_inst uuid; v_admin uuid; v_student uuid;
  v_ptm uuid; v_roster int; v_got int; v_before int;
BEGIN
  -- Demo institutions only, never a real school: an unrestricted
  -- ORDER BY ... DESC LIMIT 1 here would resolve to Alliance International
  -- School (1,545 real students) today.
  SELECT c.institution_id INTO v_inst
    FROM public.classes c
    JOIN public.institutions i ON i.id = c.institution_id
    JOIN public.class_assignments ca ON ca.class_id = c.id AND ca.role='student'
   WHERE i.is_demo = true
   GROUP BY c.institution_id ORDER BY count(*) DESC LIMIT 1;

  -- Must NOT be a student: the trigger excludes the actor from its own
  -- audience, so an arbitrary profiles row here would understate v_got by
  -- one and fail this test against a Task 1 defect that does not exist.
  SELECT p.id INTO v_admin
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
   WHERE p.institution_id = v_inst
     AND ur.role IN ('school_admin','super_school_admin')
   LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'SETUP: no admin profile in institution'; END IF;
  IF EXISTS (SELECT 1 FROM public.institution_student_ids(v_inst) s WHERE s.student_id = v_admin) THEN
    RAISE EXCEPTION 'SETUP: chosen actor is in the student roster, count would be off by one';
  END IF;

  -- class_id NULL = school-wide.
  INSERT INTO public.ptm_schedules
    (institution_id, title, scheduled_date, start_time, end_time, created_by)
  VALUES (v_inst, 'ZZ SCHOOLWIDE', current_date + 7, '10:00', '13:00', v_admin)
  RETURNING id INTO v_ptm;

  -- tg_ptm_notify_scheduled is a DEFERRABLE INITIALLY DEFERRED constraint
  -- trigger as of Task 7 (it must see ptm_schedule_classes junction rows
  -- that don't exist until after the INSERT statement completes), so it
  -- fires at COMMIT rather than here. This script never commits - it rolls
  -- back via the RAISE EXCEPTION at the end - so force it to run now,
  -- inside this same transaction, or every count below reads zero.
  SET CONSTRAINTS ALL IMMEDIATE;

  -- Spec test 3: the student half must equal the canonical roster exactly.
  SELECT count(*) INTO v_roster FROM public.institution_student_ids(v_inst);
  IF v_roster = 0 THEN RAISE EXCEPTION 'SETUP: chosen institution has no students'; END IF;
  SELECT count(*) INTO v_got
    FROM public.notifications n
    JOIN public.institution_student_ids(v_inst) s ON s.student_id = n.user_id
   WHERE n.metadata->>'ptm_id' = v_ptm::text;
  IF v_got <> v_roster THEN
    RAISE EXCEPTION 'FAIL: school-wide reached % students, canonical roster is %', v_got, v_roster;
  END IF;

  -- Spec test 6: cancel notifies once; a second cancel is silent.
  UPDATE public.ptm_schedules SET status='cancelled' WHERE id = v_ptm;
  SELECT count(*) INTO v_before FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type='ptm_cancelled';
  IF v_before = 0 THEN RAISE EXCEPTION 'FAIL: cancel notified nobody'; END IF;
  UPDATE public.ptm_schedules SET status='cancelled' WHERE id = v_ptm;
  SELECT count(*) INTO v_got FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type='ptm_cancelled';
  IF v_got <> v_before THEN
    RAISE EXCEPTION 'FAIL: a second cancel notified % extra', v_got - v_before;
  END IF;

  -- Spec test 7 (flipped for Task 7): tg_ptm_notify_booking was retired -
  -- a booking now notifies NOBODY, teachers see bookings via "View
  -- Bookings" instead. Insert WITHOUT teacher_id (nullable as of Task 7,
  -- since students no longer pick a teacher) to prove that shape works,
  -- then assert zero notifications, not one.
  SELECT s.student_id INTO v_student FROM public.institution_student_ids(v_inst) s LIMIT 1;

  INSERT INTO public.ptm_bookings (ptm_id, parent_id, slot_time)
  VALUES (v_ptm, v_student, '10:30');

  SELECT count(*) INTO v_got FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type='ptm_slot_booked';
  IF v_got <> 0 THEN
    RAISE EXCEPTION 'FAIL: booking wrote % rows, expected 0 (ptm_slot_booked was retired in Task 7)', v_got;
  END IF;

  RAISE EXCEPTION 'PASS-ROLLBACK: schoolwide=% cancel=% booking=0 (rolling back)', v_roster, v_before;
END $$;
