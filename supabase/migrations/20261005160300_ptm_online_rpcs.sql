-- Online (residential) PTM mode, part 4 of 4: the RPCs the frontend calls.
-- Spec section 5.4 (naman-erp 61a0087a), with these changes on review:
--  * ptm_online_pick_options returns ONE jsonb array, not rows: PostgREST cuts
--    a set-returning RPC at 1000 rows, and a teacher of many sections can have
--    more students.
--  * ptm_online_booking_grid and ptm_online_my_sessions also return
--    slot_starts_at / slot_ends_at (timestamptz, the slot in the school's
--    timezone).
--  * get_google_email() is new: the Google account is no longer on profiles.
--  * create_online_ptm returns the PTM it just made when the same creator sends
--    the same PTM again within a minute (a double tap must not notify twice).
-- All SECURITY DEFINER; REVOKE from PUBLIC and anon by exact signature.

-- ── helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ptm_has_google(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_google_accounts g WHERE g.user_id = _user);
$$;

-- Has the meeting ended (end time in the school's timezone)?
CREATE OR REPLACE FUNCTION public._ptm_has_ended(_ptm_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT now() >= (p.scheduled_date + p.end_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
    FROM public.ptm_schedules p JOIN public.institutions i ON i.id = p.institution_id
   WHERE p.id = _ptm_id;
$$;

-- A student who can be picked: active, the student role, exactly one class row.
CREATE OR REPLACE FUNCTION public._ptm_pickable_class(_student uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._ptm_student_class(_student)
   WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _student AND p.is_active IS NOT FALSE)
     AND public.has_role(_student, 'student');
$$;

-- Is _teacher in the scope of _user's hat? admin: any teacher of the school;
-- coordinator: a teacher row on a class in their wings; teacher: only self.
CREATE OR REPLACE FUNCTION public._ptm_teacher_in_hat_scope(_user uuid, _hat text, _teacher uuid, _inst uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE _hat
    WHEN 'admin' THEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _teacher AND p.institution_id = _inst)
    WHEN 'coordinator' THEN EXISTS (
      SELECT 1 FROM public.wing_assignments wa
        JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
        JOIN public.class_assignments ca ON ca.class_id = wcm.class_id AND ca.role = 'teacher'
       WHERE wa.user_id = _user AND ca.user_id = _teacher)
    WHEN 'teacher' THEN _teacher = _user
    ELSE false END;
$$;

-- ── Google account (private; never on profiles) ────────────────────────────
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
  SELECT g.google_email INTO v_email FROM public.user_google_accounts g WHERE g.user_id = v_target;
  RETURN v_email;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_google_email(_email text, _user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target uuid := COALESCE(_user_id, auth.uid());
  v_email text := lower(btrim(COALESCE(_email, '')));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF v_target = v_uid THEN
    IF public.has_role(v_uid, 'student') THEN
      RAISE EXCEPTION 'Only staff add a Google account for online PTMs.' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.is_institution_admin(v_uid, public.get_user_institution(v_target)) THEN
    RAISE EXCEPTION 'Only a school admin can set another person''s Google account.' USING ERRCODE = '42501';
  END IF;
  IF v_email = '' THEN
    DELETE FROM public.user_google_accounts WHERE user_id = v_target;
    RETURN;
  END IF;
  IF char_length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.user_google_accounts (user_id, google_email, updated_by, updated_at)
  VALUES (v_target, v_email, v_uid, now())
  ON CONFLICT (user_id) DO UPDATE
     SET google_email = EXCLUDED.google_email, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;

-- ── create ─────────────────────────────────────────────────────────────────
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
    IF NOT public._ptm_has_google(v_uid) THEN
      RAISE EXCEPTION 'Add your Google account email under Settings before scheduling an online PTM.'
        USING ERRCODE = 'P0001', HINT = 'ptm_teacher_no_google';
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
    SELECT string_agg(COALESCE(pr.full_name, 'A teacher'), ', ') INTO v_bad
      FROM unnest(v_teachers) t LEFT JOIN public.profiles pr ON pr.id = t
     WHERE NOT public._ptm_has_google(t);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '% has no Google account email yet. Ask them to add it under Settings first.', left(v_bad, 60)
        USING ERRCODE = 'P0001', HINT = 'ptm_teacher_no_google';
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

-- ── a teacher's student list ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_ptm_online_students(_ptm_id uuid, _student_ids uuid[], _teacher_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_teacher uuid := COALESCE(_teacher_id, auth.uid());
  v_desired uuid[];
  v_removed uuid[];
  v_added uuid[];
  v_refused jsonb := '[]'::jsonb;
  v_cancelled integer := 0;
  v_kept integer := 0;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) OR v_p.mode <> 'online' THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF public._ptm_has_ended(_ptm_id) THEN
    RAISE EXCEPTION 'This meeting has already happened.' USING ERRCODE = '22023';
  END IF;
  IF v_teacher <> v_uid AND NOT public.is_institution_admin(v_uid, v_p.institution_id) THEN
    RAISE EXCEPTION 'Only a school admin can change another teacher''s students.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id AND ot.teacher_id = v_teacher) THEN
    RAISE EXCEPTION 'You are not a teacher in this online PTM.' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT s) INTO v_desired FROM unnest(COALESCE(_student_ids, ARRAY[]::uuid[])) s WHERE s IS NOT NULL;
  v_desired := COALESCE(v_desired, ARRAY[]::uuid[]);
  IF array_length(v_desired, 1) > 2000 THEN
    RAISE EXCEPTION 'Pick 2000 students or fewer.' USING ERRCODE = '22023';
  END IF;

  -- Removed: their active booking is cancelled (and they are told) by the
  -- tg_ptm_online_participant_removed safety net.
  SELECT count(*)::int INTO v_cancelled
    FROM public.ptm_online_participants op
    JOIN public.ptm_bookings b ON b.ptm_id = op.ptm_id AND b.parent_id = op.student_id AND b.cancelled_at IS NULL
   WHERE op.ptm_id = _ptm_id AND op.teacher_id = v_teacher AND NOT (op.student_id = ANY (v_desired));
  WITH d AS (
    DELETE FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.teacher_id = v_teacher AND NOT (op.student_id = ANY (v_desired))
    RETURNING op.student_id)
  SELECT array_agg(student_id) INTO v_removed FROM d;

  SELECT count(*)::int INTO v_kept FROM public.ptm_online_participants op
   WHERE op.ptm_id = _ptm_id AND op.teacher_id = v_teacher;

  -- Refused before inserting: not a student, no single class, not this teacher's class.
  WITH cand AS (
    SELECT s AS student_id, public._ptm_pickable_class(s) AS class_id,
           public.has_role(s, 'student') AS is_student
      FROM unnest(v_desired) s
     WHERE NOT EXISTS (SELECT 1 FROM public.ptm_online_participants op
                        WHERE op.ptm_id = _ptm_id AND op.student_id = s AND op.teacher_id = v_teacher)
  ), judged AS (
    SELECT c.student_id, c.class_id,
           CASE WHEN NOT c.is_student THEN 'not_a_student'
                WHEN c.class_id IS NULL THEN 'no_single_class'
                WHEN c.class_id NOT IN (SELECT h.class_id FROM public.ptm_classes_for_hat(v_teacher, 'teacher') h)
                  THEN 'not_your_class'
           END AS reason
      FROM cand c
  ), ins AS (
    INSERT INTO public.ptm_online_participants (ptm_id, student_id, teacher_id, class_id, added_by)
    SELECT _ptm_id, j.student_id, v_teacher, j.class_id, v_uid FROM judged j WHERE j.reason IS NULL
    ON CONFLICT (ptm_id, student_id) DO NOTHING
    RETURNING student_id
  )
  SELECT array_agg(ins.student_id),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id', j.student_id,
                     'full_name', pr.full_name,
                     'reason', COALESCE(j.reason, 'taken')) ORDER BY pr.full_name)
                     FROM judged j LEFT JOIN public.profiles pr ON pr.id = j.student_id
                    WHERE j.reason IS NOT NULL
                       OR NOT EXISTS (SELECT 1 FROM ins i2 WHERE i2.student_id = j.student_id)), '[]'::jsonb)
    INTO v_added, v_refused
    FROM ins;

  IF v_added IS NOT NULL THEN
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = v_teacher;
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_invited', 'Online PTM',
      '"' || v_p.title || '" with ' || COALESCE(left(v_name, 60), 'your teacher') || ' on '
        || to_char(v_p.scheduled_date, 'DD Mon') || '. Book your slot in the app.',
      v_added);
  END IF;

  RETURN jsonb_build_object(
    'added', COALESCE(array_length(v_added, 1), 0),
    'removed', COALESCE(array_length(v_removed, 1), 0),
    'kept', v_kept,
    'cancelled_bookings', v_cancelled,
    'refused', v_refused);
END;
$$;

-- ── the teacher list (admin, or the coordinator who created it) ────────────
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
    ELSIF NOT public._ptm_has_google(r.teacher_id) THEN
      v_refused := v_refused || jsonb_build_object('teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'no_google_email');
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

-- ── hand one teacher's whole session to another (admin) ────────────────────
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
  IF NOT public._ptm_has_google(_to_teacher) THEN
    RAISE EXCEPTION '% has no Google account email yet. Ask them to add it under Settings first.',
      COALESCE(left(v_to_name, 60), 'That teacher') USING ERRCODE = 'P0001', HINT = 'ptm_teacher_no_google';
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

-- ── read RPCs ──────────────────────────────────────────────────────────────
-- Who a teacher may pick: every student of every class they teach (one jsonb
-- array, so PostgREST's 1000-row cap never truncates it; at most 2000).
CREATE OR REPLACE FUNCTION public.ptm_online_pick_options(_ptm_id uuid DEFAULT NULL, _teacher_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_teacher uuid := COALESCE(_teacher_id, auth.uid());
  v_inst uuid;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  v_inst := public.get_user_institution(v_uid);
  IF v_teacher <> v_uid AND NOT public.is_institution_admin(v_uid, v_inst) THEN
    RAISE EXCEPTION 'Only a school admin can pick for another teacher.' USING ERRCODE = '42501';
  END IF;
  IF NOT public._ptm_has_hat(v_teacher, v_inst, 'teacher') THEN
    RETURN '[]'::jsonb;
  END IF;
  IF _ptm_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.ptm_schedules p WHERE p.id = _ptm_id AND p.institution_id = v_inst AND p.mode = 'online') THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  WITH cls AS (
    SELECT h.class_id FROM public.ptm_classes_for_hat(v_teacher, 'teacher') h
  ), single AS (
    -- students with exactly one class row, that class being one of the teacher's
    SELECT ca.user_id, min(ca.class_id::text)::uuid AS class_id
      FROM public.class_assignments ca
     WHERE ca.role = 'student'
       AND ca.user_id IN (SELECT ca2.user_id FROM public.class_assignments ca2
                           WHERE ca2.role = 'student' AND ca2.class_id IN (SELECT class_id FROM cls))
     GROUP BY ca.user_id HAVING count(*) = 1
  ), opts AS (
    SELECT s.user_id AS student_id, pr.full_name, c.id AS class_id, c.name AS class_name, c.section AS class_section,
           CASE WHEN _ptm_id IS NULL OR op.student_id IS NULL THEN 'free'
                WHEN op.teacher_id = v_teacher THEN 'mine' ELSE 'taken' END AS state,
           CASE WHEN op.teacher_id IS NOT NULL AND op.teacher_id <> v_teacher THEN tp.full_name END AS taken_by_name,
           EXISTS (SELECT 1 FROM public.ptm_bookings b
                    WHERE _ptm_id IS NOT NULL AND b.ptm_id = _ptm_id AND b.parent_id = s.user_id
                      AND b.teacher_id = v_teacher AND b.cancelled_at IS NULL) AS booked
      FROM single s
      JOIN cls ON cls.class_id = s.class_id
      JOIN public.classes c ON c.id = s.class_id
      JOIN public.profiles pr ON pr.id = s.user_id AND pr.is_active IS NOT FALSE
      LEFT JOIN public.ptm_online_participants op ON op.ptm_id = _ptm_id AND op.student_id = s.user_id
      LEFT JOIN public.profiles tp ON tp.id = op.teacher_id
     WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = s.user_id AND r.role = 'student')
     ORDER BY c.name, c.section, pr.full_name
     LIMIT 2000
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(opts) ORDER BY opts.class_name, opts.class_section, opts.full_name), '[]'::jsonb)
    INTO v_out FROM opts;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_online_teacher_options(_as_role text)
RETURNS TABLE(teacher_id uuid, full_name text, has_google_email boolean, class_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  v_inst := public.get_user_institution(v_uid);
  IF _as_role IS NULL OR NOT public._ptm_has_hat(v_uid, v_inst, _as_role) THEN
    RAISE EXCEPTION 'You don''t hold that role at this school.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.full_name, public._ptm_has_google(pr.id),
         (SELECT count(DISTINCT ca.class_id)::int FROM public.class_assignments ca
            JOIN public.classes c ON c.id = ca.class_id AND c.is_active IS NOT FALSE
           WHERE ca.user_id = pr.id AND ca.role = 'teacher')
    FROM public.profiles pr
   WHERE pr.institution_id = v_inst AND pr.is_active IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pr.id AND r.role = 'teacher')
     AND public._ptm_teacher_in_hat_scope(v_uid, _as_role, pr.id, v_inst)
   ORDER BY pr.full_name
   LIMIT 500;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_online_sessions(_ptm_id uuid)
RETURNS TABLE(teacher_id uuid, teacher_name text, has_google_email boolean, student_count integer,
              booked_count integer, attended_count integer, meet_failed_count integer, is_me boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF public.has_role(v_uid, 'student') THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ptm_schedules p
                  WHERE p.id = _ptm_id AND p.mode = 'online' AND p.institution_id = public.get_user_institution(v_uid)) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT ot.teacher_id, pr.full_name, public._ptm_has_google(ot.teacher_id),
         (SELECT count(*)::int FROM public.ptm_online_participants op WHERE op.ptm_id = _ptm_id AND op.teacher_id = ot.teacher_id),
         (SELECT count(*)::int FROM public.ptm_bookings b
           WHERE b.ptm_id = _ptm_id AND b.teacher_id = ot.teacher_id AND b.cancelled_at IS NULL),
         (SELECT count(*)::int FROM public.ptm_bookings b
           WHERE b.ptm_id = _ptm_id AND b.teacher_id = ot.teacher_id AND b.cancelled_at IS NULL AND b.attended),
         (SELECT count(*)::int FROM public.ptm_bookings b
            JOIN public.ptm_booking_meet m ON m.booking_id = b.id
           WHERE b.ptm_id = _ptm_id AND b.teacher_id = ot.teacher_id AND b.cancelled_at IS NULL
             AND m.meet_uri IS NULL AND m.meet_attempts >= 5),
         ot.teacher_id = v_uid
    FROM public.ptm_online_teachers ot
    LEFT JOIN public.profiles pr ON pr.id = ot.teacher_id
   WHERE ot.ptm_id = _ptm_id
   ORDER BY (ot.teacher_id = v_uid) DESC, pr.full_name;
END;
$$;

-- One teacher's slots. Families see taken or free (no names) and their own
-- room; staff see names; the Meet link goes to the session teacher, the
-- creator and admins only.
CREATE OR REPLACE FUNCTION public.ptm_online_booking_grid(_ptm_id uuid, _teacher_id uuid DEFAULT NULL)
RETURNS TABLE(slot_time time, booking_id uuid, student_id uuid, student_name text, class_id uuid,
              class_name text, class_section text, attended boolean, is_mine boolean, meet_uri text,
              meet_ready boolean, off_grid boolean, slot_starts_at timestamptz, slot_ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_tz text;
  v_teacher uuid;
  v_student boolean := public.has_role(auth.uid(), 'student');
  v_links boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) OR v_p.mode <> 'online' THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_p.institution_id;
  IF v_student THEN
    SELECT op.teacher_id INTO v_teacher FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.student_id = v_uid;
    IF v_teacher IS NULL THEN
      RAISE EXCEPTION 'You are not on the list for this online meeting. Ask your teacher.'
        USING ERRCODE = 'P0001', HINT = 'ptm_not_participant';
    END IF;
  ELSE
    IF _teacher_id IS NULL THEN RAISE EXCEPTION 'Pick a teacher.' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id AND ot.teacher_id = _teacher_id) THEN
      RAISE EXCEPTION 'That teacher is not in this PTM.' USING ERRCODE = '22023';
    END IF;
    v_links := _teacher_id = v_uid OR public.is_institution_admin(v_uid, v_p.institution_id)
               OR public.can_manage_ptm(v_uid, _ptm_id);
    IF NOT (v_links OR (public._ptm_has_hat(v_uid, v_p.institution_id, 'coordinator') AND EXISTS (
              SELECT 1 FROM public.ptm_online_participants op
               WHERE op.ptm_id = _ptm_id AND op.teacher_id = _teacher_id
                 AND public.is_coordinator_for_class(v_uid, op.class_id)))) THEN
      RAISE EXCEPTION 'You can''t see this teacher''s session.' USING ERRCODE = '42501';
    END IF;
    v_teacher := _teacher_id;
  END IF;
  RETURN QUERY
  WITH slots AS (SELECT s AS t FROM public._ptm_slots(_ptm_id) s),
  bk AS (
    SELECT b.id, b.parent_id, b.slot_time, b.attended, b.class_id, m.meet_uri
      FROM public.ptm_bookings b
      LEFT JOIN public.ptm_booking_meet m ON m.booking_id = b.id
     WHERE b.ptm_id = _ptm_id AND b.teacher_id = v_teacher AND b.cancelled_at IS NULL
  ),
  joined AS (
    SELECT s.t AS st, bk.*, false AS og FROM slots s LEFT JOIN bk ON bk.slot_time = s.t
    UNION ALL
    SELECT bk.slot_time, bk.*, true FROM bk WHERE bk.slot_time NOT IN (SELECT t FROM slots)
  )
  SELECT j.st, j.id,
         CASE WHEN v_student THEN NULL ELSE j.parent_id END,
         CASE WHEN v_student THEN NULL ELSE pr.full_name END,
         CASE WHEN v_student THEN NULL ELSE j.class_id END,
         CASE WHEN v_student THEN NULL ELSE c.name END,
         CASE WHEN v_student THEN NULL ELSE c.section END,
         CASE WHEN v_student THEN NULL ELSE j.attended END,
         COALESCE(j.parent_id = v_uid, false),
         CASE WHEN (v_student AND j.parent_id = v_uid) OR (NOT v_student AND v_links) THEN j.meet_uri END,
         j.meet_uri IS NOT NULL,
         j.og,
         (v_p.scheduled_date + j.st) AT TIME ZONE v_tz,
         ((v_p.scheduled_date + j.st) + make_interval(mins => v_p.slot_duration_minutes)) AT TIME ZONE v_tz
    FROM joined j
    LEFT JOIN public.profiles pr ON pr.id = j.parent_id
    LEFT JOIN public.classes c ON c.id = j.class_id
   ORDER BY j.st;
END;
$$;

-- A family's online PTMs (from a week ago on): their teacher, their booking
-- and, once it exists, their room. Students only.
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
         m.meet_uri IS NOT NULL, w.booking_closes_at,
         (p.status = 'scheduled' AND now() < w.booking_closes_at),
         CASE WHEN b.id IS NOT NULL THEN (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') END,
         CASE WHEN b.id IS NOT NULL THEN ((p.scheduled_date + b.slot_time) + make_interval(mins => p.slot_duration_minutes))
                                         AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') END
    FROM public.ptm_online_participants op
    JOIN public.ptm_schedules p ON p.id = op.ptm_id AND p.mode = 'online'
    JOIN public.institutions i ON i.id = p.institution_id
    CROSS JOIN LATERAL public._ptm_window(p.id) w
    LEFT JOIN public.profiles tp ON tp.id = op.teacher_id
    LEFT JOIN public.ptm_bookings b ON b.ptm_id = p.id AND b.parent_id = v_uid AND b.cancelled_at IS NULL
    LEFT JOIN public.ptm_booking_meet m ON m.booking_id = b.id
   WHERE op.student_id = v_uid
     AND (_ptm_id IS NULL OR p.id = _ptm_id)
     AND p.institution_id = public.get_user_institution(v_uid)
     AND p.scheduled_date >= (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date - 7
   ORDER BY p.scheduled_date DESC, p.start_time DESC
   LIMIT 50;
END;
$$;

-- ── grants (by exact signature, CLAUDE.md 26) ──────────────────────────────
REVOKE ALL ON FUNCTION public._ptm_has_google(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ptm_has_ended(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ptm_pickable_class(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ptm_teacher_in_hat_scope(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_has_google(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._ptm_has_ended(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._ptm_pickable_class(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._ptm_teacher_in_hat_scope(uuid, text, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_google_email(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_google_email(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_online_ptm(uuid, text, text, date, time, time, integer, integer, text, uuid[], uuid[], integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ptm_online_students(uuid, uuid[], uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ptm_online_teachers(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.swap_ptm_online_teacher(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ptm_online_pick_options(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ptm_online_teacher_options(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ptm_online_sessions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ptm_online_booking_grid(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ptm_online_my_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_google_email(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_google_email(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_online_ptm(uuid, text, text, date, time, time, integer, integer, text, uuid[], uuid[], integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_ptm_online_students(uuid, uuid[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_ptm_online_teachers(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swap_ptm_online_teacher(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ptm_online_pick_options(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ptm_online_teacher_options(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ptm_online_sessions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ptm_online_booking_grid(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ptm_online_my_sessions(uuid) TO authenticated, service_role;

-- PostgREST: pick up the new tables and functions.
NOTIFY pgrst, 'reload schema';
