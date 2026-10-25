-- Online PTM: a teacher's own hours inside the meeting (NEEDS DB in naman-erp
-- a23ff4fc, 2026-10-06).
--
-- ptm_online_teachers.start_time / end_time: both NULL = the meeting's window,
-- else a narrower window inside it, at least one slot long. A teacher's slots
-- start at their own start and step by duration plus gap, as the meeting's do.
--
-- Written by: create_online_ptm(..., _teacher_windows jsonb DEFAULT NULL) and
-- set_ptm_online_teachers(_ptm_id, _teacher_ids, _teacher_windows jsonb DEFAULT
-- NULL), both taking [{teacher_id, start_time, end_time}] (start/end both null =
-- back to the meeting's; a kept teacher with no entry keeps their hours), and
-- set_ptm_online_teacher_hours(_ptm_id, _teacher_id, _start_time, _end_time)
-- (admin, the PTM's manager, or that teacher; NULLs = the meeting's).
-- Hours equal to the meeting's are stored as NULL.
--
-- Refusals (P0001 + HINT):
--   ptm_hours_outside       hours not inside the meeting, or shorter than one
--                           slot; also a meeting edit that no longer contains a
--                           teacher's hours (names them)
--   ptm_hours_has_bookings  a change that would leave a booked slot off that
--                           teacher's grid (names the families)
--   ptm_hours_invalid       a malformed _teacher_windows entry
-- set_ptm_online_teachers reports a kept teacher's refused hours in `refused`
-- with reason hours_has_bookings or busy instead of failing the whole call.
--
-- Per teacher from here on: _ptm_slots(_ptm_id, _teacher_id),
-- _ptm_slot_ok(_ptm_id, _slot, _teacher_id), ptm_online_booking_grid,
-- book_ptm_slot (online: "That time is not one of this teacher's slots."), the
-- busy guard and ptm_teacher_busy_windows (a teacher is held for their own
-- hours plus the gap), ptm_feedback_summary.bookings.total_slots (sum over
-- teachers). Reads: ptm_online_sessions adds start_time, end_time and
-- ptm_online_my_sessions adds teacher_start_time, teacher_end_time (NULL when
-- the meeting's); an unbooked family's booking_closes_at is the teacher's end.
-- The one-argument _ptm_slots / _ptm_slot_ok (the meeting's grid) are unchanged.

-- ── 1. columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.ptm_online_teachers
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE public.ptm_online_teachers DROP CONSTRAINT IF EXISTS ptm_online_teachers_hours_shape;
ALTER TABLE public.ptm_online_teachers ADD CONSTRAINT ptm_online_teachers_hours_shape
  CHECK ((start_time IS NULL) = (end_time IS NULL) AND (start_time IS NULL OR end_time > start_time));

-- ── 2. slot helpers ────────────────────────────────────────────────────────
-- The slot starts of any window: start + k * (duration + gap) while the slot
-- still ends by the window's end. Same arithmetic as _ptm_slots(uuid).
CREATE OR REPLACE FUNCTION public._ptm_slot_series(_start time, _end time, _duration integer, _buffer integer)
RETURNS TABLE(slot time, k integer)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (_start + make_interval(mins => g * (_duration + COALESCE(_buffer, 0))))::time, g
    FROM generate_series(0, 299) AS g
   WHERE _start IS NOT NULL AND _end IS NOT NULL AND COALESCE(_duration, 0) > 0
     AND make_interval(mins => g * (_duration + COALESCE(_buffer, 0)) + _duration) <= (_end - _start);
$$;
REVOKE ALL ON FUNCTION public._ptm_slot_series(time, time, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_slot_series(time, time, integer, integer) TO service_role;

-- One teacher's slots in an online PTM (their own hours, else the meeting's).
CREATE OR REPLACE FUNCTION public._ptm_slots(_ptm_id uuid, _teacher_id uuid)
RETURNS SETOF time
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.slot
    FROM public.ptm_schedules p
    LEFT JOIN public.ptm_online_teachers ot ON ot.ptm_id = p.id AND ot.teacher_id = _teacher_id
    CROSS JOIN LATERAL public._ptm_slot_series(COALESCE(ot.start_time, p.start_time),
                                              COALESCE(ot.end_time, p.end_time),
                                              p.slot_duration_minutes, p.slot_buffer_minutes) s
   WHERE p.id = _ptm_id
   ORDER BY s.k;
$$;
REVOKE ALL ON FUNCTION public._ptm_slots(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_slots(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._ptm_slot_ok(_ptm_id uuid, _slot time, _teacher_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _slot IS NOT NULL AND EXISTS (SELECT 1 FROM public._ptm_slots(_ptm_id, _teacher_id) s WHERE s = _slot);
$$;
REVOKE ALL ON FUNCTION public._ptm_slot_ok(uuid, time, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_slot_ok(uuid, time, uuid) TO service_role;

-- The time a teacher is held by an online PTM: their own hours plus the gap.
CREATE OR REPLACE FUNCTION public._ptm_teacher_window(_ptm_id uuid, _teacher_id uuid)
RETURNS TABLE(starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT w.starts_at, w.ends_at
    FROM public.ptm_schedules p
    JOIN public.institutions i ON i.id = p.institution_id
    LEFT JOIN public.ptm_online_teachers ot ON ot.ptm_id = p.id AND ot.teacher_id = _teacher_id
    CROSS JOIN LATERAL public._ptm_busy_window(p.scheduled_date, COALESCE(ot.start_time, p.start_time),
                                              COALESCE(ot.end_time, p.end_time), p.slot_buffer_minutes, i.timezone) w
   WHERE p.id = _ptm_id;
$$;
REVOKE ALL ON FUNCTION public._ptm_teacher_window(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_teacher_window(uuid, uuid) TO service_role;

-- Names for a refusal: the first three, then "and N more".
CREATE OR REPLACE FUNCTION public._ptm_name_list(_names text[])
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN cardinality(_names) IS NULL OR cardinality(_names) = 0 THEN ''
              WHEN cardinality(_names) <= 3 THEN array_to_string(_names, ', ')
              ELSE array_to_string(_names[1:3], ', ') || ' and ' || (cardinality(_names) - 3) || ' more' END;
$$;
REVOKE ALL ON FUNCTION public._ptm_name_list(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_name_list(text[]) TO service_role;

-- ── 3. a teacher's hours stay inside the meeting and keep their bookings ───
CREATE OR REPLACE FUNCTION public.tg_ptm_online_teachers_hours()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_p public.ptm_schedules%ROWTYPE;
  v_name text;
  v_names text[];
BEGIN
  -- CLAUDE.md 21: never in the way of an account delete's SET NULL.
  IF TG_OP = 'UPDATE' AND public.is_user_delete_cascade_update(TG_RELID::regclass, to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.ptm_id = OLD.ptm_id
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = NEW.ptm_id;
  IF NEW.start_time IS NOT NULL THEN
    IF NEW.start_time = v_p.start_time AND NEW.end_time = v_p.end_time THEN
      NEW.start_time := NULL;  -- the meeting's own window
      NEW.end_time := NULL;
    ELSE
      SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = NEW.teacher_id;
      IF NEW.start_time < v_p.start_time OR NEW.end_time > v_p.end_time THEN
        RAISE EXCEPTION '%''s hours must be within the meeting, % to %.',
          COALESCE(left(v_name, 40), 'A teacher'), to_char(v_p.start_time, 'HH24:MI'), to_char(v_p.end_time, 'HH24:MI')
          USING ERRCODE = 'P0001', HINT = 'ptm_hours_outside';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public._ptm_slot_series(NEW.start_time, NEW.end_time,
                                                           v_p.slot_duration_minutes, v_p.slot_buffer_minutes)) THEN
        RAISE EXCEPTION '%''s hours are shorter than one slot.', COALESCE(left(v_name, 40), 'A teacher')
          USING ERRCODE = 'P0001', HINT = 'ptm_hours_outside';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- A booked slot that was on the teacher's grid must still be on it.
    SELECT array_agg(COALESCE(pr.full_name, 'A family') ORDER BY b.slot_time) INTO v_names
      FROM public.ptm_bookings b
      LEFT JOIN public.profiles pr ON pr.id = b.parent_id
     WHERE b.ptm_id = NEW.ptm_id AND b.teacher_id = NEW.teacher_id AND b.cancelled_at IS NULL
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
$$;
REVOKE ALL ON FUNCTION public.tg_ptm_online_teachers_hours() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ptm_online_teachers_hours ON public.ptm_online_teachers;
CREATE TRIGGER ptm_online_teachers_hours
  BEFORE INSERT OR UPDATE OF start_time, end_time, ptm_id ON public.ptm_online_teachers
  FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_online_teachers_hours();

-- A meeting edit must keep every teacher's own hours inside it, one slot long.
-- Named so it fires before ptm_schedules_online_busy_guard.
CREATE OR REPLACE FUNCTION public.tg_ptm_schedules_teacher_hours()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_names text[];
BEGIN
  IF public.is_user_delete_cascade_update(TG_RELID::regclass, to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF NEW.mode <> 'online' THEN RETURN NEW; END IF;
  IF NEW.start_time = OLD.start_time AND NEW.end_time = OLD.end_time
     AND NEW.slot_duration_minutes = OLD.slot_duration_minutes
     AND NEW.slot_buffer_minutes = OLD.slot_buffer_minutes THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(COALESCE(pr.full_name, 'A teacher') ORDER BY pr.full_name) INTO v_names
    FROM public.ptm_online_teachers ot
    LEFT JOIN public.profiles pr ON pr.id = ot.teacher_id
   WHERE ot.ptm_id = NEW.id AND ot.start_time IS NOT NULL
     AND (ot.start_time < NEW.start_time OR ot.end_time > NEW.end_time
          OR NOT EXISTS (SELECT 1 FROM public._ptm_slot_series(ot.start_time, ot.end_time,
                                                              NEW.slot_duration_minutes, NEW.slot_buffer_minutes)));
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION '% % own hours that no longer fit. Change their hours first.',
      left(public._ptm_name_list(v_names), 90), CASE WHEN cardinality(v_names) = 1 THEN 'has' ELSE 'have' END
      USING ERRCODE = 'P0001', HINT = 'ptm_hours_outside';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_ptm_schedules_teacher_hours() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ptm_schedules_hours_guard ON public.ptm_schedules;
CREATE TRIGGER ptm_schedules_hours_guard
  BEFORE UPDATE OF start_time, end_time, slot_duration_minutes, slot_buffer_minutes ON public.ptm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_schedules_teacher_hours();

-- ── 4. the busy guard holds a teacher for their own hours ──────────────────

CREATE OR REPLACE FUNCTION public._ptm_teacher_bookings(_teacher_ids uuid[], _from timestamp with time zone, _to timestamp with time zone, _exclude_ptm uuid)
 RETURNS TABLE(teacher_id uuid, ptm_id uuid, mode text, title text, starts_at timestamp with time zone, ends_at timestamp with time zone, created_by uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH win AS (
    SELECT p.id, p.mode, p.title, p.created_by, w.starts_at, w.ends_at,
           p.scheduled_date, p.start_time, p.end_time, p.slot_buffer_minutes, i.timezone
      FROM public.ptm_schedules p
      JOIN public.institutions i ON i.id = p.institution_id
      CROSS JOIN LATERAL public._ptm_busy_window(p.scheduled_date, p.start_time, p.end_time,
                                                p.slot_buffer_minutes, i.timezone) w
     WHERE p.status = 'scheduled'
       AND (_exclude_ptm IS NULL OR p.id <> _exclude_ptm)
       -- cheap pre-filter on the indexed date; the exact overlap follows
       AND p.scheduled_date BETWEEN (_from AT TIME ZONE 'UTC')::date - 1 AND (_to AT TIME ZONE 'UTC')::date + 1
       AND w.starts_at < _to AND w.ends_at > _from
  )
  -- Online: each teacher is held for their own hours (inside the meeting's,
  -- so the meeting-level pre-filter above never drops a hit).
  SELECT ot.teacher_id, w.id, w.mode, w.title, tw.starts_at, tw.ends_at, w.created_by
    FROM win w
    JOIN public.ptm_online_teachers ot ON ot.ptm_id = w.id
    CROSS JOIN LATERAL public._ptm_busy_window(w.scheduled_date, COALESCE(ot.start_time, w.start_time),
                                              COALESCE(ot.end_time, w.end_time), w.slot_buffer_minutes, w.timezone) tw
   WHERE w.mode = 'online' AND ot.teacher_id = ANY (_teacher_ids)
     AND tw.starts_at < _to AND tw.ends_at > _from
  UNION
  -- In person: a teacher row on any covered class (is_class_teacher_of, as a join).
  SELECT ca.user_id, w.id, w.mode, w.title, w.starts_at, w.ends_at, w.created_by
    FROM win w
    CROSS JOIN LATERAL public.ptm_effective_class_ids(w.id) e
    JOIN public.class_assignments ca ON ca.class_id = e.class_id AND ca.role = 'teacher'
    JOIN public.profiles pr ON pr.id = ca.user_id AND pr.is_active IS NOT FALSE
   WHERE w.mode = 'in_person' AND ca.user_id = ANY (_teacher_ids)
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ca.user_id AND r.role = 'teacher');
$function$;


CREATE OR REPLACE FUNCTION public.tg_ptm_online_teachers_busy_ins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
  -- One PTM at a time, teachers in sorted order (the advisory locks follow it).
  FOR r IN
    SELECT DISTINCT n.ptm_id, n.teacher_id FROM new_rows n ORDER BY n.ptm_id, n.teacher_id
  LOOP
    PERFORM 1 FROM public.ptm_schedules p WHERE p.id = r.ptm_id FOR SHARE;
    IF EXISTS (SELECT 1 FROM public.ptm_schedules p
                WHERE p.id = r.ptm_id AND p.mode = 'online' AND p.status = 'scheduled') THEN
      PERFORM public._ptm_assert_teachers_free(r.ptm_id, ARRAY[r.teacher_id], w.starts_at, w.ends_at)
         FROM public._ptm_teacher_window(r.ptm_id, r.teacher_id) w;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_ptm_online_teachers_busy_upd()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT n.ptm_id, n.teacher_id
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE n.teacher_id IS DISTINCT FROM o.teacher_id OR n.ptm_id IS DISTINCT FROM o.ptm_id
        OR n.start_time IS DISTINCT FROM o.start_time OR n.end_time IS DISTINCT FROM o.end_time
     ORDER BY n.ptm_id, n.teacher_id
  LOOP
    PERFORM 1 FROM public.ptm_schedules p WHERE p.id = r.ptm_id FOR SHARE;
    IF EXISTS (SELECT 1 FROM public.ptm_schedules p
                WHERE p.id = r.ptm_id AND p.mode = 'online' AND p.status = 'scheduled') THEN
      PERFORM public._ptm_assert_teachers_free(r.ptm_id, ARRAY[r.teacher_id], w.starts_at, w.ends_at)
         FROM public._ptm_teacher_window(r.ptm_id, r.teacher_id) w;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.tg_ptm_schedules_online_busy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz text;
  r record;
BEGIN
  IF public.is_user_delete_cascade_update(TG_RELID::regclass, to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF NEW.mode <> 'online' OR NEW.status <> 'scheduled' THEN RETURN NEW; END IF;
  IF NEW.scheduled_date = OLD.scheduled_date AND NEW.start_time = OLD.start_time
     AND NEW.end_time = OLD.end_time AND NEW.slot_buffer_minutes = OLD.slot_buffer_minutes
     AND OLD.status = 'scheduled' AND OLD.mode = 'online' THEN
    RETURN NEW;  -- the window did not change
  END IF;
  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = NEW.institution_id;
  -- Each teacher for their own hours (else the new window), in teacher order.
  FOR r IN
    SELECT ot.teacher_id, w.starts_at, w.ends_at
      FROM public.ptm_online_teachers ot
      CROSS JOIN LATERAL public._ptm_busy_window(NEW.scheduled_date, COALESCE(ot.start_time, NEW.start_time),
                                                COALESCE(ot.end_time, NEW.end_time), NEW.slot_buffer_minutes, v_tz) w
     WHERE ot.ptm_id = NEW.id
     ORDER BY ot.teacher_id
  LOOP
    PERFORM public._ptm_assert_teachers_free(NEW.id, ARRAY[r.teacher_id], r.starts_at, r.ends_at);
  END LOOP;
  RETURN NEW;
END;
$function$;


-- ── 5. _teacher_windows ────────────────────────────────────────────────────
-- [{teacher_id, start_time, end_time}] -> one row per teacher. Shape only; the
-- row trigger judges the hours against the meeting.
CREATE OR REPLACE FUNCTION public._ptm_parse_teacher_windows(_windows jsonb, _teacher_ids uuid[])
RETURNS TABLE(teacher_id uuid, start_time time, end_time time)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e jsonb;
  v_t uuid;
  v_s time;
  v_e time;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF _windows IS NULL OR jsonb_typeof(_windows) = 'null' THEN RETURN; END IF;
  IF jsonb_typeof(_windows) <> 'array' THEN
    RAISE EXCEPTION 'Teachers'' hours must be a list.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
  END IF;
  IF jsonb_array_length(_windows) > 50 THEN
    RAISE EXCEPTION 'Set hours for 50 teachers or fewer.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(_windows) x LOOP
    BEGIN
      v_t := (e->>'teacher_id')::uuid;
      v_s := NULLIF(e->>'start_time', '')::time;
      v_e := NULLIF(e->>'end_time', '')::time;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'A teacher''s hours are not a valid time.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
    END;
    IF v_t IS NULL OR NOT (v_t = ANY (COALESCE(_teacher_ids, ARRAY[]::uuid[]))) THEN
      RAISE EXCEPTION 'Hours were sent for a teacher who is not in this PTM.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
    END IF;
    IF v_t = ANY (v_seen) THEN
      RAISE EXCEPTION 'Each teacher has one set of hours.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
    END IF;
    IF (v_s IS NULL) <> (v_e IS NULL) THEN
      RAISE EXCEPTION 'Set both times for a teacher''s hours.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
    END IF;
    IF v_s IS NOT NULL AND v_e <= v_s THEN
      RAISE EXCEPTION 'A teacher''s hours must end after they start.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
    END IF;
    v_seen := v_seen || v_t;
    teacher_id := v_t; start_time := v_s; end_time := v_e;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._ptm_parse_teacher_windows(jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_parse_teacher_windows(jsonb, uuid[]) TO service_role;

-- ── 6. create_online_ptm + _teacher_windows ────────────────────────────────
DROP FUNCTION IF EXISTS public.create_online_ptm(uuid, text, text, date, time, time, integer, integer, text, uuid[], uuid[], integer, integer);

CREATE FUNCTION public.create_online_ptm(_institution_id uuid, _title text, _description text, _scheduled_date date, _start_time time without time zone, _end_time time without time zone, _slot_duration_minutes integer, _slot_buffer_minutes integer DEFAULT 5, _as_role text DEFAULT 'teacher'::text, _teacher_ids uuid[] DEFAULT NULL::uuid[], _student_ids uuid[] DEFAULT NULL::uuid[], _booking_cutoff_minutes integer DEFAULT 240, _feedback_edit_days integer DEFAULT 3, _teacher_windows jsonb DEFAULT NULL::jsonb)
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

  -- Shape first (no row written yet); the row trigger judges the hours.
  SELECT jsonb_agg(jsonb_build_object('teacher_id', w.teacher_id, 'start_time', w.start_time, 'end_time', w.end_time))
    INTO v_win FROM public._ptm_parse_teacher_windows(_teacher_windows, v_teachers) w;

  INSERT INTO public.ptm_schedules
    (institution_id, title, description, scheduled_date, start_time, end_time, slot_duration_minutes,
     created_by, created_as_role, venue, scope_type, scope_wing_id, slot_booking_enabled,
     booking_cutoff_minutes, feedback_edit_days, mode, slot_buffer_minutes)
  VALUES (_institution_id, btrim(_title), NULLIF(btrim(COALESCE(_description, '')), ''), _scheduled_date,
          _start_time, _end_time, _slot_duration_minutes, v_uid, _as_role, NULL, 'class', NULL, true,
          v_cutoff, v_edit, 'online', v_buffer)
  RETURNING id INTO v_ptm;

  -- One sorted INSERT: the busy trigger asserts every teacher at once.
  INSERT INTO public.ptm_online_teachers (ptm_id, teacher_id, added_by, start_time, end_time)
  SELECT v_ptm, t, v_uid, (w->>'start_time')::time, (w->>'end_time')::time
    FROM unnest(v_teachers) t
    LEFT JOIN LATERAL (SELECT x FROM jsonb_array_elements(COALESCE(v_win, '[]'::jsonb)) x
                        WHERE (x->>'teacher_id')::uuid = t) wx(w) ON true
   ORDER BY t;

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
$function$;

REVOKE ALL ON FUNCTION public.create_online_ptm(uuid, text, text, date, time, time, integer, integer, text, uuid[], uuid[], integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_online_ptm(uuid, text, text, date, time, time, integer, integer, text, uuid[], uuid[], integer, integer, jsonb) TO authenticated, service_role;

-- ── 7. set_ptm_online_teachers + _teacher_windows ──────────────────────────
DROP FUNCTION IF EXISTS public.set_ptm_online_teachers(uuid, uuid[]);

CREATE FUNCTION public.set_ptm_online_teachers(_ptm_id uuid, _teacher_ids uuid[], _teacher_windows jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_hat text;
  v_desired uuid[];
  v_win jsonb;
  v_w jsonb;
  v_s time;
  v_e time;
  v_hint text;
  v_hours integer := 0;
  v_tz text;
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
  SELECT jsonb_agg(jsonb_build_object('teacher_id', w.teacher_id, 'start_time', w.start_time, 'end_time', w.end_time))
    INTO v_win FROM public._ptm_parse_teacher_windows(_teacher_windows, v_desired) w;
  v_win := COALESCE(v_win, '[]'::jsonb);
  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_p.institution_id;

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
    ELSIF EXISTS (
            SELECT 1
              FROM (SELECT (SELECT x FROM jsonb_array_elements(v_win) x
                             WHERE (x->>'teacher_id')::uuid = r.teacher_id LIMIT 1) AS w) wx
              CROSS JOIN LATERAL public._ptm_busy_window(v_p.scheduled_date,
                       COALESCE((wx.w->>'start_time')::time, v_p.start_time),
                       COALESCE((wx.w->>'end_time')::time, v_p.end_time), v_p.slot_buffer_minutes, v_tz) bw
              CROSS JOIN LATERAL public._ptm_teacher_bookings(ARRAY[r.teacher_id], bw.starts_at, bw.ends_at, _ptm_id) hit) THEN
      v_refused := v_refused || jsonb_build_object('teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'busy');
    ELSE
      v_add := v_add || r.teacher_id;
    END IF;
  END LOOP;
  IF array_length(v_add, 1) IS NOT NULL THEN
    INSERT INTO public.ptm_online_teachers (ptm_id, teacher_id, added_by, start_time, end_time)
    SELECT _ptm_id, t, v_uid, (wx.w->>'start_time')::time, (wx.w->>'end_time')::time
      FROM unnest(v_add) t
      LEFT JOIN LATERAL (SELECT x FROM jsonb_array_elements(v_win) x
                          WHERE (x->>'teacher_id')::uuid = t) wx(w) ON true
     ORDER BY t;
    DELETE FROM public.ptm_notifications_sent
     WHERE ptm_id = _ptm_id AND recipient_id = ANY (v_add) AND notification_type LIKE 'ptm_online_%assigned';
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_assigned', 'Online PTM: pick your students',
      'You are a teacher in "' || v_p.title || '" on ' || to_char(v_p.scheduled_date, 'DD Mon')
        || '. Open it and pick the students you will meet.',
      ARRAY(SELECT t FROM unnest(v_add) t WHERE t <> v_uid));
  END IF;

  -- New hours for teachers who stay. A refusal (bookings outside the new
  -- hours, or busy then) is reported by name and leaves their hours as they were.
  FOR r IN
    SELECT ot.teacher_id, pr.full_name, wx.w
      FROM public.ptm_online_teachers ot
      JOIN LATERAL (SELECT x FROM jsonb_array_elements(v_win) x
                     WHERE (x->>'teacher_id')::uuid = ot.teacher_id) wx(w) ON true
      LEFT JOIN public.profiles pr ON pr.id = ot.teacher_id
     WHERE ot.ptm_id = _ptm_id AND NOT (ot.teacher_id = ANY (v_add))
     ORDER BY ot.teacher_id
  LOOP
    v_s := (r.w->>'start_time')::time;
    v_e := (r.w->>'end_time')::time;
    BEGIN
      UPDATE public.ptm_online_teachers SET start_time = v_s, end_time = v_e
       WHERE ptm_id = _ptm_id AND teacher_id = r.teacher_id
         AND (start_time IS DISTINCT FROM v_s OR end_time IS DISTINCT FROM v_e);
      IF FOUND THEN v_hours := v_hours + 1; END IF;
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint = 'ptm_hours_has_bookings' THEN
        v_refused := v_refused || jsonb_build_object('teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'hours_has_bookings');
      ELSIF v_hint = 'ptm_teacher_busy' THEN
        v_refused := v_refused || jsonb_build_object('teacher_id', r.teacher_id, 'full_name', r.full_name, 'reason', 'busy');
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  SELECT count(*)::int INTO v_kept FROM public.ptm_online_teachers ot
   WHERE ot.ptm_id = _ptm_id AND NOT (ot.teacher_id = ANY (v_add));
  RETURN jsonb_build_object('added', COALESCE(array_length(v_add, 1), 0), 'removed', v_removed,
                            'kept', v_kept, 'hours_changed', v_hours, 'refused', v_refused);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_ptm_online_teachers(uuid, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ptm_online_teachers(uuid, uuid[], jsonb) TO authenticated, service_role;

-- ── 8. set_ptm_online_teacher_hours ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_ptm_online_teacher_hours(_ptm_id uuid, _teacher_id uuid,
                                                               _start_time time DEFAULT NULL, _end_time time DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) OR v_p.mode <> 'online' THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id AND ot.teacher_id = _teacher_id) THEN
    RAISE EXCEPTION 'That teacher is not in this PTM.' USING ERRCODE = '22023';
  END IF;
  IF NOT (public.is_institution_admin(v_uid, v_p.institution_id)
          OR public.can_manage_ptm(v_uid, _ptm_id)
          OR (_teacher_id = v_uid AND public._ptm_has_hat(v_uid, v_p.institution_id, 'teacher'))) THEN
    RAISE EXCEPTION 'You can''t change this teacher''s hours.' USING ERRCODE = '42501';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF public._ptm_has_ended(_ptm_id) THEN
    RAISE EXCEPTION 'This meeting has already happened.' USING ERRCODE = '22023';
  END IF;
  IF (_start_time IS NULL) <> (_end_time IS NULL) THEN
    RAISE EXCEPTION 'Set both times for a teacher''s hours.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
  END IF;
  IF _start_time IS NOT NULL AND _end_time <= _start_time THEN
    RAISE EXCEPTION 'A teacher''s hours must end after they start.' USING ERRCODE = 'P0001', HINT = 'ptm_hours_invalid';
  END IF;
  -- The row trigger checks the meeting and the bookings; the busy trigger
  -- checks the teacher's other PTMs.
  UPDATE public.ptm_online_teachers SET start_time = _start_time, end_time = _end_time
   WHERE ptm_id = _ptm_id AND teacher_id = _teacher_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_ptm_online_teacher_hours(uuid, uuid, time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ptm_online_teacher_hours(uuid, uuid, time, time) TO authenticated, service_role;

-- ── 9. booking, grid and summary use the teacher's slots ───────────────────

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
  IF v_p.mode = 'online' THEN
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
        || to_char(_slot_time, 'HH24:MI') || '. Join from the app when your slot starts.',
      ARRAY[v_uid], v_id::text, NULL, jsonb_build_object('booking_id', v_id));
    PERFORM public._ptm_fanout(_ptm_id, 'ptm_slot_booked', 'PTM slot booked',
      COALESCE(left(v_name, 60), 'A family') || ' booked ' || to_char(_slot_time, 'HH24:MI') || ' on '
        || to_char(v_p.scheduled_date, 'DD Mon') || ' for "' || v_p.title || '".',
      ARRAY[v_teacher], v_id::text, NULL, jsonb_build_object('booking_id', v_id));
  END IF;
  RETURN v_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.ptm_online_booking_grid(_ptm_id uuid, _teacher_id uuid DEFAULT NULL::uuid)
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
  WITH slots AS (SELECT s AS t FROM public._ptm_slots(_ptm_id, v_teacher) s),
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
    SELECT COALESCE(sum((SELECT count(*) FROM public._ptm_slots(_ptm_id, ot.teacher_id))), 0)::int INTO v_online_slots
      FROM public.ptm_online_teachers ot WHERE ot.ptm_id = _ptm_id;
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


-- ── 10. reads carry the teacher's hours ────────────────────────────────────
DROP FUNCTION IF EXISTS public.ptm_online_sessions(uuid);

CREATE FUNCTION public.ptm_online_sessions(_ptm_id uuid)
 RETURNS TABLE(teacher_id uuid, teacher_name text, has_google_email boolean, student_count integer, booked_count integer, attended_count integer, meet_failed_count integer, is_me boolean, start_time time without time zone, end_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         ot.teacher_id = v_uid,
         ot.start_time, ot.end_time
    FROM public.ptm_online_teachers ot
    LEFT JOIN public.profiles pr ON pr.id = ot.teacher_id
   WHERE ot.ptm_id = _ptm_id
   ORDER BY (ot.teacher_id = v_uid) DESC, pr.full_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.ptm_online_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ptm_online_sessions(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.ptm_online_my_sessions(uuid);

CREATE FUNCTION public.ptm_online_my_sessions(_ptm_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ptm_id uuid, teacher_id uuid, teacher_name text, class_id uuid, booking_id uuid, slot_time time without time zone, meet_uri text, meet_ready boolean, booking_closes_at timestamp with time zone, can_change boolean, slot_starts_at timestamp with time zone, slot_ends_at timestamp with time zone, teacher_start_time time without time zone, teacher_end_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                         AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') END,
         ot.start_time, ot.end_time
    FROM public.ptm_online_participants op
    JOIN public.ptm_schedules p ON p.id = op.ptm_id AND p.mode = 'online'
    JOIN public.institutions i ON i.id = p.institution_id
    LEFT JOIN public.profiles tp ON tp.id = op.teacher_id
    LEFT JOIN public.ptm_online_teachers ot ON ot.ptm_id = op.ptm_id AND ot.teacher_id = op.teacher_id
    LEFT JOIN public.ptm_bookings b ON b.ptm_id = p.id AND b.parent_id = v_uid AND b.cancelled_at IS NULL
    LEFT JOIN public.ptm_booking_meet m ON m.booking_id = b.id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN b.id IS NOT NULL
                  THEN (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
                  ELSE (p.scheduled_date + COALESCE(ot.end_time, p.end_time)) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
             END AS closes_at) x
   WHERE op.student_id = v_uid
     AND (_ptm_id IS NULL OR p.id = _ptm_id)
     AND p.institution_id = public.get_user_institution(v_uid)
     AND p.scheduled_date >= (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date - 7
   ORDER BY p.scheduled_date DESC, p.start_time DESC
   LIMIT 50;
END;
$function$;

REVOKE ALL ON FUNCTION public.ptm_online_my_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ptm_online_my_sessions(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
