-- Online (residential) PTM mode, part 2 of 4: every reader that treated "zero
-- class rows" as "the whole school" now branches on ptm_schedules.mode. Spec
-- section 5.2. Bodies are the LIVE ones (pg_get_functiondef, 2026-10-05) with an
-- online branch added; the in-person path is unchanged except where marked.
--
-- One rule runs through it: a family's reach in an online PTM is its own row
-- in ptm_online_participants, never its class. Every student check goes
-- through _ptm_student_scope(), so a classmate who was not picked never sees,
-- books or gives feedback on someone else's online PTM.
--
-- In-person changes, all deliberate:
--  * book_ptm_slot raises its two "slot taken / already have a slot" errors as
--    P0001 with a HINT (were 23505): toastError mapped 23505 to the generic
--    "This already exists.", so families never saw the real message. Same text.
--  * ptm_send_day_before_reminders no longer reminds a teacher about a
--    cancelled booking.

-- ── slots and student scope ────────────────────────────────────────────────
-- Slot k = start + k * (duration + buffer) while it still ends by end_time.
-- With buffer 0 (every in-person PTM) this is exactly the old grid.
CREATE OR REPLACE FUNCTION public._ptm_slots(_ptm_id uuid)
RETURNS SETOF time
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (p.start_time + make_interval(mins => k * (p.slot_duration_minutes + p.slot_buffer_minutes)))::time
    FROM public.ptm_schedules p
    CROSS JOIN LATERAL generate_series(0, 299) AS k
   WHERE p.id = _ptm_id AND p.slot_duration_minutes > 0
     AND make_interval(mins => k * (p.slot_duration_minutes + p.slot_buffer_minutes) + p.slot_duration_minutes)
         <= (p.end_time - p.start_time)
   ORDER BY k;
$$;

CREATE OR REPLACE FUNCTION public._ptm_slot_ok(_ptm_id uuid, _slot time)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _slot IS NOT NULL AND EXISTS (SELECT 1 FROM public._ptm_slots(_ptm_id) s WHERE s = _slot);
$$;

-- A student's place in a PTM: in person, their one class if the PTM covers it;
-- online, their participant row (class at pick time, and their teacher).
-- Zero rows = out of scope.
CREATE OR REPLACE FUNCTION public._ptm_student_scope(_ptm_id uuid, _user uuid)
RETURNS TABLE(class_id uuid, teacher_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT op.class_id, op.teacher_id
    FROM public.ptm_schedules p
    JOIN public.ptm_online_participants op ON op.ptm_id = p.id AND op.student_id = _user
   WHERE p.id = _ptm_id AND p.mode = 'online'
  UNION ALL
  SELECT x.cls, NULL::uuid
    FROM public.ptm_schedules p
    CROSS JOIN LATERAL (SELECT public._ptm_student_class(_user) AS cls) x
   WHERE p.id = _ptm_id AND p.mode = 'in_person' AND x.cls IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(_ptm_id) e WHERE e.class_id = x.cls);
$$;

-- ── who a PTM covers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ptm_effective_class_ids(_ptm_id uuid)
RETURNS TABLE(class_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH p AS (SELECT s.id, s.institution_id, s.class_id, s.mode FROM public.ptm_schedules s WHERE s.id = _ptm_id),
  named AS (
    SELECT sc.class_id FROM public.ptm_schedule_classes sc JOIN p ON p.id = sc.ptm_id
    UNION
    SELECT p.class_id FROM p WHERE p.class_id IS NOT NULL
  )
  SELECT c.id FROM p JOIN public.classes c ON c.institution_id = p.institution_id
   WHERE p.mode = 'in_person' AND c.id IN (SELECT n.class_id FROM named n)
  UNION
  SELECT c.id FROM p JOIN public.classes c ON c.institution_id = p.institution_id AND c.is_active IS NOT FALSE
   WHERE p.mode = 'in_person' AND NOT EXISTS (SELECT 1 FROM named)
  UNION
  -- Online: the classes of its participants. Empty is empty, never the school.
  SELECT c.id FROM p
    JOIN public.ptm_online_participants op ON op.ptm_id = p.id
    JOIN public.classes c ON c.id = op.class_id AND c.institution_id = p.institution_id
   WHERE p.mode = 'online';
$$;

CREATE OR REPLACE FUNCTION public.ptm_includes_user_class(_ptm_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    CASE
      WHEN (SELECT ps.mode FROM public.ptm_schedules ps WHERE ps.id = _ptm_id) = 'online' THEN
        EXISTS (SELECT 1 FROM public.ptm_online_participants op
                 WHERE op.ptm_id = _ptm_id AND op.student_id = _user_id)
      WHEN NOT EXISTS (SELECT 1 FROM public.ptm_schedule_classes sc WHERE sc.ptm_id = _ptm_id)
       AND (SELECT ps.class_id FROM public.ptm_schedules ps WHERE ps.id = _ptm_id) IS NULL
      THEN true
      ELSE EXISTS (
        SELECT 1
          FROM public.class_assignments ca
         WHERE ca.user_id = _user_id
           AND (
             ca.class_id IN (SELECT sc.class_id FROM public.ptm_schedule_classes sc WHERE sc.ptm_id = _ptm_id)
             OR ca.class_id = (SELECT ps.class_id FROM public.ptm_schedules ps WHERE ps.id = _ptm_id)
           )
      )
    END
$$;

CREATE OR REPLACE FUNCTION public.ptm_audience(_ptm_id uuid)
RETURNS TABLE(user_id uuid, is_teacher boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ptm AS (
    SELECT id, institution_id, class_id, mode
      FROM public.ptm_schedules
     WHERE id = _ptm_id
  ),
  ptm_classes AS (
    SELECT sc.class_id
      FROM public.ptm_schedule_classes sc
      JOIN ptm ON ptm.id = sc.ptm_id
    UNION
    SELECT ptm.class_id
      FROM ptm
     WHERE ptm.class_id IS NOT NULL
  )
  SELECT a.user_id, bool_or(a.is_teacher) AS is_teacher
    FROM (
      -- In person, class-scoped: students + teachers of every class. Joined
      -- through classes so another institution's class can never resolve
      -- (a previously-fixed cross-tenant bug; do not regress).
      SELECT DISTINCT ca.user_id, (ca.role = 'teacher') AS is_teacher
        FROM ptm
        CROSS JOIN ptm_classes pc
        JOIN public.classes c            ON c.id = pc.class_id
                                        AND c.institution_id = ptm.institution_id
        JOIN public.class_assignments ca ON ca.class_id = c.id
        JOIN public.profiles p           ON p.id = ca.user_id
       WHERE ptm.mode = 'in_person'
         AND ca.role IN ('teacher', 'student')
         AND p.is_active IS NOT FALSE
         AND EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = ca.user_id AND ur.role = ca.role)
      UNION
      -- In person, school-wide: every student of the institution.
      SELECT s.student_id, false
        FROM ptm
       CROSS JOIN LATERAL public.institution_student_ids(ptm.institution_id) s
       WHERE ptm.mode = 'in_person' AND NOT EXISTS (SELECT 1 FROM ptm_classes)
      UNION
      -- In person, school-wide: every active teacher of an active class.
      SELECT DISTINCT ca.user_id, true
        FROM ptm
        JOIN public.classes c            ON c.institution_id = ptm.institution_id
        JOIN public.class_assignments ca ON ca.class_id = c.id
        JOIN public.profiles p           ON p.id = ca.user_id
       WHERE ptm.mode = 'in_person'
         AND NOT EXISTS (SELECT 1 FROM ptm_classes)
         AND ca.role = 'teacher'
         AND p.is_active IS NOT FALSE
         AND c.is_active IS NOT FALSE
         AND EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = ca.user_id AND ur.role = 'teacher')
      UNION
      -- Online: the picked students ...
      SELECT op.student_id, false
        FROM ptm
        JOIN public.ptm_online_participants op ON op.ptm_id = ptm.id
        JOIN public.profiles p ON p.id = op.student_id AND p.institution_id = ptm.institution_id
       WHERE ptm.mode = 'online' AND p.is_active IS NOT FALSE
         AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = op.student_id AND ur.role = 'student')
      UNION
      -- ... and the teachers running a session.
      SELECT ot.teacher_id, true
        FROM ptm
        JOIN public.ptm_online_teachers ot ON ot.ptm_id = ptm.id
        JOIN public.profiles p ON p.id = ot.teacher_id AND p.institution_id = ptm.institution_id
       WHERE ptm.mode = 'online' AND p.is_active IS NOT FALSE
         AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = ot.teacher_id AND ur.role = 'teacher')
    ) a
   GROUP BY a.user_id
$$;

-- ── who may manage or see ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_ptm(_user uuid, _ptm uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ptm_schedules p
     WHERE p.id = _ptm AND _user IS NOT NULL AND p.status <> 'cancelled'
       AND (
         public.is_institution_admin(_user, p.institution_id)
         OR (
           p.mode = 'in_person'
           AND public._ptm_has_hat(_user, p.institution_id, 'coordinator')
           AND p.scope_type IN ('wing', 'class')
           AND EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id))
           AND NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id) e
                            WHERE NOT public.is_coordinator_for_class(_user, e.class_id))
           AND (p.created_as_role = 'teacher'
                OR (p.created_as_role = 'coordinator' AND p.created_by = _user))
         )
         OR (
           p.mode = 'in_person'
           AND public._ptm_has_hat(_user, p.institution_id, 'teacher')
           AND p.scope_type = 'class' AND p.created_as_role = 'teacher' AND p.created_by = _user
           AND EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id))
           AND NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id) e
                            WHERE NOT public.is_class_teacher_of(_user, e.class_id))
         )
         -- Online: the creator under the hat they created it with (or an admin).
         -- A participating teacher edits only their own student list.
         OR (
           p.mode = 'online' AND p.created_by = _user
           AND public._ptm_has_hat(_user, p.institution_id, p.created_as_role)
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_ptm_feedback(_user uuid, _ptm uuid, _class uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ptm_schedules p
     WHERE p.id = _ptm AND _user IS NOT NULL AND _class IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id) e WHERE e.class_id = _class)
       AND (
         public.is_institution_admin(_user, p.institution_id)
         OR (public._ptm_has_hat(_user, p.institution_id, 'coordinator')
             AND public.is_coordinator_for_class(_user, _class))
         OR public.is_class_teacher_of(_user, _class)
         -- Online: the session teacher of a participant in that class (after a
         -- swap that teacher may not teach the class).
         OR (p.mode = 'online' AND EXISTS (
               SELECT 1 FROM public.ptm_online_participants op
                WHERE op.ptm_id = p.id AND op.teacher_id = _user AND op.class_id = _class))
       )
  );
$$;

-- ── notifications fan-out: dedupe suffix, link and metadata ────────────────
-- The claim key is (ptm, recipient, type[:suffix]); notifications.type stays
-- the bare type, which the bell's icons key on.
DROP FUNCTION IF EXISTS public._ptm_fanout(uuid, text, text, text, uuid[]);
CREATE FUNCTION public._ptm_fanout(
  _ptm_id uuid, _type text, _title text, _message text, _recipients uuid[],
  _dedupe_suffix text DEFAULT NULL, _link text DEFAULT NULL, _metadata jsonb DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_written integer := 0;
  v_key text := _type || COALESCE(':' || _dedupe_suffix, '');
BEGIN
  IF _recipients IS NULL OR array_length(_recipients, 1) IS NULL THEN
    RETURN 0;
  END IF;
  WITH claimed AS (
    INSERT INTO public.ptm_notifications_sent (ptm_id, recipient_id, notification_type)
    SELECT _ptm_id, r, v_key FROM unnest(_recipients) AS r WHERE r IS NOT NULL
    ON CONFLICT (ptm_id, recipient_id, notification_type) DO NOTHING
    RETURNING recipient_id
  ), written AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    SELECT c.recipient_id, _type, _title, _message,
           COALESCE(_link, '/school/communication?tab=ptm'),
           jsonb_build_object('ptm_id', _ptm_id) || COALESCE(_metadata, '{}'::jsonb)
      FROM claimed c
    RETURNING 1
  )
  SELECT count(*) INTO v_written FROM written;
  RETURN v_written;
END;
$$;
REVOKE ALL ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[], text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[], text, text, jsonb) TO service_role;

-- ── booking ────────────────────────────────────────────────────────────────
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
  IF now() >= (SELECT w.booking_closes_at FROM public._ptm_window(_ptm_id) w) THEN
    RAISE EXCEPTION 'Booking has closed for this meeting.' USING ERRCODE = '22023';
  END IF;
  IF NOT public._ptm_slot_ok(_ptm_id, _slot_time) THEN
    RAISE EXCEPTION 'That time is not one of the meeting''s slots.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_replace, false) THEN
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
  v_open := now() < (SELECT w.booking_closes_at FROM public._ptm_window(v_b.ptm_id) w);
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

CREATE OR REPLACE FUNCTION public.set_ptm_booking_attended(_booking_id uuid, _attended boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.ptm_bookings%ROWTYPE;
  v_inst uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_b FROM public.ptm_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND OR v_b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.mode = 'online' THEN
    -- Online: the session teacher, the creator, an admin, or the class's coordinator.
    SELECT p.institution_id INTO v_inst FROM public.ptm_schedules p WHERE p.id = v_b.ptm_id;
    IF NOT (v_b.teacher_id = v_uid
            OR public.can_manage_ptm(v_uid, v_b.ptm_id)
            OR public.is_institution_admin(v_uid, v_inst)
            OR (public._ptm_has_hat(v_uid, v_inst, 'coordinator')
                AND public.is_coordinator_for_class(v_uid, v_b.class_id))) THEN
      RAISE EXCEPTION 'You can''t mark attendance for this session.' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.can_view_ptm_feedback(v_uid, v_b.ptm_id, v_b.class_id) THEN
    RAISE EXCEPTION 'You can''t mark attendance for this class.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ptm_bookings SET attended = _attended WHERE id = _booking_id;
END;
$$;

-- The family's own bookings, now with their teacher and (online) their room.
DROP FUNCTION IF EXISTS public.ptm_my_bookings();
CREATE FUNCTION public.ptm_my_bookings()
RETURNS TABLE(ptm_id uuid, booking_id uuid, slot_time time without time zone, class_id uuid,
              teacher_id uuid, meet_uri text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.ptm_id, b.id, b.slot_time, b.class_id, b.teacher_id, m.meet_uri
    FROM public.ptm_bookings b
    JOIN public.ptm_schedules p ON p.id = b.ptm_id
    LEFT JOIN public.ptm_booking_meet m ON m.booking_id = b.id
   WHERE b.parent_id = auth.uid() AND b.cancelled_at IS NULL
   ORDER BY p.scheduled_date DESC, p.start_time DESC
   LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.ptm_my_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ptm_my_bookings() TO authenticated, service_role;

-- In-person grid; an online PTM is read per teacher through ptm_online_booking_grid.
CREATE OR REPLACE FUNCTION public.ptm_booking_grid(_ptm_id uuid, _class_id uuid)
RETURNS TABLE(slot_time time without time zone, booking_id uuid, student_id uuid, student_name text,
              attended boolean, is_mine boolean, off_grid boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_class uuid;
  v_student boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.mode = 'online' THEN
    RAISE EXCEPTION 'This is an online PTM. Open its sessions instead.'
      USING ERRCODE = 'P0001', HINT = 'ptm_online_grid';
  END IF;
  IF _class_id IS NULL THEN
    IF NOT public.has_role(v_uid, 'student') THEN
      RAISE EXCEPTION 'Pick a class.' USING ERRCODE = '22023';
    END IF;
    v_class := public._ptm_student_class(v_uid);
    IF v_class IS NULL THEN
      RAISE EXCEPTION 'Your class is not set up. Ask your school.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(_ptm_id) e WHERE e.class_id = v_class) THEN
      RAISE EXCEPTION 'This meeting is not for your class.' USING ERRCODE = '42501';
    END IF;
    v_student := true;
  ELSE
    IF NOT public.can_view_ptm_feedback(v_uid, _ptm_id, _class_id) THEN
      RAISE EXCEPTION 'You can''t see bookings for this class.' USING ERRCODE = '42501';
    END IF;
    v_class := _class_id;
  END IF;
  IF NOT v_p.slot_booking_enabled THEN
    RAISE EXCEPTION 'Slot booking is off for this meeting.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH slots AS (
    SELECT s AS t FROM public._ptm_slots(_ptm_id) s
  ),
  bk AS (
    SELECT b.id, b.parent_id, b.slot_time, b.attended
      FROM public.ptm_bookings b
     WHERE b.ptm_id = _ptm_id AND b.class_id = v_class AND b.cancelled_at IS NULL
  )
  SELECT s.t, bk.id,
         CASE WHEN v_student THEN NULL ELSE bk.parent_id END,
         CASE WHEN v_student THEN NULL ELSE pr.full_name END,
         CASE WHEN v_student THEN NULL ELSE bk.attended END,
         COALESCE(bk.parent_id = v_uid, false),
         false
    FROM slots s
    LEFT JOIN bk ON bk.slot_time = s.t
    LEFT JOIN public.profiles pr ON pr.id = bk.parent_id
  UNION ALL
  SELECT bk.slot_time, bk.id,
         CASE WHEN v_student THEN NULL ELSE bk.parent_id END,
         CASE WHEN v_student THEN NULL ELSE pr.full_name END,
         CASE WHEN v_student THEN NULL ELSE bk.attended END,
         bk.parent_id = v_uid,
         true
    FROM bk LEFT JOIN public.profiles pr ON pr.id = bk.parent_id
   WHERE bk.slot_time NOT IN (SELECT s.t FROM slots s)
  ORDER BY 1;
END;
$$;

-- ── editing ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ptm_schedule(_ptm_id uuid, _title text, _description text, _venue text, _scheduled_date date, _start_time time without time zone, _end_time time without time zone, _slot_booking_enabled boolean, _slot_duration_minutes integer, _booking_cutoff_minutes integer, _feedback_edit_days integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_booked integer;
  v_online boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  v_online := v_p.mode = 'online';
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_manage_ptm(v_uid, _ptm_id) THEN
    RAISE EXCEPTION 'You can''t change this PTM.' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR btrim(_title) = '' THEN
    RAISE EXCEPTION 'Give the PTM a title.' USING ERRCODE = '22023';
  END IF;
  IF _start_time IS NULL OR _end_time IS NULL OR _end_time <= _start_time THEN
    RAISE EXCEPTION 'The end time must be after the start time.' USING ERRCODE = '22023';
  END IF;
  IF v_online AND NOT COALESCE(_slot_booking_enabled, false) THEN
    RAISE EXCEPTION 'Slot booking is always on for an online PTM.'
      USING ERRCODE = 'P0001', HINT = 'ptm_online_booking_off';
  END IF;
  -- A legacy PTM may carry a duration outside 5..60 (one test row has 2);
  -- keeping it unchanged must not block every other edit.
  IF _slot_duration_minutes IS NULL
     OR (_slot_duration_minutes <> v_p.slot_duration_minutes AND _slot_duration_minutes NOT BETWEEN 5 AND 60) THEN
    RAISE EXCEPTION 'A slot must be 5 to 60 minutes long.' USING ERRCODE = '22023';
  END IF;
  IF _booking_cutoff_minutes NOT BETWEEN 0 AND 1440 THEN
    RAISE EXCEPTION 'The booking cutoff must be 0 to 1440 minutes.' USING ERRCODE = '22023';
  END IF;
  IF _feedback_edit_days NOT BETWEEN 0 AND 30 THEN
    RAISE EXCEPTION 'The feedback window must be 0 to 30 days.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_booked FROM public.ptm_bookings b
   WHERE b.ptm_id = _ptm_id AND b.cancelled_at IS NULL;
  IF v_booked > 0 AND (_slot_duration_minutes <> v_p.slot_duration_minutes
                       OR (v_p.slot_booking_enabled AND NOT _slot_booking_enabled)) THEN
    RAISE EXCEPTION '% booked. Cancel their slots first.',
      CASE WHEN v_booked = 1 THEN '1 family has' ELSE v_booked || ' families have' END
      USING ERRCODE = '22023';
  END IF;
  -- Online: no venue, booking always on, the gap is fixed at creation. A new
  -- date or time is checked against every teacher's other PTMs by the
  -- ptm_schedules_online_busy_guard trigger (part 3).
  UPDATE public.ptm_schedules
     SET title = btrim(_title),
         description = NULLIF(btrim(COALESCE(_description, '')), ''),
         venue = CASE WHEN v_online THEN NULL ELSE NULLIF(btrim(COALESCE(_venue, '')), '') END,
         scheduled_date = _scheduled_date,
         start_time = _start_time,
         end_time = _end_time,
         slot_booking_enabled = COALESCE(_slot_booking_enabled, false),
         slot_duration_minutes = _slot_duration_minutes,
         booking_cutoff_minutes = _booking_cutoff_minutes,
         feedback_edit_days = _feedback_edit_days,
         updated_at = now()
   WHERE id = _ptm_id;
END;
$$;

-- ── feedback context (two new output columns: mode, my_teacher_name) ───────
DROP FUNCTION IF EXISTS public.ptm_resolve_feedback_token(text);
DROP FUNCTION IF EXISTS public.ptm_open_for_feedback();
DROP FUNCTION IF EXISTS public._ptm_feedback_context(uuid, uuid);

CREATE FUNCTION public._ptm_feedback_context(_user uuid, _ptm_id uuid)
RETURNS TABLE(ptm_id uuid, title text, description text, venue text, scheduled_date date,
              start_time time without time zone, end_time time without time zone, status text,
              scope_type text, feedback_token text, feedback_edit_days integer, my_class_id uuid,
              my_class_name text, my_class_section text, class_teachers text, window_state text,
              opens_at timestamp with time zone, closes_at timestamp with time zone, my_feedback jsonb,
              mode text, my_teacher_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_student boolean := public.has_role(_user, 'student');
  v_class uuid;
  v_teacher uuid;
  v_teacher_name text;
BEGIN
  IF v_is_student THEN
    SELECT s.class_id, s.teacher_id INTO v_class, v_teacher FROM public._ptm_student_scope(_ptm_id, _user) s;
    IF v_class IS NULL THEN
      RETURN;  -- not in scope: indistinguishable from "no such meeting"
    END IF;
    IF v_teacher IS NOT NULL THEN
      SELECT pr.full_name INTO v_teacher_name FROM public.profiles pr WHERE pr.id = v_teacher;
    END IF;
  END IF;
  RETURN QUERY
  SELECT p.id, p.title, p.description, p.venue, p.scheduled_date, p.start_time, p.end_time,
         p.status, p.scope_type, p.feedback_token, p.feedback_edit_days,
         CASE WHEN v_is_student THEN c.id END,
         CASE WHEN v_is_student THEN c.name END,
         CASE WHEN v_is_student THEN c.section END,
         CASE WHEN NOT v_is_student THEN NULL
              WHEN p.mode = 'online' THEN v_teacher_name
              ELSE public._ptm_class_teacher_names(v_class) END,
         w.window_state, w.opens_at, w.closes_at,
         CASE WHEN v_is_student THEN (
           SELECT jsonb_build_object('id', f.id, 'rating', f.rating, 'text_message', f.text_message,
                    'audio_path', f.audio_path, 'audio_duration_seconds', f.audio_duration_seconds,
                    'audio_format', f.audio_format, 'submitted_at', f.submitted_at, 'updated_at', f.updated_at)
             FROM public.ptm_feedback f WHERE f.ptm_id = p.id AND f.student_id = _user) END,
         p.mode,
         CASE WHEN v_is_student THEN v_teacher_name END
    FROM public.ptm_schedules p
    CROSS JOIN LATERAL public._ptm_window(p.id) w
    LEFT JOIN public.classes c ON c.id = v_class
   WHERE p.id = _ptm_id
     AND p.institution_id = public.get_user_institution(_user);
END;
$$;
REVOKE ALL ON FUNCTION public._ptm_feedback_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_feedback_context(uuid, uuid) TO service_role;

CREATE FUNCTION public.ptm_resolve_feedback_token(_token text)
RETURNS TABLE(ptm_id uuid, title text, description text, venue text, scheduled_date date,
              start_time time without time zone, end_time time without time zone, status text,
              scope_type text, feedback_token text, feedback_edit_days integer, my_class_id uuid,
              my_class_name text, my_class_section text, class_teachers text, window_state text,
              opens_at timestamp with time zone, closes_at timestamp with time zone, my_feedback jsonb,
              mode text, my_teacher_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ptm uuid;
BEGIN
  IF v_uid IS NULL OR _token IS NULL OR char_length(_token) > 128 THEN RETURN; END IF;
  SELECT s.id INTO v_ptm FROM public.ptm_schedules s
   WHERE s.feedback_token = _token AND s.institution_id = public.get_user_institution(v_uid);
  IF v_ptm IS NULL THEN RETURN; END IF;  -- unknown token and "not yours" look the same
  RETURN QUERY SELECT * FROM public._ptm_feedback_context(v_uid, v_ptm);
END;
$$;
REVOKE ALL ON FUNCTION public.ptm_resolve_feedback_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ptm_resolve_feedback_token(text) TO authenticated, service_role;

CREATE FUNCTION public.ptm_open_for_feedback()
RETURNS TABLE(ptm_id uuid, title text, description text, venue text, scheduled_date date,
              start_time time without time zone, end_time time without time zone, status text,
              scope_type text, feedback_token text, feedback_edit_days integer, my_class_id uuid,
              my_class_name text, my_class_section text, class_teachers text, window_state text,
              opens_at timestamp with time zone, closes_at timestamp with time zone, my_feedback jsonb,
              mode text, my_teacher_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r record;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'student') THEN RETURN; END IF;
  FOR r IN
    SELECT s.id FROM public.ptm_schedules s
     WHERE s.institution_id = public.get_user_institution(v_uid)
       AND s.status = 'scheduled'
       AND EXISTS (SELECT 1 FROM public._ptm_student_scope(s.id, v_uid))
       AND (SELECT w.window_state FROM public._ptm_window(s.id) w) = 'open'
     ORDER BY s.scheduled_date DESC, s.start_time DESC
     LIMIT 20
  LOOP
    RETURN QUERY SELECT * FROM public._ptm_feedback_context(v_uid, r.id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ptm_open_for_feedback() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ptm_open_for_feedback() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_ptm_feedback(_ptm_id uuid, _rating integer, _text text, _audio_path text, _audio_duration_seconds integer, _audio_format text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text;
  v_class uuid;
  v_state text;
  v_text text := NULLIF(btrim(COALESCE(_text, '')), '');
  v_prev text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_role(v_uid, 'student') THEN
    RAISE EXCEPTION 'Feedback is given from the student''s account.' USING ERRCODE = '42501';
  END IF;
  SELECT s.mode INTO v_mode FROM public.ptm_schedules s
   WHERE s.id = _ptm_id AND s.institution_id = public.get_user_institution(v_uid);
  IF v_mode IS DISTINCT FROM 'online' AND public._ptm_student_class(v_uid) IS NULL THEN
    RAISE EXCEPTION 'Your class is not set up. Ask your school.' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT s.class_id INTO v_class FROM public._ptm_student_scope(_ptm_id, v_uid) s;
  IF v_class IS NULL THEN
    IF v_mode = 'online' THEN
      RAISE EXCEPTION 'You are not on the list for this online meeting. Ask your teacher.'
        USING ERRCODE = 'P0001', HINT = 'ptm_not_participant';
    END IF;
    RAISE EXCEPTION 'This meeting is not for your class.' USING ERRCODE = '42501';
  END IF;
  SELECT w.window_state INTO v_state FROM public._ptm_window(_ptm_id) w;
  IF v_state = 'cancelled' THEN
    RAISE EXCEPTION 'This meeting was cancelled.' USING ERRCODE = '22023';
  ELSIF v_state = 'not_open' THEN
    RAISE EXCEPTION 'Feedback opens when the meeting starts.' USING ERRCODE = '22023';
  ELSIF v_state = 'closed' THEN
    RAISE EXCEPTION 'Feedback for this meeting has closed.' USING ERRCODE = '22023';
  END IF;
  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Pick a rating from 1 to 5.' USING ERRCODE = '22023';
  END IF;
  IF v_text IS NOT NULL AND char_length(v_text) > 1000 THEN
    RAISE EXCEPTION 'Keep the message under 1000 characters.' USING ERRCODE = '22023';
  END IF;
  IF _audio_path IS NOT NULL THEN
    IF _audio_path NOT LIKE _ptm_id::text || '/' || v_uid::text || '/%' THEN
      RAISE EXCEPTION 'That recording does not belong to you.' USING ERRCODE = '42501';
    END IF;
    IF _audio_duration_seconds IS NULL OR _audio_duration_seconds NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'A voice note can be up to 2 minutes long.' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT f.audio_path INTO v_prev FROM public.ptm_feedback f
   WHERE f.ptm_id = _ptm_id AND f.student_id = v_uid;
  INSERT INTO public.ptm_feedback (ptm_id, student_id, class_id, submitted_by, rating, text_message,
                                   audio_path, audio_duration_seconds, audio_format)
  VALUES (_ptm_id, v_uid, v_class, v_uid, _rating, v_text, _audio_path,
          CASE WHEN _audio_path IS NOT NULL THEN _audio_duration_seconds END,
          CASE WHEN _audio_path IS NOT NULL THEN _audio_format END)
  ON CONFLICT (ptm_id, student_id) DO UPDATE
     SET class_id = EXCLUDED.class_id, submitted_by = EXCLUDED.submitted_by,
         rating = EXCLUDED.rating, text_message = EXCLUDED.text_message,
         audio_path = EXCLUDED.audio_path, audio_duration_seconds = EXCLUDED.audio_duration_seconds,
         audio_format = EXCLUDED.audio_format, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('feedback_id', v_id,
                            'previous_audio_path', CASE WHEN v_prev IS DISTINCT FROM _audio_path THEN v_prev END);
END;
$$;

-- ── dashboard: online counts are per participant and per teacher ───────────
CREATE OR REPLACE FUNCTION public.ptm_feedback_summary(_ptm_id uuid, _as_role text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_classes uuid[];
  v_slots integer;
  v_teachers integer := 0;
  v_online boolean;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id;
  v_online := v_p.mode = 'online';
  SELECT COALESCE(array_agg(d.class_id), ARRAY[]::uuid[]) INTO v_classes
    FROM public._ptm_dashboard_classes(v_uid, _ptm_id, _as_role) d;
  v_slots := CASE WHEN v_p.slot_booking_enabled
                  THEN (SELECT count(*)::int FROM public._ptm_slots(_ptm_id))
                  ELSE 0 END;
  IF v_online THEN
    SELECT count(*)::int INTO v_teachers FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id;
  END IF;
  WITH cls AS (
    SELECT c.id, c.name, c.section FROM public.classes c WHERE c.id = ANY (v_classes)
  ),
  stu AS (
    -- In person: everyone in the class. Online: only the picked students.
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int AS n
      FROM public.class_assignments ca
      JOIN public.profiles pr ON pr.id = ca.user_id AND pr.is_active IS NOT FALSE
     WHERE NOT v_online AND ca.class_id = ANY (v_classes) AND ca.role = 'student'
       AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ca.user_id AND r.role = 'student')
     GROUP BY ca.class_id
    UNION ALL
    SELECT op.class_id, count(DISTINCT op.student_id)::int
      FROM public.ptm_online_participants op
     WHERE v_online AND op.ptm_id = _ptm_id AND op.class_id = ANY (v_classes)
     GROUP BY op.class_id
  ),
  fb AS (
    SELECT f.class_id, f.rating FROM public.ptm_feedback f
     WHERE f.ptm_id = _ptm_id AND f.class_id = ANY (v_classes)
  ),
  bk AS (
    SELECT b.class_id, count(*)::int AS booked, count(*) FILTER (WHERE b.attended)::int AS attended
      FROM public.ptm_bookings b
     WHERE b.ptm_id = _ptm_id AND b.class_id = ANY (v_classes) AND b.cancelled_at IS NULL
     GROUP BY b.class_id
  ),
  per_class AS (
    SELECT c.id, c.name, c.section, COALESCE(s.n, 0) AS students,
           (SELECT count(*)::int FROM fb WHERE fb.class_id = c.id) AS responses,
           (SELECT round(avg(fb.rating)::numeric, 1) FROM fb WHERE fb.class_id = c.id) AS avg_rating,
           COALESCE(b.booked, 0) AS booked, COALESCE(b.attended, 0) AS attended
      FROM cls c LEFT JOIN stu s ON s.class_id = c.id LEFT JOIN bk b ON b.class_id = c.id
  )
  SELECT jsonb_build_object(
    'students_in_scope', COALESCE((SELECT sum(students) FROM per_class), 0)::int,
    'responses', (SELECT count(*)::int FROM fb),
    'response_rate', CASE WHEN COALESCE((SELECT sum(students) FROM per_class), 0) = 0 THEN 0
                          ELSE round((SELECT count(*) FROM fb) * 100.0 / (SELECT sum(students) FROM per_class), 1) END,
    'avg_rating', (SELECT round(avg(rating)::numeric, 1) FROM fb),
    'distribution', jsonb_build_object(
       '1', (SELECT count(*) FROM fb WHERE rating = 1), '2', (SELECT count(*) FROM fb WHERE rating = 2),
       '3', (SELECT count(*) FROM fb WHERE rating = 3), '4', (SELECT count(*) FROM fb WHERE rating = 4),
       '5', (SELECT count(*) FROM fb WHERE rating = 5)),
    'per_class', COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'class_id', pc.id, 'class_name', pc.name, 'class_section', pc.section,
         'class_teachers', CASE WHEN v_online THEN NULL ELSE public._ptm_class_teacher_names(pc.id) END,
         'students', pc.students, 'responses', pc.responses, 'avg_rating', pc.avg_rating)
         ORDER BY pc.name, pc.section) FROM per_class pc), '[]'::jsonb),
    'bookings', jsonb_build_object(
       'enabled', v_p.slot_booking_enabled,
       -- In person every class has its own grid; online every teacher does.
       'total_slots', CASE WHEN v_online THEN v_slots * v_teachers
                           ELSE v_slots * (SELECT count(*) FROM per_class)::int END,
       'booked', COALESCE((SELECT sum(booked) FROM per_class), 0)::int,
       'attended', COALESCE((SELECT sum(attended) FROM per_class), 0)::int,
       'per_class', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'class_id', pc.id,
            'total_slots', CASE WHEN v_online THEN pc.students ELSE v_slots END,
            'booked', pc.booked, 'attended', pc.attended)
            ORDER BY pc.name, pc.section) FROM per_class pc), '[]'::jsonb))
  ) INTO v_res;
  RETURN v_res;
END;
$$;

-- ── notification triggers and the reminder cron ────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_notify_scheduled()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- The actor never notifies themselves. auth.uid() is NULL for a
  -- service-role or script write, hence the created_by fallback.
  v_actor uuid;
  v_class text;
BEGIN
  -- Assigned here, not in DECLARE: a DECLARE initializer runs before this
  -- block's own EXCEPTION handler is established.
  v_actor := COALESCE(auth.uid(), NEW.created_by);
  SELECT ' for ' || c.name || COALESCE(' ' || c.section, '')
    INTO v_class
    FROM public.classes c
   WHERE c.id = NEW.class_id;
  PERFORM public._ptm_fanout(
    NEW.id,
    'ptm_scheduled',
    CASE WHEN NEW.mode = 'online' THEN 'Online PTM scheduled' ELSE 'PTM scheduled' END,
    '"' || NEW.title || '"' || COALESCE(v_class, '') || ' on '
      || to_char(NEW.scheduled_date, 'DD Mon YYYY') || ', '
      || to_char(NEW.start_time, 'HH24:MI') || ' to '
      || to_char(NEW.end_time,   'HH24:MI') || '.',
    -- Online: the teachers only; families hear through ptm_online_invited.
    ARRAY(SELECT a.user_id FROM public.ptm_audience(NEW.id) a
           WHERE a.user_id IS DISTINCT FROM v_actor
             AND (NEW.mode = 'in_person' OR a.is_teacher))
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ptm notify failed for ptm %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_send_day_before_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r       record;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT ps.id, ps.title, ps.start_time, ps.end_time
      FROM public.ptm_schedules ps
      JOIN public.institutions  i ON i.id = ps.institution_id
     WHERE ps.status = 'scheduled'
       -- CLAUDE.md 24: "tomorrow" is per institution.
       AND ps.scheduled_date
           = (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date + 1
  LOOP
    v_total := v_total + public._ptm_fanout(
      r.id,
      'ptm_reminder',
      'PTM tomorrow',
      '"' || r.title || '" is tomorrow, '
        || to_char(r.start_time, 'HH24:MI') || ' to '
        || to_char(r.end_time,   'HH24:MI') || '.',
      -- Students in scope, plus ONLY the teachers somebody actually booked.
      ARRAY(
        SELECT a.user_id FROM public.ptm_audience(r.id) a WHERE a.is_teacher = false
        UNION
        SELECT b.teacher_id FROM public.ptm_bookings b
         WHERE b.ptm_id = r.id AND b.cancelled_at IS NULL AND b.teacher_id IS NOT NULL
      )
    );
  END LOOP;
  RETURN v_total;
END;
$$;

-- ── removing a participant cancels their booking (one mechanism for the RPC,
--    a teacher removal, a profile delete and a PTM delete) ──────────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_online_participant_removed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_b record;
  v_title text;
BEGIN
  FOR v_b IN
    UPDATE public.ptm_bookings
       SET cancelled_at = now(), status = 'cancelled'
     WHERE ptm_id = OLD.ptm_id AND parent_id = OLD.student_id AND cancelled_at IS NULL AND mode = 'online'
    RETURNING id, slot_time
  LOOP
    SELECT p.title INTO v_title FROM public.ptm_schedules p WHERE p.id = OLD.ptm_id;
    PERFORM public._ptm_fanout(OLD.ptm_id, 'ptm_booking_cancelled', 'PTM slot cancelled',
      'Your ' || to_char(v_b.slot_time, 'HH24:MI') || ' slot for "' || COALESCE(v_title, 'the PTM')
        || '" was cancelled because you are no longer on its list.',
      ARRAY[OLD.student_id], v_b.id::text, NULL, jsonb_build_object('booking_id', v_b.id));
  END LOOP;
  -- So a re-add invites again.
  DELETE FROM public.ptm_notifications_sent
   WHERE ptm_id = OLD.ptm_id AND recipient_id = OLD.student_id AND notification_type = 'ptm_online_invited';
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ptm participant cleanup failed for ptm %: % (%)', OLD.ptm_id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS tg_ptm_online_participant_removed ON public.ptm_online_participants;
CREATE TRIGGER tg_ptm_online_participant_removed AFTER DELETE ON public.ptm_online_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_online_participant_removed();

-- ── grants for the new internal helpers ────────────────────────────────────
REVOKE ALL ON FUNCTION public._ptm_slots(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_slots(uuid) TO service_role;
REVOKE ALL ON FUNCTION public._ptm_slot_ok(uuid, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_slot_ok(uuid, time) TO service_role;
REVOKE ALL ON FUNCTION public._ptm_student_scope(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_student_scope(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.tg_ptm_online_participant_removed() FROM PUBLIC, anon, authenticated;
