-- Online PTM by class, Together ('panel') is ONE grid for the whole PTM
-- (NEEDS DB in naman-erp 08f1675e, 2026-10-07).
--
-- Families of every chosen class book one shared set of slots (the meeting's),
-- one family per slot across the PTM, and every teacher of the PTM is in every
-- family's room. So, for online_format = 'panel':
--   * capacity: one active booking per (ptm_id, slot_time) across all classes
--     (index ptm_bookings_one_per_panel_slot replaces ..._one_per_session_slot);
--   * a class session has no hours of its own (stored NULL whatever is sent);
--   * a teacher may sit in any number of its classes (no one-class-at-a-time
--     check; the busy guard against other PTMs still applies);
--   * ptm_online_booking_grid returns the PTM-wide grid (every booking, meet_uri
--     to every teacher of the PTM, the admin and the manager); no class or
--     teacher argument is needed;
--   * every teacher of the PTM may cancel a booking, mark attendance and read
--     the PTM's feedback; ptm_slot_booked / ptm_slot_cancelled, the day-before
--     reminder and the 15-minute reminder go to every teacher of the PTM;
--   * ptm_online_my_sessions.teacher_name and the family's reminder name the
--     PTM's teachers ("A, B and 2 more");
--   * ptm_feedback_summary.bookings.total_slots is the meeting's slot count.
-- Separately is unchanged.

-- ── 1. capacity across the whole PTM ───────────────────────────────────────
UPDATE public.ptm_online_class_sessions cs SET start_time = NULL, end_time = NULL
  FROM public.ptm_schedules p
 WHERE p.id = cs.ptm_id AND p.online_format = 'panel' AND cs.start_time IS NOT NULL;
DROP INDEX IF EXISTS public.ptm_bookings_one_per_session_slot;
CREATE UNIQUE INDEX IF NOT EXISTS ptm_bookings_one_per_panel_slot ON public.ptm_bookings (ptm_id, slot_time)
  WHERE cancelled_at IS NULL AND mode = 'online' AND teacher_id IS NULL AND class_session_id IS NOT NULL;

-- ── 2. helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ptm_is_ptm_teacher(_ptm_id uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id AND ot.teacher_id = _user);
$$;
REVOKE ALL ON FUNCTION public._ptm_is_ptm_teacher(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_is_ptm_teacher(uuid, uuid) TO service_role;

-- "Meera Nair, Ravi Kumar and 2 more": the teachers of an online PTM.
CREATE OR REPLACE FUNCTION public._ptm_teacher_names(_ptm_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NULLIF(public._ptm_name_list(array_agg(COALESCE(pr.full_name, 'A teacher') ORDER BY pr.full_name)), '')
    FROM public.ptm_online_teachers ot
    LEFT JOIN public.profiles pr ON pr.id = ot.teacher_id
   WHERE ot.ptm_id = _ptm_id;
$$;
REVOKE ALL ON FUNCTION public._ptm_teacher_names(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_teacher_names(uuid) TO service_role;

-- ── 3. no hours and no one-class-at-a-time rule for Together ───────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_online_class_sessions_hours()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p public.ptm_schedules%ROWTYPE;
  v_label text;
  v_names text[];
BEGIN
  -- CLAUDE.md 21: never in the way of an account delete's SET NULL.
  IF TG_OP = 'UPDATE' AND public.is_user_delete_cascade_update(TG_RELID::regclass, to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.ptm_id IS DISTINCT FROM OLD.ptm_id OR NEW.class_id IS DISTINCT FROM OLD.class_id) THEN
    RAISE EXCEPTION 'A class session cannot move to another PTM or class.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = NEW.ptm_id;
  IF v_p.mode IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'Class sessions are for an online PTM.' USING ERRCODE = '22023';
  END IF;
  IF v_p.online_format = 'panel' THEN
    -- Together runs one grid for the whole PTM: a class has no hours of its own.
    NEW.start_time := NULL;
    NEW.end_time := NULL;
    RETURN NEW;
  END IF;
  v_label := COALESCE(public._ptm_class_label(NEW.class_id), 'A class');
  IF NEW.start_time IS NOT NULL THEN
    IF NEW.start_time = v_p.start_time AND NEW.end_time = v_p.end_time THEN
      NEW.start_time := NULL;  -- the meeting's own window
      NEW.end_time := NULL;
    ELSE
      IF NEW.start_time < v_p.start_time OR NEW.end_time > v_p.end_time THEN
        RAISE EXCEPTION '%: the hours must be within the meeting, % to %.',
          v_label, to_char(v_p.start_time, 'HH24:MI'), to_char(v_p.end_time, 'HH24:MI')
          USING ERRCODE = 'P0001', HINT = 'ptm_hours_outside';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public._ptm_slot_series(NEW.start_time, NEW.end_time,
                                                           v_p.slot_duration_minutes, v_p.slot_buffer_minutes)) THEN
        RAISE EXCEPTION '%: the hours are shorter than one slot.', v_label
          USING ERRCODE = 'P0001', HINT = 'ptm_hours_outside';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- A booked slot that was on the class's grid must still be on it.
    SELECT array_agg(COALESCE(pr.full_name, 'A family') ORDER BY b.slot_time) INTO v_names
      FROM public.ptm_bookings b
      LEFT JOIN public.profiles pr ON pr.id = b.parent_id
     WHERE b.class_session_id = NEW.id AND b.cancelled_at IS NULL
       AND b.slot_time IN (SELECT s.slot FROM public._ptm_slot_series(COALESCE(OLD.start_time, v_p.start_time),
                                 COALESCE(OLD.end_time, v_p.end_time), v_p.slot_duration_minutes, v_p.slot_buffer_minutes) s)
       AND b.slot_time NOT IN (SELECT s.slot FROM public._ptm_slot_series(COALESCE(NEW.start_time, v_p.start_time),
                                 COALESCE(NEW.end_time, v_p.end_time), v_p.slot_duration_minutes, v_p.slot_buffer_minutes) s);
    IF v_names IS NOT NULL THEN
      RAISE EXCEPTION '% booked outside those hours: %. Move or cancel their slots first.',
        CASE WHEN cardinality(v_names) = 1 THEN '1 family has' ELSE cardinality(v_names) || ' families have' END,
        left(public._ptm_name_list(v_names), 90)
        USING ERRCODE = 'P0001', HINT = 'ptm_hours_has_bookings';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._ptm_assert_no_double_booking(_ptm_id uuid, _teacher_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hit record;
  v_name text;
BEGIN
  -- Together: one grid for the whole PTM, so a teacher in several of its classes is in one room at a time.
  IF EXISTS (SELECT 1 FROM public.ptm_schedules p WHERE p.id = _ptm_id AND p.online_format = 'panel') THEN
    RETURN;
  END IF;
  SELECT a.class_id AS a_class, b.class_id AS b_class INTO v_hit
    FROM public.ptm_schedules p
    JOIN public.ptm_online_session_teachers sa ON sa.ptm_id = p.id AND sa.teacher_id = _teacher_id
    JOIN public.ptm_online_class_sessions a ON a.id = sa.class_session_id
    JOIN public.ptm_online_session_teachers sb ON sb.ptm_id = p.id AND sb.teacher_id = _teacher_id
                                              AND sb.class_session_id > sa.class_session_id
    JOIN public.ptm_online_class_sessions b ON b.id = sb.class_session_id
   WHERE p.id = _ptm_id
     AND (date '2000-01-01' + COALESCE(a.start_time, p.start_time))
         < (date '2000-01-01' + COALESCE(b.end_time, p.end_time)) + make_interval(mins => p.slot_buffer_minutes)
     AND (date '2000-01-01' + COALESCE(b.start_time, p.start_time))
         < (date '2000-01-01' + COALESCE(a.end_time, p.end_time)) + make_interval(mins => p.slot_buffer_minutes)
   LIMIT 1;
  IF FOUND THEN
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = _teacher_id;
    RAISE EXCEPTION '% is in % and % at the same time. Change one class''s hours or teachers.',
      left(COALESCE(v_name, 'A teacher'), 40), COALESCE(public._ptm_class_label(v_hit.a_class), 'one class'),
      COALESCE(public._ptm_class_label(v_hit.b_class), 'another')
      USING ERRCODE = 'P0001', HINT = 'ptm_teacher_double_booked',
            DETAIL = json_build_object('teacher_id', _teacher_id)::text;
  END IF;
END;
$function$;

-- ── 4. the PTM-wide grid ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ptm_online_booking_grid(_ptm_id uuid, _teacher_id uuid DEFAULT NULL::uuid, _class_session_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(slot_time time without time zone, booking_id uuid, student_id uuid, student_name text, class_id uuid, class_name text, class_section text, attended boolean, is_mine boolean, meet_uri text, meet_ready boolean, off_grid boolean, slot_starts_at timestamp with time zone, slot_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_tz text;
  v_teacher uuid;
  v_cs uuid;
  v_cs_class uuid;
  v_n integer;
  v_panel boolean;
  v_student boolean := public.has_role(auth.uid(), 'student');
  v_links boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) OR v_p.mode <> 'online' THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  v_panel := v_p.online_format = 'panel';
  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_p.institution_id;
  IF v_student THEN
    SELECT op.teacher_id, op.class_session_id INTO v_teacher, v_cs FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.student_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'You are not on the list for this online meeting. Ask your teacher.'
        USING ERRCODE = 'P0001', HINT = 'ptm_not_participant';
    END IF;
  ELSE
    IF NOT v_panel AND _class_session_id IS NOT NULL THEN
      SELECT cs.class_id INTO v_cs_class FROM public.ptm_online_class_sessions cs
       WHERE cs.id = _class_session_id AND cs.ptm_id = _ptm_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'That class is not in this PTM.' USING ERRCODE = '22023'; END IF;
      v_cs := _class_session_id;
    END IF;
    IF v_panel THEN
      -- Together: one grid for the whole PTM; the class and teacher arguments are not needed.
      v_links := public._ptm_is_ptm_teacher(_ptm_id, v_uid) OR public.is_institution_admin(v_uid, v_p.institution_id)
                 OR public.can_manage_ptm(v_uid, _ptm_id);
      IF NOT (v_links OR (public._ptm_has_hat(v_uid, v_p.institution_id, 'coordinator') AND EXISTS (
                SELECT 1 FROM public.ptm_online_class_sessions cs
                 WHERE cs.ptm_id = _ptm_id AND public.is_coordinator_for_class(v_uid, cs.class_id)))) THEN
        RAISE EXCEPTION 'You can''t see this PTM''s sessions.' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF _teacher_id IS NULL THEN RAISE EXCEPTION 'Pick a teacher.' USING ERRCODE = '22023'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id AND ot.teacher_id = _teacher_id) THEN
        RAISE EXCEPTION 'That teacher is not in this PTM.' USING ERRCODE = '22023';
      END IF;
      IF v_cs IS NOT NULL AND NOT public._ptm_is_session_teacher(v_cs, _teacher_id) THEN
        RAISE EXCEPTION 'That teacher is not in that class.' USING ERRCODE = '22023';
      END IF;
      v_links := _teacher_id = v_uid OR public.is_institution_admin(v_uid, v_p.institution_id)
                 OR public.can_manage_ptm(v_uid, _ptm_id);
      IF NOT (v_links OR (public._ptm_has_hat(v_uid, v_p.institution_id, 'coordinator') AND (
                (v_cs_class IS NOT NULL AND public.is_coordinator_for_class(v_uid, v_cs_class))
                OR EXISTS (SELECT 1 FROM public.ptm_online_participants op
                            WHERE op.ptm_id = _ptm_id AND op.teacher_id = _teacher_id
                              AND public.is_coordinator_for_class(v_uid, op.class_id))))) THEN
        RAISE EXCEPTION 'You can''t see this teacher''s session.' USING ERRCODE = '42501';
      END IF;
      v_teacher := _teacher_id;
    END IF;
  END IF;
  IF v_panel THEN
    -- Together: the meeting's slots and every family's booking, whoever asks.
    v_teacher := NULL;
    v_cs := NULL;
  END IF;
  RETURN QUERY
  WITH slots AS (
    SELECT s AS t FROM public._ptm_slots(_ptm_id) s WHERE v_panel
    UNION ALL
    SELECT s AS t FROM public._ptm_session_slots(v_cs) s WHERE NOT v_panel AND v_cs IS NOT NULL
    UNION ALL
    SELECT s AS t FROM public._ptm_slots(_ptm_id, v_teacher) s WHERE NOT v_panel AND v_cs IS NULL
  ),
  bk AS (
    SELECT b.id, b.parent_id, b.slot_time, b.attended, b.class_id, m.meet_uri
      FROM public.ptm_bookings b
      LEFT JOIN public.ptm_booking_meet m ON m.booking_id = b.id
     WHERE b.ptm_id = _ptm_id AND b.cancelled_at IS NULL
       AND CASE WHEN v_panel THEN b.teacher_id IS NULL AND b.class_session_id IS NOT NULL
                ELSE b.teacher_id IS NOT DISTINCT FROM v_teacher AND (v_cs IS NULL OR b.class_session_id = v_cs) END
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
$function$;

-- ── 5. every teacher of the PTM acts for and hears about Together bookings ─
CREATE OR REPLACE FUNCTION public.book_ptm_slot(_ptm_id uuid, _slot_time time without time zone, _replace boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_class uuid;
  v_teacher uuid;
  v_id uuid;
  v_con text;
  v_name text;
  v_tz text;
  v_cs uuid;
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
    SELECT op.class_id, op.teacher_id, op.class_session_id INTO v_class, v_teacher, v_cs
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
  IF v_p.mode = 'online' AND v_cs IS NOT NULL THEN
    -- A PTM by class: the class's hours.
    IF NOT public._ptm_session_slot_ok(v_cs, _slot_time) THEN
      RAISE EXCEPTION 'That time is not one of this class''s slots.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_p.mode = 'online' THEN
    IF NOT public._ptm_slot_ok(_ptm_id, _slot_time, v_teacher) THEN
      RAISE EXCEPTION 'That time is not one of this teacher''s slots.' USING ERRCODE = '22023';
    END IF;
  ELSIF NOT public._ptm_slot_ok(_ptm_id, _slot_time) THEN
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
    INSERT INTO public.ptm_bookings (ptm_id, parent_id, class_id, slot_time, status, teacher_id, class_session_id)
    VALUES (_ptm_id, v_uid, v_class, _slot_time, 'booked', v_teacher, v_cs)
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
        || to_char(_slot_time, 'HH24:MI') || '. Join from the app when your slot starts.',
      ARRAY[v_uid], v_id::text, NULL, jsonb_build_object('booking_id', v_id));
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_slot_booked', 'PTM slot booked',
      COALESCE(left(v_name, 60), 'A family') || ' booked ' || to_char(_slot_time, 'HH24:MI') || ' on '
        || to_char(v_p.scheduled_date, 'DD Mon') || ' for "' || v_p.title || '".',
      -- Together: every teacher of the PTM.
      CASE WHEN v_teacher IS NOT NULL THEN ARRAY[v_teacher]
           ELSE ARRAY(SELECT ot.teacher_id FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id) END,
      v_id::text, NULL, jsonb_build_object('booking_id', v_id));
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_ptm_booking(_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       OR (v_b.mode = 'online' AND (v_b.teacher_id = v_uid
                                    OR (v_b.teacher_id IS NULL AND public._ptm_is_ptm_teacher(v_b.ptm_id, v_uid))))
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
        CASE WHEN v_b.teacher_id IS NOT NULL THEN ARRAY[v_b.teacher_id]
             ELSE ARRAY(SELECT ot.teacher_id FROM public.ptm_online_teachers ot
                         WHERE ot.ptm_id = v_b.ptm_id) END,
        v_b.id::text, NULL, jsonb_build_object('booking_id', v_b.id));
    ELSE
      PERFORM public._ptm_fanout(v_b.ptm_id, 'ptm_booking_cancelled', 'PTM slot cancelled',
        'Your ' || to_char(v_b.slot_time, 'HH24:MI') || ' slot for "' || v_p.title
          || '" was cancelled by the school. Pick another slot if one is free.',
        ARRAY[v_b.parent_id], v_b.id::text, NULL, jsonb_build_object('booking_id', v_b.id));
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ptm_booking_attended(_booking_id uuid, _attended boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
            OR (v_b.teacher_id IS NULL AND public._ptm_is_ptm_teacher(v_b.ptm_id, v_uid))
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
$function$;

CREATE OR REPLACE FUNCTION public.can_view_ptm_feedback(_user uuid, _ptm uuid, _class uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         -- Together: every teacher of the PTM, for every class in it.
         OR (p.mode = 'online' AND p.online_format = 'panel' AND EXISTS (
               SELECT 1 FROM public.ptm_online_teachers ot WHERE ot.ptm_id = p.id AND ot.teacher_id = _user))
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.ptm_online_my_sessions(_ptm_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ptm_id uuid, teacher_id uuid, teacher_name text, class_id uuid, booking_id uuid, slot_time time without time zone, meet_uri text, meet_ready boolean, booking_closes_at timestamp with time zone, can_change boolean, slot_starts_at timestamp with time zone, slot_ends_at timestamp with time zone, teacher_start_time time without time zone, teacher_end_time time without time zone, class_session_id uuid, session_start_time time without time zone, session_end_time time without time zone, format text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'student') THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, op.teacher_id,
         -- Together: every teacher of the PTM ("Meera Nair, Ravi Kumar and 2 more").
         CASE WHEN op.teacher_id IS NULL AND op.class_session_id IS NOT NULL
              THEN COALESCE(public._ptm_teacher_names(op.ptm_id), 'Your teachers')
              ELSE tp.full_name END,
         op.class_id, b.id, b.slot_time, m.meet_uri,
         m.meet_uri IS NOT NULL, x.closes_at,
         (p.status = 'scheduled' AND now() < x.closes_at),
         CASE WHEN b.id IS NOT NULL THEN (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') END,
         CASE WHEN b.id IS NOT NULL THEN ((p.scheduled_date + b.slot_time) + make_interval(mins => p.slot_duration_minutes))
                                         AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') END,
         ot.start_time, ot.end_time,
         op.class_session_id, cs.start_time, cs.end_time, p.online_format
    FROM public.ptm_online_participants op
    JOIN public.ptm_schedules p ON p.id = op.ptm_id AND p.mode = 'online'
    JOIN public.institutions i ON i.id = p.institution_id
    LEFT JOIN public.profiles tp ON tp.id = op.teacher_id
    LEFT JOIN public.ptm_online_teachers ot ON ot.ptm_id = op.ptm_id AND ot.teacher_id = op.teacher_id
    LEFT JOIN public.ptm_online_class_sessions cs ON cs.id = op.class_session_id
    LEFT JOIN public.ptm_bookings b ON b.ptm_id = p.id AND b.parent_id = v_uid AND b.cancelled_at IS NULL
    LEFT JOIN public.ptm_booking_meet m ON m.booking_id = b.id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN b.id IS NOT NULL
                  THEN (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
                  ELSE (p.scheduled_date + COALESCE(cs.end_time, ot.end_time, p.end_time)) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
             END AS closes_at) x
   WHERE op.student_id = v_uid
     AND (_ptm_id IS NULL OR p.id = _ptm_id)
     AND p.institution_id = public.get_user_institution(v_uid)
     AND p.scheduled_date >= (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date - 7
   ORDER BY p.scheduled_date DESC, p.start_time DESC
   LIMIT 50;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ptm_feedback_summary(_ptm_id uuid, _as_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_classes uuid[];
  v_slots integer;
  v_teachers integer := 0;
  v_online_slots integer := 0;
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
    -- Every teacher has their own grid (their own hours, else the meeting's).
    IF v_p.online_format = 'panel' THEN
      -- Together: one grid for the whole PTM.
      SELECT count(*)::int INTO v_online_slots FROM public._ptm_slots(_ptm_id);
    ELSIF public._ptm_has_class_sessions(_ptm_id) THEN
      -- By class: Separately every teacher of a class has its grid.
      SELECT COALESCE(sum((SELECT count(*) FROM public._ptm_session_slots(cs.id))
                          * CASE WHEN v_p.online_format = 'panel' THEN 1
                                 ELSE (SELECT count(*) FROM public.ptm_online_session_teachers st
                                        WHERE st.class_session_id = cs.id) END), 0)::int
        INTO v_online_slots FROM public.ptm_online_class_sessions cs WHERE cs.ptm_id = _ptm_id;
    ELSE
      SELECT COALESCE(sum((SELECT count(*) FROM public._ptm_slots(_ptm_id, ot.teacher_id))), 0)::int INTO v_online_slots
        FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id;
    END IF;
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
       'total_slots', CASE WHEN v_online THEN v_online_slots
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
$function$;

-- ── 6. reminders ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ptm_send_15m_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT b.id, b.ptm_id, b.parent_id, b.teacher_id, b.class_session_id, b.class_id, b.slot_time, p.title,
           tp.full_name AS teacher_name
      FROM public.ptm_schedules p
      JOIN public.institutions i ON i.id = p.institution_id
      JOIN public.ptm_bookings b ON b.ptm_id = p.id
      LEFT JOIN public.profiles tp ON tp.id = b.teacher_id
     WHERE p.mode = 'online' AND p.status = 'scheduled'
       AND p.scheduled_date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1 AND (now() AT TIME ZONE 'UTC')::date + 1
       AND b.mode = 'online' AND b.cancelled_at IS NULL
       -- CLAUDE.md 24: the slot is wall-clock time in the school's timezone.
       AND (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
           BETWEEN now() AND now() + interval '15 minutes'
     ORDER BY b.ptm_id, b.slot_time
  LOOP
    v_total := v_total + public._ptm_fanout(r.ptm_id, 'ptm_reminder_15m', 'Online PTM soon',
      '"' || left(r.title, 60) || '" with '
        || COALESCE(left(r.teacher_name, 60),
                    CASE WHEN r.class_session_id IS NOT NULL THEN left(public._ptm_teacher_names(r.ptm_id), 80) END,
                    'your teacher')
        || ' starts at ' || to_char(r.slot_time, 'HH24:MI') || '. Join from the app.',
      ARRAY[r.parent_id], r.id::text, NULL, jsonb_build_object('booking_id', r.id));
    -- Each teacher once per PTM, before their first booked slot (Together:
    -- every teacher of the PTM, before its first booked slot).
    v_total := v_total + public._ptm_fanout(r.ptm_id, 'ptm_reminder_15m', 'Online PTM soon',
      'Your first online meeting in "' || left(r.title, 60) || '" starts at ' || to_char(r.slot_time, 'HH24:MI') || '.',
      ARRAY(SELECT x.tid
              FROM (SELECT r.teacher_id AS tid WHERE r.teacher_id IS NOT NULL
                    UNION
                    SELECT ot.teacher_id FROM public.ptm_online_teachers ot
                     WHERE r.teacher_id IS NULL AND r.class_session_id IS NOT NULL AND ot.ptm_id = r.ptm_id) x
             WHERE r.slot_time = (SELECT min(b2.slot_time) FROM public.ptm_bookings b2
                                   WHERE b2.ptm_id = r.ptm_id AND b2.cancelled_at IS NULL
                                     AND (b2.teacher_id = x.tid
                                          OR (b2.teacher_id IS NULL AND b2.class_session_id IS NOT NULL)))));
  END LOOP;
  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ptm_send_day_before_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        UNION
        -- Together: every teacher of the PTM once any family has booked.
        SELECT ot.teacher_id FROM public.ptm_online_teachers ot
         WHERE ot.ptm_id = r.id AND EXISTS (
                 SELECT 1 FROM public.ptm_bookings b
                  WHERE b.ptm_id = r.id AND b.cancelled_at IS NULL AND b.teacher_id IS NULL
                    AND b.class_session_id IS NOT NULL)
      )
    );
  END LOOP;
  RETURN v_total;
END;
$function$;

-- ── 7. the words ──────────────────────────────────────────────────────────
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
          '"' || btrim(_title) || '" with your teachers on '
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
        || '. Open it and pick your class''s students; families of all its classes then book one shared set of slots.',
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
                THEN 'Open it and pick your class''s students; families of all its classes then book one shared set of slots.'
                ELSE 'Open it and pick the students you will meet.' END,
      ARRAY(SELECT t FROM unnest(v_new_teachers) t WHERE t <> v_uid));
  END IF;

  SELECT count(*)::int INTO v_seats FROM public.ptm_online_session_teachers st WHERE st.ptm_id = _ptm_id;
  RETURN jsonb_build_object('added', v_added, 'removed', v_removed, 'kept', v_seats - v_added,
                            'hours_changed', v_hours, 'refused', v_refused);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ptm_online_students(_ptm_id uuid, _student_ids uuid[], _teacher_id uuid DEFAULT NULL::uuid, _class_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_owner uuid;
  v_sessions uuid[];
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
  -- A PTM by class: the list is per class session. Together: the class's
  -- one list (no teacher on the rows), set by an admin, the PTM's manager or
  -- any teacher of the class. Separately: that teacher's students, from the
  -- classes they sit in. _class_session_id narrows it to one class.
  IF public._ptm_has_class_sessions(_ptm_id) THEN
    IF _class_session_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.ptm_online_class_sessions cs WHERE cs.id = _class_session_id AND cs.ptm_id = _ptm_id) THEN
      RAISE EXCEPTION 'That class is not in this PTM.' USING ERRCODE = '22023';
    END IF;
    IF v_p.online_format = 'panel' THEN
      v_owner := NULL;
      IF _class_session_id IS NOT NULL THEN
        IF NOT (public.is_institution_admin(v_uid, v_p.institution_id) OR public.can_manage_ptm(v_uid, _ptm_id)
                OR public._ptm_is_session_teacher(_class_session_id, v_uid)) THEN
          RAISE EXCEPTION 'You can''t change the students of this class.' USING ERRCODE = '42501';
        END IF;
        v_sessions := ARRAY[_class_session_id];
      ELSE
        SELECT array_agg(st.class_session_id) INTO v_sessions
          FROM public.ptm_online_session_teachers st WHERE st.ptm_id = _ptm_id AND st.teacher_id = v_uid;
        IF v_sessions IS NULL THEN
          RAISE EXCEPTION 'Pick a class.' USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSE
      IF v_teacher <> v_uid AND NOT public.is_institution_admin(v_uid, v_p.institution_id) THEN
        RAISE EXCEPTION 'Only a school admin can change another teacher''s students.' USING ERRCODE = '42501';
      END IF;
      SELECT array_agg(st.class_session_id) INTO v_sessions
        FROM public.ptm_online_session_teachers st
       WHERE st.ptm_id = _ptm_id AND st.teacher_id = v_teacher
         AND (_class_session_id IS NULL OR st.class_session_id = _class_session_id);
      IF v_sessions IS NULL THEN
        RAISE EXCEPTION 'You are not a teacher of that class in this online PTM.' USING ERRCODE = '42501';
      END IF;
      v_owner := v_teacher;
    END IF;

    SELECT array_agg(DISTINCT s) INTO v_desired FROM unnest(COALESCE(_student_ids, ARRAY[]::uuid[])) s WHERE s IS NOT NULL;
    v_desired := COALESCE(v_desired, ARRAY[]::uuid[]);
    IF array_length(v_desired, 1) > 2000 THEN
      RAISE EXCEPTION 'Pick 2000 students or fewer.' USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::int INTO v_cancelled
      FROM public.ptm_online_participants op
      JOIN public.ptm_bookings b ON b.ptm_id = op.ptm_id AND b.parent_id = op.student_id AND b.cancelled_at IS NULL
     WHERE op.ptm_id = _ptm_id AND op.class_session_id = ANY (v_sessions)
       AND op.teacher_id IS NOT DISTINCT FROM v_owner AND NOT (op.student_id = ANY (v_desired));
    WITH d AS (
      DELETE FROM public.ptm_online_participants op
       WHERE op.ptm_id = _ptm_id AND op.class_session_id = ANY (v_sessions)
         AND op.teacher_id IS NOT DISTINCT FROM v_owner AND NOT (op.student_id = ANY (v_desired))
      RETURNING op.student_id)
    SELECT array_agg(student_id) INTO v_removed FROM d;
    SELECT count(*)::int INTO v_kept FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.class_session_id = ANY (v_sessions) AND op.teacher_id IS NOT DISTINCT FROM v_owner;

    WITH cand AS (
      SELECT s AS student_id, public._ptm_pickable_class(s) AS class_id, public.has_role(s, 'student') AS is_student
        FROM unnest(v_desired) s
       WHERE NOT EXISTS (SELECT 1 FROM public.ptm_online_participants op
                          WHERE op.ptm_id = _ptm_id AND op.student_id = s AND op.class_session_id = ANY (v_sessions)
                            AND op.teacher_id IS NOT DISTINCT FROM v_owner)
    ), judged AS (
      SELECT c.student_id, c.class_id, cs.id AS cs_id,
             CASE WHEN NOT c.is_student THEN 'not_a_student'
                  WHEN c.class_id IS NULL THEN 'no_single_class'
                  WHEN cs.id IS NULL THEN 'not_your_class'
             END AS reason
        FROM cand c
        LEFT JOIN public.ptm_online_class_sessions cs ON cs.id = ANY (v_sessions) AND cs.class_id = c.class_id
    ), ins AS (
      INSERT INTO public.ptm_online_participants (ptm_id, student_id, teacher_id, class_id, class_session_id, added_by)
      SELECT _ptm_id, j.student_id, v_owner, j.class_id, j.cs_id, v_uid FROM judged j WHERE j.reason IS NULL
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
      IF v_owner IS NULL THEN
        PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_invited', 'Online PTM',
          '"' || v_p.title || '" with your teachers on ' || to_char(v_p.scheduled_date, 'DD Mon')
            || '. Book your slot in the app.', v_added);
      ELSE
        SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = v_owner;
        PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_invited', 'Online PTM',
          '"' || v_p.title || '" with ' || COALESCE(left(v_name, 60), 'your teacher') || ' on '
            || to_char(v_p.scheduled_date, 'DD Mon') || '. Book your slot in the app.', v_added);
      END IF;
    END IF;
    RETURN jsonb_build_object(
      'added', COALESCE(array_length(v_added, 1), 0),
      'removed', COALESCE(array_length(v_removed, 1), 0),
      'kept', v_kept,
      'cancelled_bookings', v_cancelled,
      'refused', v_refused);
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
$function$;

NOTIFY pgrst, 'reload schema';
