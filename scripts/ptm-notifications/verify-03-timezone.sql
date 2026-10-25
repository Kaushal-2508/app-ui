-- Section 24 regression test: a non-IST institution's "tomorrow" must be
-- resolved in ITS OWN timezone, not the server's. Rolls back via the same
-- raise-at-the-end trick as Task 2: the terminating RAISE EXCEPTION aborts
-- the transaction, so the INSERT and the institutions.timezone UPDATE both
-- undo themselves and no rows are left behind either way.
DO $$
DECLARE v_inst uuid; v_old text; v_ptm uuid; v_admin uuid; v_hits int;
BEGIN
  -- Demo institutions only (CLAUDE.md 27 / lesson from Tasks 1-2): an
  -- unrestricted LIMIT 1 over every institution could land on Alliance
  -- International School (1,545 real students) instead of a demo one.
  -- Unordered LIMIT 1 over is_demo alone is ALSO not enough: it can land
  -- on a demo institution with zero students (e.g. "Olympiad Testing"),
  -- which makes the audience empty and the assertion fire for the wrong
  -- reason. Require a roster and take the largest one, so the pick is
  -- deterministic and provably has someone to notify.
  SELECT i.id, i.timezone INTO v_inst, v_old
    FROM public.institutions i
   WHERE i.is_demo = true
     AND (SELECT count(*) FROM public.institution_student_ids(i.id)) > 0
   ORDER BY (SELECT count(*) FROM public.institution_student_ids(i.id)) DESC
   LIMIT 1;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'SETUP: no demo institution found';
  END IF;
  -- Belt-and-braces: if a future edit loosens the query above, this stops
  -- the test from passing vacuously against an empty roster.
  IF (SELECT count(*) FROM public.institution_student_ids(v_inst)) = 0 THEN
    RAISE EXCEPTION 'SETUP: chosen demo institution has no students, the test would prove nothing';
  END IF;

  SELECT id INTO v_admin FROM public.profiles WHERE institution_id = v_inst LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'SETUP: no profile in the demo institution to use as created_by';
  END IF;

  -- Pacific/Kiritimati is UTC+14: its "tomorrow" differs from UTC's.
  UPDATE public.institutions SET timezone = 'Pacific/Kiritimati' WHERE id = v_inst;

  INSERT INTO public.ptm_schedules
    (institution_id, title, scheduled_date, start_time, end_time, created_by)
  VALUES (v_inst, 'ZZ TZ TEST',
          (now() AT TIME ZONE 'Pacific/Kiritimati')::date + 1,
          '10:00', '13:00', v_admin)
  RETURNING id INTO v_ptm;

  PERFORM public.ptm_send_day_before_reminders();

  SELECT count(*) INTO v_hits FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type = 'ptm_reminder';
  IF v_hits = 0 THEN
    RAISE EXCEPTION 'FAIL: institution-local tomorrow was not picked up (section 24). inst=% tz=% scheduled_for=% hits=%',
      v_inst, 'Pacific/Kiritimati', (now() AT TIME ZONE 'Pacific/Kiritimati')::date + 1, v_hits;
  END IF;

  RAISE EXCEPTION 'PASS-ROLLBACK: reminder fired for % recipients (rolling back)', v_hits;
END $$;
