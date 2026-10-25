-- Online PTM, follow-up to 20261005160000-160300 (NEEDS DB in naman-erp
-- 0f4b8f15 and 8e7f4d10, 2026-10-05).
--
-- 1. A staff member's Google account for online PTMs defaults to their login
--    email. get_google_email returns the account they set, else the login
--    email; nobody is refused for not having set one (create_online_ptm,
--    set_ptm_online_teachers, swap_ptm_online_teacher). has_google_email in
--    ptm_online_teacher_options / ptm_online_sessions keeps meaning "set
--    explicitly" (_ptm_has_google is unchanged).
-- 2. Online booking is per slot: a family can book, move or cancel any slot
--    until that slot starts, even once the meeting is under way (school
--    timezone, CLAUDE.md 24); booking_cutoff_minutes does not apply online.
--    ptm_online_my_sessions.booking_closes_at is the booked slot's start
--    (the meeting's end while unbooked) and can_change follows it.
-- In-person behaviour is unchanged. Bodies are the 20261005160100/160300 ones
-- with only those edits.

-- The account Meet uses for a staff member: the one they set, else the login email.
CREATE OR REPLACE FUNCTION public._ptm_google_email(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT g.google_email FROM public.user_google_accounts g WHERE g.user_id = _user),
    (SELECT NULLIF(lower(btrim(p.email)), '') FROM public.profiles p WHERE p.id = _user));
$$;
REVOKE ALL ON FUNCTION public._ptm_google_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_google_email(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_google_email(_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target uuid := COALESCE(_user_id, auth.uid());
  v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF v_target <> v_uid AND NOT public.is_institution_admin(v_uid, public.get_user_institution(v_target)) THEN
    RAISE EXCEPTION 'Only a school admin can see another person''s Google account.' USING ERRCODE = '42501';
  END IF;
  v_email := public._ptm_google_email(v_target);
  RETURN v_email;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_online_ptm(
  _institution_id uuid, _title text, _description text, _scheduled_date date,
  _start_time time, _end_time time, _slot_duration_minutes integer,
  _slot_buffer_minutes integer DEFAULT 5, _as_role text DEFAULT 'teacher',
  _teacher_ids uuid[] DEFAULT NULL, _student_ids uuid[] DEFAULT NULL,
  _booking_cutoff_minutes integer DEFAULT 240, _feedback_edit_days integer DEFAULT 3)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ptm uuid;
  v_teachers uuid[];
  v_students uuid[];
  v_bad text;
  v_dup uuid;
  v_buffer integer := COALESCE(_slot_buffer_minutes, 5);
  v_cutoff integer := COALESCE(_booking_cutoff_minutes, 240);
  v_edit integer := COALESCE(_feedback_edit_days, 3);
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF _as_role IS NULL OR _as_role NOT IN ('admin', 'coordinator', 'teacher') THEN
    RAISE EXCEPTION 'Unknown role.' USING ERRCODE = '22023';
  END IF;
  IF NOT public._ptm_has_hat(v_uid, _institution_id, _as_role) THEN
    RAISE EXCEPTION 'You can''t schedule a PTM with that role at this school.' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR btrim(_title) = '' THEN
    RAISE EXCEPTION 'Give the PTM a title.' USING ERRCODE = '22023';
  END IF;
  IF _scheduled_date IS NULL OR _start_time IS NULL OR _end_time IS NULL OR _end_time <= _start_time THEN
    RAISE EXCEPTION 'The end time must be after the start time.' USING ERRCODE = '22023';
  END IF;
  IF _slot_duration_minutes IS NULL OR _slot_duration_minutes NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'A slot must be 5 to 60 minutes long.' USING ERRCODE = '22023';
  END IF;
  IF v_buffer NOT BETWEEN 0 AND 30 THEN
    RAISE EXCEPTION 'The gap between slots must be 0 to 30 minutes.' USING ERRCODE = '22023';
  END IF;
  IF v_cutoff NOT BETWEEN 0 AND 1440 THEN
    RAISE EXCEPTION 'The booking cutoff must be 0 to 1440 minutes.' USING ERRCODE = '22023';
  END IF;
  IF v_edit NOT BETWEEN 0 AND 30 THEN
    RAISE EXCEPTION 'The feedback window must be 0 to 30 days.' USING ERRCODE = '22023';
  END IF;
  IF make_interval(mins => _slot_duration_minutes) > (_end_time - _start_time) THEN
    RAISE EXCEPTION 'The meeting is shorter than one slot.' USING ERRCODE = '22023';
  END IF;

  -- A double tap or a retry: hand back the PTM this creator made a moment ago.
  SELECT p.id INTO v_dup FROM public.ptm_schedules p
   WHERE p.created_by = v_uid AND p.institution_id = _institution_id AND p.mode = 'online'
     AND p.status = 'scheduled' AND p.title = btrim(_title) AND p.scheduled_date = _scheduled_date
     AND p.start_time = _start_time AND p.end_time = _end_time AND p.created_at > now() - interval '1 minute'
   ORDER BY p.created_at DESC LIMIT 1;
  IF v_dup IS NOT NULL THEN RETURN v_dup; END IF;

  IF _as_role = 'teacher' THEN
    IF _teacher_ids IS NOT NULL AND array_length(_teacher_ids, 1) IS NOT NULL
       AND (array_length(_teacher_ids, 1) > 1 OR _teacher_ids[1] <> v_uid) THEN
      RAISE EXCEPTION 'A teacher''s online PTM has only one teacher: you.'
        USING ERRCODE = 'P0001', HINT = 'ptm_teacher_fixed';
    END IF;
    v_teachers := ARRAY[v_uid];
    SELECT array_agg(DISTINCT s) INTO v_students FROM unnest(COALESCE(_student_ids, ARRAY[]::uuid[])) s WHERE s IS NOT NULL;
    IF COALESCE(array_length(v_students, 1), 0) > 2000 THEN
      RAISE EXCEPTION 'Pick 2000 students or fewer.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(v_students, ARRAY[]::uuid[])) s
                WHERE public._ptm_pickable_class(s) IS NULL
                   OR public._ptm_pickable_class(s) NOT IN (SELECT h.class_id FROM public.ptm_classes_for_hat(v_uid, 'teacher') h)) THEN
      RAISE EXCEPTION 'Some of the picked students are not in a class you teach. Refresh the list and try again.'
        USING ERRCODE = 'P0001', HINT = 'ptm_not_your_class';
    END IF;
  ELSE
    IF _student_ids IS NOT NULL AND array_length(_student_ids, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'Teachers pick their own students after the PTM is created.'
        USING ERRCODE = 'P0001', HINT = 'ptm_students_later';
    END IF;
    SELECT array_agg(DISTINCT t ORDER BY t) INTO v_teachers FROM unnest(COALESCE(_teacher_ids, ARRAY[]::uuid[])) t WHERE t IS NOT NULL;
    IF v_teachers IS NULL THEN
      RAISE EXCEPTION 'Pick at least one teacher.' USING ERRCODE = '22023';
    END IF;
    IF array_length(v_teachers, 1) > 50 THEN
      RAISE EXCEPTION 'Pick 50 teachers or fewer.' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(COALESCE(pr.full_name, 'A teacher'), ', ') INTO v_bad
      FROM unnest(v_teachers) t LEFT JOIN public.profiles pr ON pr.id = t
     WHERE NOT public._ptm_has_hat(t, _institution_id, 'teacher')
        OR pr.is_active IS FALSE
        OR NOT public._ptm_teacher_in_hat_scope(v_uid, _as_role, t, _institution_id);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'You can''t add these teachers: %.', left(v_bad, 100) USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.ptm_schedules
    (institution_id, title, description, scheduled_date, start_time, end_time, slot_duration_minutes,
     created_by, created_as_role, venue, scope_type, scope_wing_id, slot_booking_enabled,
     booking_cutoff_minutes, feedback_edit_days, mode, slot_buffer_minutes)
  VALUES (_institution_id, btrim(_title), NULLIF(btrim(COALESCE(_description, '')), ''), _scheduled_date,
          _start_time, _end_time, _slot_duration_minutes, v_uid, _as_role, NULL, 'class', NULL, true,
          v_cutoff, v_edit, 'online', v_buffer)
  RETURNING id INTO v_ptm;

  -- One sorted INSERT: the busy trigger asserts every teacher at once.
  INSERT INTO public.ptm_online_teachers (ptm_id, teacher_id, added_by)
  SELECT v_ptm, t, v_uid FROM unnest(v_teachers) t ORDER BY t;

  IF _as_role = 'teacher' AND v_students IS NOT NULL THEN
    INSERT INTO public.ptm_online_participants (ptm_id, student_id, teacher_id, class_id, added_by)
    SELECT v_ptm, s, v_uid, public._ptm_pickable_class(s), v_uid FROM unnest(v_students) s;
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = v_uid;
    PERFORM public._ptm_fanout(v_ptm, 'ptm_online_invited', 'Online PTM',
      '"' || btrim(_title) || '" with ' || COALESCE(left(v_name, 60), 'your teacher') || ' on '
        || to_char(_scheduled_date, 'DD Mon') || '. Book your slot in the app.',
      v_students);
  ELSE
    PERFORM public._ptm_fanout(v_ptm, 'ptm_online_assigned', 'Online PTM: pick your students',
      'You are a teacher in "' || btrim(_title) || '" on ' || to_char(_scheduled_date, 'DD Mon')
        || '. Open it and pick the students you will meet.',
      ARRAY(SELECT t FROM unnest(v_teachers) t WHERE t <> v_uid));
  END IF;
  RETURN v_ptm;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_ptm_online_teachers(_ptm_id uuid, _teacher_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_hat text;
  v_desired uuid[];
  v_from timestamptz;
  v_to timestamptz;
  v_refused jsonb := '[]'::jsonb;
  v_add uuid[] := ARRAY[]::uuid[];
  v_removed integer := 0;
  v_kept integer := 0;
  r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) OR v_p.mode <> 'online' THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.created_as_role = 'teacher' THEN
    RAISE EXCEPTION 'A teacher''s online PTM has only one teacher: you.'
      USING ERRCODE = 'P0001', HINT = 'ptm_teacher_fixed';
  END IF;
  IF public.is_institution_admin(v_uid, v_p.institution_id) THEN
    v_hat := 'admin';
  ELSIF v_p.created_by = v_uid AND v_p.created_as_role = 'coordinator'
        AND public._ptm_has_hat(v_uid, v_p.institution_id, 'coordinator') THEN
    v_hat := 'coordinator';
  ELSE
    RAISE EXCEPTION 'You can''t change the teachers of this PTM.' USING ERRCODE = '42501';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF public._ptm_has_ended(_ptm_id) THEN
    RAISE EXCEPTION 'This meeting has already happened.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_desired FROM unnest(COALESCE(_teacher_ids, ARRAY[]::uuid[])) t WHERE t IS NOT NULL;
  v_desired := COALESCE(v_desired, ARRAY[]::uuid[]);
  IF array_length(v_desired, 1) > 50 THEN
    RAISE EXCEPTION 'Pick 50 teachers or fewer.' USING ERRCODE = '22023';
  END IF;
  SELECT w.starts_at, w.ends_at INTO v_from, v_to FROM public._ptm_own_window(_ptm_id) w;

  -- Removals: a teacher with an active booking stays (swap them instead).
  FOR r IN
    SELECT ot.teacher_id, pr.full_name,
           (SELECT count(*) FROM public.ptm_bookings b
             WHERE b.ptm_id = _ptm_id AND b.teacher_id = ot.teacher_id AND b.cancelled_at IS NULL) AS booked
      FROM public.ptm_online_teachers ot LEFT JOIN public.profiles pr ON pr.id = ot.teacher_id
     WHERE ot.ptm_id = _ptm_id AND NOT (ot.teacher_id = ANY (v_desired))
  LOOP
    IF r.booked > 0 THEN
      v_refused := v_refused || jsonb_build_object('teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'has_bookings');
      v_kept := v_kept + 1;
    ELSE
      PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_uninvited', 'Online PTM changed',
        '"' || v_p.title || '": your meeting with ' || COALESCE(left(r.full_name, 60), 'your teacher')
          || ' was removed. The school will tell you if a new one is set.',
        ARRAY(SELECT op.student_id FROM public.ptm_online_participants op
               WHERE op.ptm_id = _ptm_id AND op.teacher_id = r.teacher_id));
      DELETE FROM public.ptm_notifications_sent
       WHERE ptm_id = _ptm_id AND recipient_id = r.teacher_id AND notification_type LIKE 'ptm_online_%assigned';
      PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_unassigned', 'Online PTM changed',
        'You are no longer a teacher in "' || v_p.title || '".', ARRAY[r.teacher_id]);
      DELETE FROM public.ptm_online_teachers WHERE ptm_id = _ptm_id AND teacher_id = r.teacher_id;
      v_removed := v_removed + 1;
    END IF;
  END LOOP;

  -- Additions, each judged; the busy trigger re-checks under its lock.
  FOR r IN
    SELECT t AS teacher_id, pr.full_name, pr.is_active
      FROM unnest(v_desired) t LEFT JOIN public.profiles pr ON pr.id = t
     WHERE NOT EXISTS (SELECT 1 FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id AND ot.teacher_id = t)
  LOOP
    IF NOT public._ptm_has_hat(r.teacher_id, v_p.institution_id, 'teacher') OR r.is_active IS FALSE THEN
      v_refused := v_refused || jsonb_build_object('teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'not_a_teacher');
    ELSIF NOT public._ptm_teacher_in_hat_scope(v_uid, v_hat, r.teacher_id, v_p.institution_id) THEN
      v_refused := v_refused || jsonb_build_object('teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'out_of_scope');
    ELSIF EXISTS (SELECT 1 FROM public._ptm_teacher_bookings(ARRAY[r.teacher_id], v_from, v_to, _ptm_id)) THEN
      v_refused := v_refused || jsonb_build_object('teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'busy');
    ELSE
      v_add := v_add || r.teacher_id;
    END IF;
  END LOOP;
  IF array_length(v_add, 1) IS NOT NULL THEN
    INSERT INTO public.ptm_online_teachers (ptm_id, teacher_id, added_by)
    SELECT _ptm_id, t, v_uid FROM unnest(v_add) t ORDER BY t;
    DELETE FROM public.ptm_notifications_sent
     WHERE ptm_id = _ptm_id AND recipient_id = ANY (v_add) AND notification_type LIKE 'ptm_online_%assigned';
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_assigned', 'Online PTM: pick your students',
      'You are a teacher in "' || v_p.title || '" on ' || to_char(v_p.scheduled_date, 'DD Mon')
        || '. Open it and pick the students you will meet.',
      ARRAY(SELECT t FROM unnest(v_add) t WHERE t <> v_uid));
  END IF;

  SELECT count(*)::int INTO v_kept FROM public.ptm_online_teachers ot
   WHERE ot.ptm_id = _ptm_id AND NOT (ot.teacher_id = ANY (v_add));
  RETURN jsonb_build_object('added', COALESCE(array_length(v_add, 1), 0), 'removed', v_removed,
                            'kept', v_kept, 'refused', v_refused);
END;
$$;

CREATE OR REPLACE FUNCTION public.swap_ptm_online_teacher(_ptm_id uuid, _from_teacher uuid, _to_teacher uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_to_name text;
  v_moved_bookings integer := 0;
  v_moved_students integer := 0;
  v_out integer := 0;
  v_families uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) OR v_p.mode <> 'online' THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_institution_admin(v_uid, v_p.institution_id) THEN
    RAISE EXCEPTION 'Only a school admin can hand a session to another teacher.' USING ERRCODE = '42501';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF public._ptm_has_ended(_ptm_id) THEN
    RAISE EXCEPTION 'This meeting has already happened.' USING ERRCODE = '22023';
  END IF;
  IF _from_teacher IS NULL OR _to_teacher IS NULL OR _from_teacher = _to_teacher THEN
    RAISE EXCEPTION 'Pick a different teacher to hand the session to.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ptm_online_teachers WHERE ptm_id = _ptm_id AND teacher_id = _from_teacher) THEN
    RAISE EXCEPTION 'That teacher is not in this PTM.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ptm_online_teachers WHERE ptm_id = _ptm_id AND teacher_id = _to_teacher) THEN
    RAISE EXCEPTION 'That teacher already has a session in this PTM.' USING ERRCODE = '22023';
  END IF;
  SELECT pr.full_name INTO v_to_name FROM public.profiles pr WHERE pr.id = _to_teacher;
  IF NOT public._ptm_has_hat(_to_teacher, v_p.institution_id, 'teacher')
     OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _to_teacher AND pr.is_active IS FALSE) THEN
    RAISE EXCEPTION '% is not an active teacher at this school.', COALESCE(left(v_to_name, 60), 'That person')
      USING ERRCODE = 'P0001';
  END IF;

  -- One UPDATE: the roster follows by ON UPDATE CASCADE; the busy trigger checks _to.
  UPDATE public.ptm_online_teachers SET teacher_id = _to_teacher, added_by = v_uid
   WHERE ptm_id = _ptm_id AND teacher_id = _from_teacher;
  -- Their bookings move too; a moved booking needs a new room.
  WITH m AS (
    UPDATE public.ptm_bookings SET teacher_id = _to_teacher
     WHERE ptm_id = _ptm_id AND teacher_id = _from_teacher AND cancelled_at IS NULL
    RETURNING id)
  SELECT count(*)::int INTO v_moved_bookings FROM m;
  DELETE FROM public.ptm_booking_meet bm
   USING public.ptm_bookings b
   WHERE bm.booking_id = b.id AND b.ptm_id = _ptm_id AND b.teacher_id = _to_teacher AND b.cancelled_at IS NULL;

  SELECT count(*)::int, array_agg(op.student_id),
         count(*) FILTER (WHERE op.class_id NOT IN (SELECT h.class_id FROM public.ptm_classes_for_hat(_to_teacher, 'teacher') h))::int
    INTO v_moved_students, v_families, v_out
    FROM public.ptm_online_participants op
   WHERE op.ptm_id = _ptm_id AND op.teacher_id = _to_teacher;

  DELETE FROM public.ptm_notifications_sent
   WHERE ptm_id = _ptm_id AND notification_type = 'ptm_teacher_swapped' AND recipient_id = ANY (COALESCE(v_families, ARRAY[]::uuid[]));
  PERFORM public._ptm_fanout(_ptm_id, 'ptm_teacher_swapped', 'Online PTM teacher changed',
    'Your online meeting "' || v_p.title || '" is now with ' || COALESCE(left(v_to_name, 60), 'another teacher')
      || '. Your slot stays the same.', v_families);
  DELETE FROM public.ptm_notifications_sent
   WHERE ptm_id = _ptm_id AND recipient_id IN (_from_teacher, _to_teacher) AND notification_type LIKE 'ptm_online_%assigned';
  PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_assigned', 'Online PTM: a session for you',
    'You now run a session in "' || v_p.title || '" on ' || to_char(v_p.scheduled_date, 'DD Mon') || '.',
    ARRAY[_to_teacher]);
  PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_unassigned', 'Online PTM changed',
    'Your session in "' || v_p.title || '" was handed to ' || COALESCE(left(v_to_name, 60), 'another teacher') || '.',
    ARRAY[_from_teacher]);

  RETURN jsonb_build_object('moved_students', v_moved_students, 'moved_bookings', v_moved_bookings,
                            'out_of_scope_students', v_out);
END;
$$;

CREATE OR REPLACE FUNCTION public.book_ptm_slot(_ptm_id uuid, _slot_time time without time zone, _replace boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_class uuid;
  v_teacher uuid;
  v_id uuid;
  v_con text;
  v_name text;
  v_tz text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_role(v_uid, 'student') THEN
    RAISE EXCEPTION 'Only a student account can book a slot.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.mode = 'online' THEN
    -- The teacher comes from the participant row, never from the client.
    -- FOR SHARE: a concurrent swap waits, so the booking never lands on the old teacher.
    SELECT op.class_id, op.teacher_id INTO v_class, v_teacher
      FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.student_id = v_uid
     FOR SHARE;
    IF v_class IS NULL THEN
      RAISE EXCEPTION 'You are not on the list for this online meeting. Ask your teacher.'
        USING ERRCODE = 'P0001', HINT = 'ptm_not_participant';
    END IF;
  ELSE
    v_class := public._ptm_student_class(v_uid);
    IF v_class IS NULL THEN
      RAISE EXCEPTION 'Your class is not set up. Ask your school.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(_ptm_id) e WHERE e.class_id = v_class) THEN
      RAISE EXCEPTION 'This meeting is not for your class.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This meeting has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_p.slot_booking_enabled THEN
    RAISE EXCEPTION 'Slot booking is off for this meeting.' USING ERRCODE = '22023';
  END IF;
  IF v_p.mode = 'online' THEN
    -- Online: every slot is bookable until it starts, even once the meeting is
    -- under way (school timezone, CLAUDE.md 24). The cutoff does not apply.
    SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_p.institution_id;
    IF _slot_time IS NOT NULL AND now() >= (v_p.scheduled_date + _slot_time) AT TIME ZONE v_tz THEN
      RAISE EXCEPTION 'That slot has already started. Pick a later one.'
        USING ERRCODE = 'P0001', HINT = 'ptm_slot_started';
    END IF;
  ELSIF now() >= (SELECT w.booking_closes_at FROM public._ptm_window(_ptm_id) w) THEN
    RAISE EXCEPTION 'Booking has closed for this meeting.' USING ERRCODE = '22023';
  END IF;
  IF NOT public._ptm_slot_ok(_ptm_id, _slot_time) THEN
    RAISE EXCEPTION 'That time is not one of the meeting''s slots.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_replace, false) THEN
    -- Online: a slot that has started can no longer be moved.
    IF v_p.mode = 'online' AND EXISTS (
         SELECT 1 FROM public.ptm_bookings b
          WHERE b.ptm_id = _ptm_id AND b.parent_id = v_uid AND b.cancelled_at IS NULL
            AND now() >= (v_p.scheduled_date + b.slot_time) AT TIME ZONE v_tz) THEN
      RAISE EXCEPTION 'Your slot has already started, so it can no longer be moved.'
        USING ERRCODE = 'P0001', HINT = 'ptm_slot_started';
    END IF;
    UPDATE public.ptm_bookings
       SET cancelled_at = now(), status = 'cancelled'
     WHERE ptm_id = _ptm_id AND parent_id = v_uid AND cancelled_at IS NULL;
  END IF;
  BEGIN
    INSERT INTO public.ptm_bookings (ptm_id, parent_id, class_id, slot_time, status, teacher_id)
    VALUES (_ptm_id, v_uid, v_class, _slot_time, 'booked', v_teacher)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'ptm_bookings_one_per_student' THEN
      RAISE EXCEPTION 'You already have a slot. Cancel it first.'
        USING ERRCODE = 'P0001', HINT = 'ptm_already_booked';
    END IF;
    RAISE EXCEPTION 'That slot was just taken. Pick another.'
      USING ERRCODE = 'P0001', HINT = 'ptm_slot_taken';
  END;
  IF v_p.mode = 'online' THEN
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = v_uid;
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_booking_confirmed', 'PTM slot booked',
      '"' || v_p.title || '" on ' || to_char(v_p.scheduled_date, 'DD Mon') || ' at '
        || to_char(_slot_time, 'HH24:MI') || '. The Join button opens 10 minutes before.',
      ARRAY[v_uid], v_id::text, NULL, jsonb_build_object('booking_id', v_id));
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_slot_booked', 'PTM slot booked',
      COALESCE(left(v_name, 60), 'A family') || ' booked ' || to_char(_slot_time, 'HH24:MI') || ' on '
        || to_char(v_p.scheduled_date, 'DD Mon') || ' for "' || v_p.title || '".',
      ARRAY[v_teacher], v_id::text, NULL, jsonb_build_object('booking_id', v_id));
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ptm_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.ptm_bookings%ROWTYPE;
  v_p public.ptm_schedules%ROWTYPE;
  v_open boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_b FROM public.ptm_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_b.cancelled_at IS NOT NULL THEN RETURN; END IF;  -- already cancelled: idempotent
  IF v_b.mode = 'online' THEN
    -- Online: the family may change their mind until their own slot starts.
    v_open := now() < (SELECT (p.scheduled_date + v_b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
                         FROM public.ptm_schedules p JOIN public.institutions i ON i.id = p.institution_id
                        WHERE p.id = v_b.ptm_id);
  ELSE
    v_open := now() < (SELECT w.booking_closes_at FROM public._ptm_window(v_b.ptm_id) w);
  END IF;
  IF NOT (
       (v_b.parent_id = v_uid AND v_open)
       OR public.can_manage_ptm(v_uid, v_b.ptm_id)
       OR (v_b.mode = 'in_person' AND public.is_class_teacher_of(v_uid, v_b.class_id))
       OR (v_b.mode = 'online' AND v_b.teacher_id = v_uid)
     ) THEN
    IF v_b.parent_id = v_uid THEN
      RAISE EXCEPTION 'Booking changes have closed for this meeting.' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'You can''t cancel this booking.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ptm_bookings SET cancelled_at = now(), status = 'cancelled' WHERE id = _booking_id;
  IF v_b.mode = 'online' THEN
    SELECT * INTO v_p FROM public.ptm_schedules WHERE id = v_b.ptm_id;
    IF v_b.parent_id = v_uid THEN
      PERFORM public._ptm_fanout(v_b.ptm_id, 'ptm_slot_cancelled', 'PTM slot cancelled',
        'A family cancelled ' || to_char(v_b.slot_time, 'HH24:MI') || ' on '
          || to_char(v_p.scheduled_date, 'DD Mon') || ' for "' || v_p.title || '".',
        ARRAY[v_b.teacher_id], v_b.id::text, NULL, jsonb_build_object('booking_id', v_b.id));
    ELSE
      PERFORM public._ptm_fanout(v_b.ptm_id, 'ptm_booking_cancelled', 'PTM slot cancelled',
        'Your ' || to_char(v_b.slot_time, 'HH24:MI') || ' slot for "' || v_p.title
          || '" was cancelled by the school. Pick another slot if one is free.',
        ARRAY[v_b.parent_id], v_b.id::text, NULL, jsonb_build_object('booking_id', v_b.id));
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_online_my_sessions(_ptm_id uuid DEFAULT NULL)
RETURNS TABLE(ptm_id uuid, teacher_id uuid, teacher_name text, class_id uuid, booking_id uuid,
              slot_time time, meet_uri text, meet_ready boolean, booking_closes_at timestamptz,
              can_change boolean, slot_starts_at timestamptz, slot_ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'student') THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, op.teacher_id, tp.full_name, op.class_id, b.id, b.slot_time, m.meet_uri,
         m.meet_uri IS NOT NULL, x.closes_at,
         (p.status = 'scheduled' AND now() < x.closes_at),
         CASE WHEN b.id IS NOT NULL THEN (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') END,
         CASE WHEN b.id IS NOT NULL THEN ((p.scheduled_date + b.slot_time) + make_interval(mins => p.slot_duration_minutes))
                                         AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') END
    FROM public.ptm_online_participants op
    JOIN public.ptm_schedules p ON p.id = op.ptm_id AND p.mode = 'online'
    JOIN public.institutions i ON i.id = p.institution_id
    LEFT JOIN public.profiles tp ON tp.id = op.teacher_id
    LEFT JOIN public.ptm_bookings b ON b.ptm_id = p.id AND b.parent_id = v_uid AND b.cancelled_at IS NULL
    LEFT JOIN public.ptm_booking_meet m ON m.booking_id = b.id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN b.id IS NOT NULL
                  THEN (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
                  ELSE (p.scheduled_date + p.end_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
             END AS closes_at) x
   WHERE op.student_id = v_uid
     AND (_ptm_id IS NULL OR p.id = _ptm_id)
     AND p.institution_id = public.get_user_institution(v_uid)
     AND p.scheduled_date >= (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date - 7
   ORDER BY p.scheduled_date DESC, p.start_time DESC
   LIMIT 50;
END;
$$;

NOTIFY pgrst, 'reload schema';
