-- Online PTM by class, Together: the teachers of a class pick its students
-- (both formats, since naman-erp 17537a99), so the ptm_online_assigned a
-- Together teacher gets from create_online_ptm and set_ptm_online_class_sessions
-- now asks them to pick ("Online PTM: pick your students"). Bodies are the
-- live 20261006170000 ones with only that text changed.

CREATE OR REPLACE FUNCTION public.create_online_ptm(_institution_id uuid, _title text, _description text, _scheduled_date date, _start_time time without time zone, _end_time time without time zone, _slot_duration_minutes integer, _slot_buffer_minutes integer DEFAULT 5, _as_role text DEFAULT 'teacher'::text, _teacher_ids uuid[] DEFAULT NULL::uuid[], _student_ids uuid[] DEFAULT NULL::uuid[], _booking_cutoff_minutes integer DEFAULT 240, _feedback_edit_days integer DEFAULT 3, _teacher_windows jsonb DEFAULT NULL::jsonb, _online_format text DEFAULT 'separate'::text, _class_sessions jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_win jsonb;
  v_format text;
  v_sessions jsonb;
  r record;
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

  v_format := COALESCE(NULLIF(btrim(_online_format), ''), 'separate');
  IF v_format NOT IN ('separate', 'panel') THEN
    RAISE EXCEPTION 'Unknown format.' USING ERRCODE = '22023';
  END IF;
  IF _class_sessions IS NOT NULL AND jsonb_typeof(_class_sessions) = 'array' AND jsonb_array_length(_class_sessions) > 0 THEN
    IF _as_role = 'teacher' THEN
      RAISE EXCEPTION 'Classes are set by an admin or coordinator. A teacher''s online PTM has only you.'
        USING ERRCODE = 'P0001', HINT = 'ptm_teacher_fixed';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('class_id', s.class_id, 'start_time', s.start_time, 'end_time', s.end_time,
                                        'teacher_ids', to_jsonb(s.teacher_ids), 'student_ids', to_jsonb(s.student_ids)))
      INTO v_sessions FROM public._ptm_parse_class_sessions(_class_sessions) s;
  ELSIF v_format = 'panel' THEN
    RAISE EXCEPTION 'Together needs the classes and their teachers.' USING ERRCODE = 'P0001', HINT = 'ptm_sessions_invalid';
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
    IF v_sessions IS NOT NULL THEN
      -- By class: the teachers are every class's teachers together.
      SELECT array_agg(DISTINCT x.t::uuid ORDER BY x.t::uuid) INTO v_teachers
        FROM jsonb_array_elements(v_sessions) e CROSS JOIN LATERAL jsonb_array_elements_text(e->'teacher_ids') x(t);
      IF array_length(v_teachers, 1) > 100 THEN
        RAISE EXCEPTION 'Pick 100 teachers or fewer.' USING ERRCODE = '22023';
      END IF;
      SELECT string_agg(COALESCE(public._ptm_class_label((e->>'class_id')::uuid), 'A class'), ', ') INTO v_bad
        FROM jsonb_array_elements(v_sessions) e
       WHERE (e->>'class_id')::uuid NOT IN (SELECT h.class_id FROM public.ptm_classes_for_hat(v_uid, _as_role) h);
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'You can''t add these classes: %.', left(v_bad, 100)
          USING ERRCODE = 'P0001', HINT = 'ptm_scope_denied';
      END IF;
      SELECT pr.full_name, (e->>'class_id')::uuid AS class_id INTO r
        FROM jsonb_array_elements(v_sessions) e
        CROSS JOIN LATERAL jsonb_array_elements_text(e->'teacher_ids') x(t)
        LEFT JOIN public.profiles pr ON pr.id = x.t::uuid
       WHERE NOT public.is_class_teacher_of(x.t::uuid, (e->>'class_id')::uuid)
       LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION '% does not teach %.', COALESCE(left(r.full_name, 40), 'A teacher'),
          COALESCE(public._ptm_class_label(r.class_id), 'that class')
          USING ERRCODE = 'P0001', HINT = 'ptm_teacher_not_in_class';
      END IF;
      IF v_format = 'panel' THEN
        SELECT COALESCE(public._ptm_class_label((e->>'class_id')::uuid), 'that class') INTO v_bad
          FROM jsonb_array_elements(v_sessions) e
          CROSS JOIN LATERAL jsonb_array_elements_text(e->'student_ids') x(s)
         WHERE NOT public.has_role(x.s::uuid, 'student')
            OR public._ptm_pickable_class(x.s::uuid) IS DISTINCT FROM (e->>'class_id')::uuid
         LIMIT 1;
        IF v_bad IS NOT NULL THEN
          RAISE EXCEPTION 'Some of the picked students are not in %. Refresh the list and try again.', v_bad
            USING ERRCODE = 'P0001', HINT = 'ptm_not_your_class';
        END IF;
      END IF;
    ELSE
      SELECT array_agg(DISTINCT t ORDER BY t) INTO v_teachers FROM unnest(COALESCE(_teacher_ids, ARRAY[]::uuid[])) t WHERE t IS NOT NULL;
      IF v_teachers IS NULL THEN
        RAISE EXCEPTION 'Pick at least one teacher.' USING ERRCODE = '22023';
      END IF;
      IF array_length(v_teachers, 1) > 50 THEN
        RAISE EXCEPTION 'Pick 50 teachers or fewer.' USING ERRCODE = '22023';
      END IF;
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

  -- Shape first (no row written yet); the row trigger judges the hours.
  -- By class, the classes carry the hours and _teacher_windows is ignored.
  IF v_sessions IS NULL THEN
    SELECT jsonb_agg(jsonb_build_object('teacher_id', w.teacher_id, 'start_time', w.start_time, 'end_time', w.end_time))
      INTO v_win FROM public._ptm_parse_teacher_windows(_teacher_windows, v_teachers) w;
  END IF;

  INSERT INTO public.ptm_schedules
    (institution_id, title, description, scheduled_date, start_time, end_time, slot_duration_minutes,
     created_by, created_as_role, venue, scope_type, scope_wing_id, slot_booking_enabled,
     booking_cutoff_minutes, feedback_edit_days, mode, slot_buffer_minutes, online_format)
  VALUES (_institution_id, btrim(_title), NULLIF(btrim(COALESCE(_description, '')), ''), _scheduled_date,
          _start_time, _end_time, _slot_duration_minutes, v_uid, _as_role, NULL, 'class', NULL, true,
          v_cutoff, v_edit, 'online', v_buffer, v_format)
  RETURNING id INTO v_ptm;

  -- Classes first, so the PTM-level teacher rows below are judged per class.
  IF v_sessions IS NOT NULL THEN
    INSERT INTO public.ptm_online_class_sessions (ptm_id, class_id, start_time, end_time, added_by)
    SELECT v_ptm, (e->>'class_id')::uuid, (e->>'start_time')::time, (e->>'end_time')::time, v_uid
      FROM jsonb_array_elements(v_sessions) e;
  END IF;

  -- One sorted INSERT: the busy trigger asserts every teacher at once.
  INSERT INTO public.ptm_online_teachers (ptm_id, teacher_id, added_by, start_time, end_time)
  SELECT v_ptm, t, v_uid, (w->>'start_time')::time, (w->>'end_time')::time
    FROM unnest(v_teachers) t
    LEFT JOIN LATERAL (SELECT x FROM jsonb_array_elements(COALESCE(v_win, '[]'::jsonb)) x
                        WHERE (x->>'teacher_id')::uuid = t) wx(w) ON true
   ORDER BY t;

  IF v_sessions IS NOT NULL THEN
    -- The class seats: the busy guard and the one-class-at-a-time rule run here.
    INSERT INTO public.ptm_online_session_teachers (class_session_id, ptm_id, teacher_id, added_by)
    SELECT cs.id, v_ptm, x.t::uuid, v_uid
      FROM jsonb_array_elements(v_sessions) e
      JOIN public.ptm_online_class_sessions cs ON cs.ptm_id = v_ptm AND cs.class_id = (e->>'class_id')::uuid
      CROSS JOIN LATERAL jsonb_array_elements_text(e->'teacher_ids') x(t)
     ORDER BY x.t::uuid, cs.id;
    IF v_format = 'panel' THEN
      FOR r IN
        SELECT cs.id, cs.class_id, array_agg(x.s::uuid) AS students
          FROM jsonb_array_elements(v_sessions) e
          JOIN public.ptm_online_class_sessions cs ON cs.ptm_id = v_ptm AND cs.class_id = (e->>'class_id')::uuid
          CROSS JOIN LATERAL jsonb_array_elements_text(e->'student_ids') x(s)
         GROUP BY cs.id, cs.class_id
      LOOP
        INSERT INTO public.ptm_online_participants (ptm_id, student_id, teacher_id, class_id, class_session_id, added_by)
        SELECT v_ptm, s, NULL, r.class_id, r.id, v_uid FROM unnest(r.students) s;
        PERFORM public._ptm_fanout(v_ptm, 'ptm_online_invited', 'Online PTM',
          '"' || btrim(_title) || '" with ' || COALESCE(public._ptm_class_label(r.class_id), 'your class') || ' teachers on '
            || to_char(_scheduled_date, 'DD Mon') || '. Book your slot in the app.',
          r.students);
      END LOOP;
    END IF;
  END IF;

  IF _as_role = 'teacher' AND v_students IS NOT NULL THEN
    INSERT INTO public.ptm_online_participants (ptm_id, student_id, teacher_id, class_id, added_by)
    SELECT v_ptm, s, v_uid, public._ptm_pickable_class(s), v_uid FROM unnest(v_students) s;
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = v_uid;
    PERFORM public._ptm_fanout(v_ptm, 'ptm_online_invited', 'Online PTM',
      '"' || btrim(_title) || '" with ' || COALESCE(left(v_name, 60), 'your teacher') || ' on '
        || to_char(_scheduled_date, 'DD Mon') || '. Book your slot in the app.',
      v_students);
  ELSIF v_format = 'panel' THEN
    PERFORM public._ptm_fanout(v_ptm, 'ptm_online_assigned', 'Online PTM: pick your students',
      'You are a teacher in "' || btrim(_title) || '" on ' || to_char(_scheduled_date, 'DD Mon')
        || '. Open it and pick your class''s students; families then book a slot with all its teachers.',
      ARRAY(SELECT t FROM unnest(v_teachers) t WHERE t <> v_uid));
  ELSE
    PERFORM public._ptm_fanout(v_ptm, 'ptm_online_assigned', 'Online PTM: pick your students',
      'You are a teacher in "' || btrim(_title) || '" on ' || to_char(_scheduled_date, 'DD Mon')
        || '. Open it and pick the students you will meet.',
      ARRAY(SELECT t FROM unnest(v_teachers) t WHERE t <> v_uid));
  END IF;
  RETURN v_ptm;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ptm_online_class_sessions(_ptm_id uuid, _class_sessions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_hat text;
  v_new jsonb;
  v_refused jsonb := '[]'::jsonb;
  v_added integer := 0;
  v_removed integer := 0;
  v_hours integer := 0;
  v_seats integer := 0;
  v_before uuid[];
  v_new_teachers uuid[] := ARRAY[]::uuid[];
  v_new_sessions uuid[] := ARRAY[]::uuid[];
  r record;
  v_s time;
  v_e time;
  v_hint text;
  v_detail text;
  v_tid uuid;
  v_bad text;
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) OR v_p.mode <> 'online' THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.created_as_role = 'teacher' THEN
    RAISE EXCEPTION 'A teacher''s online PTM has only one teacher: you.' USING ERRCODE = 'P0001', HINT = 'ptm_teacher_fixed';
  END IF;
  IF public.is_institution_admin(v_uid, v_p.institution_id) THEN
    v_hat := 'admin';
  ELSIF v_p.created_by = v_uid AND v_p.created_as_role = 'coordinator'
        AND public._ptm_has_hat(v_uid, v_p.institution_id, 'coordinator') THEN
    v_hat := 'coordinator';
  ELSE
    RAISE EXCEPTION 'You can''t change the classes of this PTM.' USING ERRCODE = '42501';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF public._ptm_has_ended(_ptm_id) THEN
    RAISE EXCEPTION 'This meeting has already happened.' USING ERRCODE = '22023';
  END IF;
  IF NOT public._ptm_has_class_sessions(_ptm_id) THEN
    RAISE EXCEPTION 'This PTM was made without classes. Change its teachers instead.'
      USING ERRCODE = 'P0001', HINT = 'ptm_no_class_sessions';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('class_id', s.class_id, 'start_time', s.start_time, 'end_time', s.end_time,
                                      'teacher_ids', to_jsonb(s.teacher_ids)))
    INTO v_new FROM public._ptm_parse_class_sessions(_class_sessions) s;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'Keep at least one class.' USING ERRCODE = 'P0001', HINT = 'ptm_sessions_invalid';
  END IF;
  SELECT string_agg(COALESCE(public._ptm_class_label((e->>'class_id')::uuid), 'A class'), ', ') INTO v_bad
    FROM jsonb_array_elements(v_new) e
   WHERE NOT EXISTS (SELECT 1 FROM public.ptm_online_class_sessions cs
                      WHERE cs.ptm_id = _ptm_id AND cs.class_id = (e->>'class_id')::uuid)
     AND (e->>'class_id')::uuid NOT IN (SELECT h.class_id FROM public.ptm_classes_for_hat(v_uid, v_hat) h);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'You can''t add these classes: %.', left(v_bad, 100) USING ERRCODE = 'P0001', HINT = 'ptm_scope_denied';
  END IF;
  SELECT array_agg(ot.teacher_id) INTO v_before FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id;
  v_before := COALESCE(v_before, ARRAY[]::uuid[]);

  -- 1. Classes that go (refused while a family is booked in them).
  FOR r IN
    SELECT cs.id, cs.class_id FROM public.ptm_online_class_sessions cs
     WHERE cs.ptm_id = _ptm_id
       AND cs.class_id NOT IN (SELECT (e->>'class_id')::uuid FROM jsonb_array_elements(v_new) e)
     ORDER BY cs.class_id
  LOOP
    IF EXISTS (SELECT 1 FROM public.ptm_bookings b WHERE b.class_session_id = r.id AND b.cancelled_at IS NULL) THEN
      v_refused := v_refused || jsonb_build_object('class_id', r.class_id, 'class_name', public._ptm_class_label(r.class_id),
                                                   'teacher_id', NULL, 'full_name', NULL, 'reason', 'has_bookings');
    ELSE
      PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_uninvited', 'Online PTM changed',
        '"' || v_p.title || '": the meeting for ' || COALESCE(public._ptm_class_label(r.class_id), 'your class')
          || ' was removed. The school will tell you if a new one is set.',
        ARRAY(SELECT op.student_id FROM public.ptm_online_participants op WHERE op.class_session_id = r.id));
      SELECT count(*)::int INTO v_n FROM public.ptm_online_session_teachers st WHERE st.class_session_id = r.id;
      v_removed := v_removed + v_n;
      DELETE FROM public.ptm_online_class_sessions WHERE id = r.id;
    END IF;
  END LOOP;

  -- 2. Teachers who leave a class that stays (refused while booked with them).
  FOR r IN
    SELECT st.class_session_id, st.teacher_id, cs.class_id, pr.full_name
      FROM public.ptm_online_session_teachers st
      JOIN public.ptm_online_class_sessions cs ON cs.id = st.class_session_id
      JOIN jsonb_array_elements(v_new) e ON (e->>'class_id')::uuid = cs.class_id
      LEFT JOIN public.profiles pr ON pr.id = st.teacher_id
     WHERE st.ptm_id = _ptm_id
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(e->'teacher_ids') x(t) WHERE x.t::uuid = st.teacher_id)
     ORDER BY cs.class_id, st.teacher_id
  LOOP
    IF EXISTS (SELECT 1 FROM public.ptm_bookings b
                WHERE b.class_session_id = r.class_session_id AND b.teacher_id = r.teacher_id AND b.cancelled_at IS NULL) THEN
      v_refused := v_refused || jsonb_build_object('class_id', r.class_id, 'class_name', public._ptm_class_label(r.class_id),
                                                   'teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'has_bookings');
    ELSE
      PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_uninvited', 'Online PTM changed',
        '"' || v_p.title || '": your meeting with ' || COALESCE(left(r.full_name, 60), 'your teacher')
          || ' was removed. The school will tell you if a new one is set.',
        ARRAY(SELECT op.student_id FROM public.ptm_online_participants op
               WHERE op.class_session_id = r.class_session_id AND op.teacher_id = r.teacher_id));
      DELETE FROM public.ptm_online_participants
       WHERE class_session_id = r.class_session_id AND teacher_id = r.teacher_id;
      DELETE FROM public.ptm_online_session_teachers
       WHERE class_session_id = r.class_session_id AND teacher_id = r.teacher_id;
      v_removed := v_removed + 1;
    END IF;
  END LOOP;

  -- 3. New hours for classes that stay.
  FOR r IN
    SELECT cs.id, cs.class_id, cs.start_time AS old_s, cs.end_time AS old_e,
           (e->>'start_time')::time AS new_s, (e->>'end_time')::time AS new_e
      FROM public.ptm_online_class_sessions cs
      JOIN jsonb_array_elements(v_new) e ON (e->>'class_id')::uuid = cs.class_id
     WHERE cs.ptm_id = _ptm_id
     ORDER BY cs.class_id
  LOOP
    v_s := r.new_s;
    v_e := r.new_e;
    IF v_s = v_p.start_time AND v_e = v_p.end_time THEN
      v_s := NULL;  -- the meeting's own window
      v_e := NULL;
    END IF;
    CONTINUE WHEN v_s IS NOT DISTINCT FROM r.old_s AND v_e IS NOT DISTINCT FROM r.old_e;
    BEGIN
      UPDATE public.ptm_online_class_sessions SET start_time = v_s, end_time = v_e WHERE id = r.id;
      v_hours := v_hours + 1;
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_detail = PG_EXCEPTION_DETAIL;
      IF v_hint IS NULL OR v_hint NOT IN ('ptm_hours_has_bookings', 'ptm_teacher_busy', 'ptm_teacher_double_booked') THEN
        RAISE;
      END IF;
      v_tid := CASE WHEN v_hint <> 'ptm_hours_has_bookings' AND v_detail LIKE '{%'
                    THEN (v_detail::jsonb->>'teacher_id')::uuid END;
      v_refused := v_refused || jsonb_build_object('class_id', r.class_id, 'class_name', public._ptm_class_label(r.class_id),
                     'teacher_id', v_tid, 'full_name', (SELECT pr.full_name FROM public.profiles pr WHERE pr.id = v_tid),
                     'reason', CASE v_hint WHEN 'ptm_hours_has_bookings' THEN 'hours_has_bookings'
                                           WHEN 'ptm_teacher_busy' THEN 'busy' ELSE 'double_booked' END);
    END;
  END LOOP;

  -- 4. New classes.
  FOR r IN
    SELECT (e->>'class_id')::uuid AS class_id, (e->>'start_time')::time AS new_s, (e->>'end_time')::time AS new_e
      FROM jsonb_array_elements(v_new) e
     WHERE NOT EXISTS (SELECT 1 FROM public.ptm_online_class_sessions cs
                        WHERE cs.ptm_id = _ptm_id AND cs.class_id = (e->>'class_id')::uuid)
     ORDER BY 1
  LOOP
    INSERT INTO public.ptm_online_class_sessions (ptm_id, class_id, start_time, end_time, added_by)
    VALUES (_ptm_id, r.class_id, r.new_s, r.new_e, v_uid)
    RETURNING id INTO v_tid;
    v_new_sessions := v_new_sessions || v_tid;
  END LOOP;

  -- 5. Teachers who join a class (new or kept), each judged on its own.
  FOR r IN
    SELECT cs.id AS cs_id, cs.class_id, x.t::uuid AS teacher_id, pr.full_name, pr.is_active
      FROM jsonb_array_elements(v_new) e
      JOIN public.ptm_online_class_sessions cs ON cs.ptm_id = _ptm_id AND cs.class_id = (e->>'class_id')::uuid
      CROSS JOIN LATERAL jsonb_array_elements_text(e->'teacher_ids') x(t)
      LEFT JOIN public.profiles pr ON pr.id = x.t::uuid
     WHERE NOT EXISTS (SELECT 1 FROM public.ptm_online_session_teachers st
                        WHERE st.class_session_id = cs.id AND st.teacher_id = x.t::uuid)
     ORDER BY x.t::uuid, cs.class_id
  LOOP
    IF NOT public._ptm_has_hat(r.teacher_id, v_p.institution_id, 'teacher') OR r.is_active IS FALSE THEN
      v_refused := v_refused || jsonb_build_object('class_id', r.class_id, 'class_name', public._ptm_class_label(r.class_id),
                                                   'teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'not_a_teacher');
    ELSIF NOT public._ptm_teacher_in_hat_scope(v_uid, v_hat, r.teacher_id, v_p.institution_id) THEN
      v_refused := v_refused || jsonb_build_object('class_id', r.class_id, 'class_name', public._ptm_class_label(r.class_id),
                                                   'teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'out_of_scope');
    ELSIF NOT public.is_class_teacher_of(r.teacher_id, r.class_id) THEN
      v_refused := v_refused || jsonb_build_object('class_id', r.class_id, 'class_name', public._ptm_class_label(r.class_id),
                                                   'teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'not_in_class');
    ELSE
      BEGIN
        INSERT INTO public.ptm_online_teachers (ptm_id, teacher_id, added_by)
        VALUES (_ptm_id, r.teacher_id, v_uid)
        ON CONFLICT ON CONSTRAINT ptm_online_teachers_uniq DO NOTHING;
        INSERT INTO public.ptm_online_session_teachers (class_session_id, ptm_id, teacher_id, added_by)
        VALUES (r.cs_id, _ptm_id, r.teacher_id, v_uid);
        v_added := v_added + 1;
        IF NOT (r.teacher_id = ANY (v_before)) AND NOT (r.teacher_id = ANY (v_new_teachers)) THEN
          v_new_teachers := v_new_teachers || r.teacher_id;
        END IF;
      EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
        IF v_hint IS NULL OR v_hint NOT IN ('ptm_teacher_busy', 'ptm_teacher_double_booked') THEN
          RAISE;
        END IF;
        v_refused := v_refused || jsonb_build_object('class_id', r.class_id, 'class_name', public._ptm_class_label(r.class_id),
                       'teacher_id', r.teacher_id, 'full_name', r.full_name,
                       'reason', CASE v_hint WHEN 'ptm_teacher_busy' THEN 'busy' ELSE 'double_booked' END);
      END;
    END IF;
  END LOOP;

  -- 6. A class with no teacher left: a new one is dropped again (its
  --    refusals say why); one that was already there makes the call fail.
  FOR r IN
    SELECT cs.id, cs.class_id FROM public.ptm_online_class_sessions cs
     WHERE cs.ptm_id = _ptm_id
       AND NOT EXISTS (SELECT 1 FROM public.ptm_online_session_teachers st WHERE st.class_session_id = cs.id)
  LOOP
    IF r.id = ANY (v_new_sessions) THEN
      DELETE FROM public.ptm_online_class_sessions WHERE id = r.id;
    ELSE
      RAISE EXCEPTION '% would have no teacher. Keep one of its teachers.',
        COALESCE(public._ptm_class_label(r.class_id), 'A class') USING ERRCODE = 'P0001', HINT = 'ptm_sessions_invalid';
    END IF;
  END LOOP;

  -- 7. Teachers in no class any more leave the PTM.
  FOR r IN
    SELECT ot.teacher_id FROM public.ptm_online_teachers ot
     WHERE ot.ptm_id = _ptm_id
       AND NOT EXISTS (SELECT 1 FROM public.ptm_online_session_teachers st
                        WHERE st.ptm_id = _ptm_id AND st.teacher_id = ot.teacher_id)
  LOOP
    DELETE FROM public.ptm_notifications_sent
     WHERE ptm_id = _ptm_id AND recipient_id = r.teacher_id AND notification_type LIKE 'ptm_online_%assigned';
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_unassigned', 'Online PTM changed',
      'You are no longer a teacher in "' || v_p.title || '".', ARRAY[r.teacher_id]);
    DELETE FROM public.ptm_online_teachers WHERE ptm_id = _ptm_id AND teacher_id = r.teacher_id;
  END LOOP;

  -- 8. Teachers new to the PTM are told.
  IF cardinality(v_new_teachers) > 0 THEN
    DELETE FROM public.ptm_notifications_sent
     WHERE ptm_id = _ptm_id AND recipient_id = ANY (v_new_teachers) AND notification_type LIKE 'ptm_online_%assigned';
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_assigned', 'Online PTM: pick your students',
      'You are a teacher in "' || v_p.title || '" on ' || to_char(v_p.scheduled_date, 'DD Mon') || '. '
        || CASE WHEN v_p.online_format = 'panel'
                THEN 'Open it and pick your class''s students; families then book a slot with all its teachers.'
                ELSE 'Open it and pick the students you will meet.' END,
      ARRAY(SELECT t FROM unnest(v_new_teachers) t WHERE t <> v_uid));
  END IF;

  SELECT count(*)::int INTO v_seats FROM public.ptm_online_session_teachers st WHERE st.ptm_id = _ptm_id;
  RETURN jsonb_build_object('added', v_added, 'removed', v_removed, 'kept', v_seats - v_added,
                            'hours_changed', v_hours, 'refused', v_refused);
END;
$function$;

NOTIFY pgrst, 'reload schema';
