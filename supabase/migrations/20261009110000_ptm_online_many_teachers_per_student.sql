-- Online PTM: Separately only, and a student may be with several teachers
-- (NEEDS DB in naman-erp e9d4897d, 2026-10-09; spec
-- docs/superpowers/specs/2026-10-09-ptm-online-many-teachers-per-student-design.md).
--
-- * Together is retired: any 'panel' PTM becomes 'separate' and the CHECK
--   allows only 'separate'; create_online_ptm ignores _online_format.
-- * ptm_online_participants: one row per (ptm, teacher, student); teacher_id
--   NOT NULL. A student may be on several teachers' lists in one PTM.
-- * ptm_bookings: online, one active booking per (ptm, family, teacher);
--   in person, still one per (ptm, family).
-- * book_ptm_slot(_ptm_id, _slot_time, _replace, _teacher_id DEFAULT NULL):
--   _teacher_id must be one of the family's teachers on this PTM; NULL means
--   the only one (P0001 ptm_teacher_ambiguous when there are several).
--   _replace moves only the booking with that teacher. A slot that overlaps,
--   gap included, the family's booking with another teacher is refused
--   (P0001 ptm_family_double_booked, naming that teacher and time).
-- * ptm_online_booking_grid for a student: the same _teacher_id rule.
-- * set_ptm_online_students: a student another teacher has is no longer
--   refused; removing a student cancels only the booking with this teacher;
--   ptm_online_invited goes once per (teacher, student).
-- * ptm_online_pick_options: state is free | mine; with_teachers lists the
--   PTM's other teachers who have the student (taken / taken_by_name retired).
-- * ptm_online_my_sessions: one row per (PTM, teacher), each with the booking
--   with that teacher.
-- * swap_ptm_online_teacher adds merged_students (always 0: the new teacher
--   cannot already be in the PTM).
-- * The family's feedback context names every teacher they were with.

-- ── 1. Together retired ────────────────────────────────────────────────────
UPDATE public.ptm_schedules SET online_format = 'separate' WHERE online_format = 'panel';
ALTER TABLE public.ptm_schedules DROP CONSTRAINT IF EXISTS ptm_schedules_online_format_check;
ALTER TABLE public.ptm_schedules ADD CONSTRAINT ptm_schedules_online_format_check CHECK (online_format = 'separate');
DROP INDEX IF EXISTS public.ptm_bookings_one_per_panel_slot;

-- ── 2. several teachers per student, one booking per teacher ───────────────
ALTER TABLE public.ptm_online_participants DROP CONSTRAINT IF EXISTS ptm_online_participants_teacher_or_session;
ALTER TABLE public.ptm_online_participants ALTER COLUMN teacher_id SET NOT NULL;
ALTER TABLE public.ptm_online_participants DROP CONSTRAINT IF EXISTS ptm_online_participants_one_teacher;
ALTER TABLE public.ptm_online_participants DROP CONSTRAINT IF EXISTS ptm_online_participants_ptm_teacher_student_key;
ALTER TABLE public.ptm_online_participants ADD CONSTRAINT ptm_online_participants_ptm_teacher_student_key
  UNIQUE (ptm_id, teacher_id, student_id);
CREATE INDEX IF NOT EXISTS ptm_online_participants_ptm_student_idx ON public.ptm_online_participants (ptm_id, student_id);

DROP INDEX IF EXISTS public.ptm_bookings_one_per_student;
CREATE UNIQUE INDEX ptm_bookings_one_per_student ON public.ptm_bookings (ptm_id, parent_id)
  WHERE cancelled_at IS NULL AND mode = 'in_person';
CREATE UNIQUE INDEX IF NOT EXISTS ptm_bookings_one_per_student_teacher ON public.ptm_bookings (ptm_id, parent_id, teacher_id)
  WHERE cancelled_at IS NULL AND mode = 'online';

-- ── 3. booking ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.book_ptm_slot(uuid, time, boolean);
CREATE FUNCTION public.book_ptm_slot(_ptm_id uuid, _slot_time time without time zone, _replace boolean DEFAULT false,
                                     _teacher_id uuid DEFAULT NULL::uuid)
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
  v_teacher_name text;
  v_id uuid;
  v_con text;
  v_name text;
  v_tz text;
  v_cs uuid;
  v_n integer;
  v_other record;
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
    -- One family's bookings on this PTM are decided one at a time.
    PERFORM pg_advisory_xact_lock(hashtextextended('ptm_family:' || _ptm_id::text || ':' || v_uid::text, 0));
    -- The teacher is one of the family's own participant rows, never anyone
    -- else; with several, the caller names which one.
    SELECT count(*)::int INTO v_n FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.student_id = v_uid;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'You are not on the list for this online meeting. Ask your teacher.'
        USING ERRCODE = 'P0001', HINT = 'ptm_not_participant';
    END IF;
    IF _teacher_id IS NULL AND v_n > 1 THEN
      RAISE EXCEPTION 'Say which teacher you are booking with.'
        USING ERRCODE = 'P0001', HINT = 'ptm_teacher_ambiguous';
    END IF;
    -- FOR SHARE: a concurrent swap waits, so the booking never lands on the old teacher.
    SELECT op.class_id, op.teacher_id, op.class_session_id INTO v_class, v_teacher, v_cs
      FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.student_id = v_uid
       AND (_teacher_id IS NULL OR op.teacher_id = _teacher_id)
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That teacher is not one of yours for this meeting.'
        USING ERRCODE = 'P0001', HINT = 'ptm_not_participant';
    END IF;
    SELECT pr.full_name INTO v_teacher_name FROM public.profiles pr WHERE pr.id = v_teacher;
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
    -- Online: only the booking with this teacher moves, and not once it has started.
    IF v_p.mode = 'online' AND EXISTS (
         SELECT 1 FROM public.ptm_bookings b
          WHERE b.ptm_id = _ptm_id AND b.parent_id = v_uid AND b.cancelled_at IS NULL
            AND b.teacher_id = v_teacher
            AND now() >= (v_p.scheduled_date + b.slot_time) AT TIME ZONE v_tz) THEN
      RAISE EXCEPTION 'Your slot has already started, so it can no longer be moved.'
        USING ERRCODE = 'P0001', HINT = 'ptm_slot_started';
    END IF;
    UPDATE public.ptm_bookings
       SET cancelled_at = now(), status = 'cancelled'
     WHERE ptm_id = _ptm_id AND parent_id = v_uid AND cancelled_at IS NULL
       AND (v_p.mode <> 'online' OR teacher_id = v_teacher);
  END IF;
  IF v_p.mode = 'online' THEN
    -- The family's slots with its other teachers may not overlap this one, gap included.
    SELECT b.slot_time, pr.full_name INTO v_other
      FROM public.ptm_bookings b
      LEFT JOIN public.profiles pr ON pr.id = b.teacher_id
     WHERE b.ptm_id = _ptm_id AND b.parent_id = v_uid AND b.cancelled_at IS NULL AND b.mode = 'online'
       AND b.teacher_id IS DISTINCT FROM v_teacher
       AND (date '2000-01-01' + b.slot_time)
           < (date '2000-01-01' + _slot_time) + make_interval(mins => v_p.slot_duration_minutes + v_p.slot_buffer_minutes)
       AND (date '2000-01-01' + _slot_time)
           < (date '2000-01-01' + b.slot_time) + make_interval(mins => v_p.slot_duration_minutes + v_p.slot_buffer_minutes)
     ORDER BY b.slot_time
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'You have a slot with % at %. Pick another time.',
        COALESCE(left(v_other.full_name, 60), 'another teacher'), to_char(v_other.slot_time, 'HH24:MI')
        USING ERRCODE = 'P0001', HINT = 'ptm_family_double_booked';
    END IF;
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
    ELSIF v_con = 'ptm_bookings_one_per_student_teacher' THEN
      RAISE EXCEPTION 'You already have a slot with this teacher. Change it instead.'
        USING ERRCODE = 'P0001', HINT = 'ptm_already_booked';
    END IF;
    RAISE EXCEPTION 'That slot was just taken. Pick another.'
      USING ERRCODE = 'P0001', HINT = 'ptm_slot_taken';
  END;
  IF v_p.mode = 'online' THEN
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = v_uid;
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_booking_confirmed', 'PTM slot booked',
      '"' || v_p.title || '" on ' || to_char(v_p.scheduled_date, 'DD Mon') || ' at '
        || to_char(_slot_time, 'HH24:MI') || ' with ' || COALESCE(left(v_teacher_name, 60), 'your teacher')
        || '. Join from the app when your slot starts.',
      ARRAY[v_uid], v_id::text, NULL, jsonb_build_object('booking_id', v_id));
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_slot_booked', 'PTM slot booked',
      COALESCE(left(v_name, 60), 'A family') || ' booked ' || to_char(_slot_time, 'HH24:MI') || ' on '
        || to_char(v_p.scheduled_date, 'DD Mon') || ' for "' || v_p.title || '".',
      ARRAY[v_teacher], v_id::text, NULL, jsonb_build_object('booking_id', v_id));
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.book_ptm_slot(uuid, time, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_ptm_slot(uuid, time, boolean, uuid) TO authenticated, service_role;

-- ── 4. the student's grid, per teacher ────────────────────────────────────
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
    -- A family may be with several teachers: _teacher_id says whose grid (NULL = the only one).
    SELECT count(*)::int INTO v_n FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.student_id = v_uid;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'You are not on the list for this online meeting. Ask your teacher.'
        USING ERRCODE = 'P0001', HINT = 'ptm_not_participant';
    END IF;
    IF _teacher_id IS NULL AND v_n > 1 THEN
      RAISE EXCEPTION 'Say which teacher you are booking with.'
        USING ERRCODE = 'P0001', HINT = 'ptm_teacher_ambiguous';
    END IF;
    SELECT op.teacher_id, op.class_session_id INTO v_teacher, v_cs FROM public.ptm_online_participants op
     WHERE op.ptm_id = _ptm_id AND op.student_id = v_uid
       AND (_teacher_id IS NULL OR op.teacher_id = _teacher_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That teacher is not one of yours for this meeting.'
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

-- ── 5. student lists per teacher ──────────────────────────────────────────
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
      JOIN public.ptm_bookings b ON b.ptm_id = op.ptm_id AND b.parent_id = op.student_id AND b.teacher_id = op.teacher_id AND b.cancelled_at IS NULL
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
      ON CONFLICT (ptm_id, teacher_id, student_id) DO NOTHING
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
        -- Once per (teacher, student): a student may be invited by several teachers.
        PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_invited', 'Online PTM',
          COALESCE(left(v_name, 60), 'Your teacher') || ' has invited you to "' || v_p.title || '" on '
            || to_char(v_p.scheduled_date, 'DD Mon') || '. Book a slot in the app.', v_added, v_owner::text);
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
    JOIN public.ptm_bookings b ON b.ptm_id = op.ptm_id AND b.parent_id = op.student_id AND b.teacher_id = op.teacher_id AND b.cancelled_at IS NULL
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
    ON CONFLICT (ptm_id, teacher_id, student_id) DO NOTHING
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
      COALESCE(left(v_name, 60), 'Your teacher') || ' has invited you to "' || v_p.title || '" on '
        || to_char(v_p.scheduled_date, 'DD Mon') || '. Book a slot in the app.',
      v_added, v_teacher::text);
  END IF;

  RETURN jsonb_build_object(
    'added', COALESCE(array_length(v_added, 1), 0),
    'removed', COALESCE(array_length(v_removed, 1), 0),
    'kept', v_kept,
    'cancelled_bookings', v_cancelled,
    'refused', v_refused);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_ptm_online_participant_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_b record;
  v_title text;
BEGIN
  FOR v_b IN
    UPDATE public.ptm_bookings
       SET cancelled_at = now(), status = 'cancelled'
     WHERE ptm_id = OLD.ptm_id AND parent_id = OLD.student_id AND cancelled_at IS NULL AND mode = 'online'
       AND teacher_id IS NOT DISTINCT FROM OLD.teacher_id  -- only the booking with this teacher
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
   WHERE ptm_id = OLD.ptm_id AND recipient_id = OLD.student_id
     AND notification_type IN ('ptm_online_invited', 'ptm_online_invited:' || OLD.teacher_id::text);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ptm participant cleanup failed for ptm %: % (%)', OLD.ptm_id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$function$;

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

  v_format := 'separate';  -- Together is retired (20261009110000): _online_format is ignored.
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
      COALESCE(left(v_name, 60), 'Your teacher') || ' has invited you to "' || btrim(_title) || '" on '
        || to_char(_scheduled_date, 'DD Mon') || '. Book a slot in the app.',
      v_students, v_uid::text);
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

-- ── 6. reads ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ptm_online_pick_options(_ptm_id uuid DEFAULT NULL::uuid, _teacher_id uuid DEFAULT NULL::uuid, _class_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_teacher uuid := COALESCE(_teacher_id, auth.uid());
  v_inst uuid;
  v_out jsonb;
  v_panel boolean;
  v_sessions uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  v_inst := public.get_user_institution(v_uid);
  IF v_teacher <> v_uid AND NOT public.is_institution_admin(v_uid, v_inst) THEN
    RAISE EXCEPTION 'Only a school admin can pick for another teacher.' USING ERRCODE = '42501';
  END IF;
  IF _ptm_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.ptm_schedules p WHERE p.id = _ptm_id AND p.institution_id = v_inst AND p.mode = 'online') THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  -- A PTM by class: the students of the classes the teacher sits in (or one
  -- class). Together: 'mine' = on that class's list; an admin, the manager or
  -- a teacher of the class may read it by _class_session_id.
  IF _ptm_id IS NOT NULL AND public._ptm_has_class_sessions(_ptm_id) THEN
    SELECT p.online_format = 'panel' INTO v_panel FROM public.ptm_schedules p WHERE p.id = _ptm_id;
    IF _class_session_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.ptm_online_class_sessions cs WHERE cs.id = _class_session_id AND cs.ptm_id = _ptm_id) THEN
      RAISE EXCEPTION 'That class is not in this PTM.' USING ERRCODE = '22023';
    END IF;
    IF v_panel AND _class_session_id IS NOT NULL
       AND (public.is_institution_admin(v_uid, v_inst) OR public.can_manage_ptm(v_uid, _ptm_id)
            OR public._ptm_is_session_teacher(_class_session_id, v_uid)) THEN
      v_sessions := ARRAY[_class_session_id];
    ELSE
      SELECT array_agg(st.class_session_id) INTO v_sessions
        FROM public.ptm_online_session_teachers st
       WHERE st.ptm_id = _ptm_id AND st.teacher_id = v_teacher
         AND (_class_session_id IS NULL OR st.class_session_id = _class_session_id);
    END IF;
    IF v_sessions IS NULL THEN RETURN '[]'::jsonb; END IF;
    WITH cls AS (
      SELECT cs.id AS cs_id, cs.class_id FROM public.ptm_online_class_sessions cs WHERE cs.id = ANY (v_sessions)
    ), single AS (
      SELECT ca.user_id, min(ca.class_id::text)::uuid AS class_id
        FROM public.class_assignments ca
       WHERE ca.role = 'student'
         AND ca.user_id IN (SELECT ca2.user_id FROM public.class_assignments ca2
                             WHERE ca2.role = 'student' AND ca2.class_id IN (SELECT cls.class_id FROM cls))
       GROUP BY ca.user_id HAVING count(*) = 1
    ), opts AS (
      SELECT s.user_id AS student_id, pr.full_name, c.id AS class_id, c.name AS class_name, c.section AS class_section,
             CASE WHEN EXISTS (SELECT 1 FROM public.ptm_online_participants op
                                WHERE op.ptm_id = _ptm_id AND op.student_id = s.user_id AND op.teacher_id = v_teacher)
                  THEN 'mine' ELSE 'free' END AS state,
             -- A student may be with several teachers: the PTM's others, by name.
             ARRAY(SELECT COALESCE(tp.full_name, 'A teacher') FROM public.ptm_online_participants op
                     LEFT JOIN public.profiles tp ON tp.id = op.teacher_id
                    WHERE op.ptm_id = _ptm_id AND op.student_id = s.user_id AND op.teacher_id <> v_teacher
                    ORDER BY tp.full_name) AS with_teachers,
             EXISTS (SELECT 1 FROM public.ptm_bookings b
                      WHERE b.ptm_id = _ptm_id AND b.parent_id = s.user_id AND b.cancelled_at IS NULL
                        AND b.teacher_id = v_teacher) AS booked
        FROM single s
        JOIN cls ON cls.class_id = s.class_id
        JOIN public.classes c ON c.id = s.class_id
        JOIN public.profiles pr ON pr.id = s.user_id AND pr.is_active IS NOT FALSE
       WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = s.user_id AND r.role = 'student')
       ORDER BY c.name, c.section, pr.full_name
       LIMIT 2000
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(opts) ORDER BY opts.class_name, opts.class_section, opts.full_name), '[]'::jsonb)
      INTO v_out FROM opts;
    RETURN v_out;
  END IF;
  IF NOT public._ptm_has_hat(v_teacher, v_inst, 'teacher') THEN
    RETURN '[]'::jsonb;
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
           CASE WHEN _ptm_id IS NOT NULL AND EXISTS (
                       SELECT 1 FROM public.ptm_online_participants op
                        WHERE op.ptm_id = _ptm_id AND op.student_id = s.user_id AND op.teacher_id = v_teacher)
                THEN 'mine' ELSE 'free' END AS state,
           ARRAY(SELECT COALESCE(tp.full_name, 'A teacher') FROM public.ptm_online_participants op
                   LEFT JOIN public.profiles tp ON tp.id = op.teacher_id
                  WHERE _ptm_id IS NOT NULL AND op.ptm_id = _ptm_id AND op.student_id = s.user_id
                    AND op.teacher_id <> v_teacher
                  ORDER BY tp.full_name) AS with_teachers,
           EXISTS (SELECT 1 FROM public.ptm_bookings b
                    WHERE _ptm_id IS NOT NULL AND b.ptm_id = _ptm_id AND b.parent_id = s.user_id
                      AND b.teacher_id = v_teacher AND b.cancelled_at IS NULL) AS booked
      FROM single s
      JOIN cls ON cls.class_id = s.class_id
      JOIN public.classes c ON c.id = s.class_id
      JOIN public.profiles pr ON pr.id = s.user_id AND pr.is_active IS NOT FALSE
     WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = s.user_id AND r.role = 'student')
     ORDER BY c.name, c.section, pr.full_name
     LIMIT 2000
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(opts) ORDER BY opts.class_name, opts.class_section, opts.full_name), '[]'::jsonb)
    INTO v_out FROM opts;
  RETURN v_out;
END;
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
                                   AND b.teacher_id = op.teacher_id
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
   ORDER BY p.scheduled_date DESC, p.start_time DESC, p.id, tp.full_name
   LIMIT 100;
END;
$function$;

CREATE OR REPLACE FUNCTION public._ptm_feedback_context(_user uuid, _ptm_id uuid)
 RETURNS TABLE(ptm_id uuid, title text, description text, venue text, scheduled_date date, start_time time without time zone, end_time time without time zone, status text, scope_type text, feedback_token text, feedback_edit_days integer, my_class_id uuid, my_class_name text, my_class_section text, class_teachers text, window_state text, opens_at timestamp with time zone, closes_at timestamp with time zone, my_feedback jsonb, mode text, my_teacher_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- Every teacher the family was with on this PTM (one or several).
      SELECT public._ptm_name_list(array_agg(COALESCE(pr.full_name, 'your teacher') ORDER BY pr.full_name))
        INTO v_teacher_name
        FROM public.ptm_online_participants op
        LEFT JOIN public.profiles pr ON pr.id = op.teacher_id
       WHERE op.ptm_id = _ptm_id AND op.student_id = _user;
    ELSIF EXISTS (SELECT 1 FROM public.ptm_online_participants op
                   WHERE op.ptm_id = _ptm_id AND op.student_id = _user AND op.class_session_id IS NOT NULL) THEN
      v_teacher_name := COALESCE(public._ptm_class_label(v_class), 'Your class') || ' teachers';
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
$function$;

CREATE OR REPLACE FUNCTION public.swap_ptm_online_teacher(_ptm_id uuid, _from_teacher uuid, _to_teacher uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Their bookings move too, and keep their rooms: a room belongs to the
  -- Workspace user, not to a teacher.
  WITH m AS (
    UPDATE public.ptm_bookings SET teacher_id = _to_teacher
     WHERE ptm_id = _ptm_id AND teacher_id = _from_teacher AND cancelled_at IS NULL
    RETURNING id)
  SELECT count(*)::int INTO v_moved_bookings FROM m;

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

  -- merged_students: the new teacher cannot already be in this PTM, so no list merges.
  RETURN jsonb_build_object('moved_students', v_moved_students, 'moved_bookings', v_moved_bookings,
                            'merged_students', 0,
                            'out_of_scope_students', v_out);
END;
$function$;

NOTIFY pgrst, 'reload schema';
