-- Online (residential) PTM mode, part 3 of 4: a teacher is in one PTM window
-- at a time. Spec section 5.3; the pattern is the exam slot guard
-- (20260928170000): per-teacher advisory locks taken in sorted order, the
-- check re-read in a fresh statement, half-open windows in the school's own
-- timezone (CLAUDE.md 24), one shared reader for the guard and the UI.
--
-- Who is busy: a teacher running a session in a scheduled online PTM, or a
-- teacher of any class an in-person PTM covers (a school-wide in-person PTM
-- holds every teacher; since 2026-09-29 a section's PTM holds every teacher of
-- that section). Only ONLINE writes are guarded: editing an in-person PTM
-- onto a teacher's online session is not refused, the online session moves.
--
-- Triggers, built to two Postgres rules a draft broke: a transition table
-- allows neither a column list nor more than one event. So INSERT and UPDATE
-- on ptm_online_teachers are separate statement triggers, and the UPDATE one
-- asserts only rows whose teacher_id really changed: the added_by SET NULL
-- that a user delete runs is an UPDATE too and must never raise (CLAUDE.md 21).

CREATE OR REPLACE FUNCTION public._ptm_busy_window(_date date, _start time, _end time, _buffer integer, _tz text)
RETURNS TABLE(starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (_date + _start) AT TIME ZONE COALESCE(_tz, 'Asia/Kolkata'),
         ((_date + _end) + make_interval(mins => COALESCE(_buffer, 0))) AT TIME ZONE COALESCE(_tz, 'Asia/Kolkata');
$$;

-- Every scheduled PTM window that holds one of the teachers and overlaps
-- [_from, _to). Shared by the guard and the read RPC so they cannot disagree.
CREATE OR REPLACE FUNCTION public._ptm_teacher_bookings(_teacher_ids uuid[], _from timestamptz, _to timestamptz, _exclude_ptm uuid)
RETURNS TABLE(teacher_id uuid, ptm_id uuid, mode text, title text, starts_at timestamptz, ends_at timestamptz, created_by uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH win AS (
    SELECT p.id, p.mode, p.title, p.created_by, w.starts_at, w.ends_at
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
  SELECT ot.teacher_id, w.id, w.mode, w.title, w.starts_at, w.ends_at, w.created_by
    FROM win w
    JOIN public.ptm_online_teachers ot ON ot.ptm_id = w.id
   WHERE w.mode = 'online' AND ot.teacher_id = ANY (_teacher_ids)
  UNION
  -- In person: a teacher row on any covered class (is_class_teacher_of, as a join).
  SELECT ca.user_id, w.id, w.mode, w.title, w.starts_at, w.ends_at, w.created_by
    FROM win w
    CROSS JOIN LATERAL public.ptm_effective_class_ids(w.id) e
    JOIN public.class_assignments ca ON ca.class_id = e.class_id AND ca.role = 'teacher'
    JOIN public.profiles pr ON pr.id = ca.user_id AND pr.is_active IS NOT FALSE
   WHERE w.mode = 'in_person' AND ca.user_id = ANY (_teacher_ids)
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ca.user_id AND r.role = 'teacher');
$$;

CREATE OR REPLACE FUNCTION public._ptm_assert_teachers_free(_ptm_id uuid, _teacher_ids uuid[], _from timestamptz, _to timestamptz)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_t uuid;
  v_hit record;
  v_name text;
  v_tz text;
BEGIN
  IF _to IS NULL OR _to <= now() OR _teacher_ids IS NULL OR cardinality(_teacher_ids) = 0 THEN
    RETURN;  -- a window that is over is never checked
  END IF;
  FOR v_t IN SELECT DISTINCT t FROM unnest(_teacher_ids) AS t WHERE t IS NOT NULL ORDER BY t LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('ptm_teacher:' || v_t::text, 0));
  END LOOP;
  -- A fresh statement after the locks, so a write committed while we waited is seen.
  SELECT b.* INTO v_hit
    FROM public._ptm_teacher_bookings(_teacher_ids, _from, _to, _ptm_id) b
   ORDER BY b.starts_at, b.teacher_id LIMIT 1;
  IF FOUND THEN
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = v_hit.teacher_id;
    SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz
      FROM public.ptm_schedules p JOIN public.institutions i ON i.id = p.institution_id
     WHERE p.id = v_hit.ptm_id;
    RAISE EXCEPTION '% is already in "%" from % to % on %. Pick another time or teacher.',
      left(COALESCE(v_name, 'A teacher'), 30), left(v_hit.title, 36),
      to_char(v_hit.starts_at AT TIME ZONE v_tz, 'HH24:MI'),
      to_char(v_hit.ends_at AT TIME ZONE v_tz, 'HH24:MI'),
      to_char(v_hit.starts_at AT TIME ZONE v_tz, 'DD Mon')
      USING ERRCODE = 'P0001', HINT = 'ptm_teacher_busy',
            DETAIL = json_build_object('teacher_id', v_hit.teacher_id, 'ptm_id', v_hit.ptm_id,
                                       'mode', v_hit.mode, 'starts_at', v_hit.starts_at,
                                       'ends_at', v_hit.ends_at)::text;
  END IF;
END;
$$;

-- The window of one PTM, from its own row (used by the triggers).
CREATE OR REPLACE FUNCTION public._ptm_own_window(_ptm_id uuid)
RETURNS TABLE(starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT w.starts_at, w.ends_at
    FROM public.ptm_schedules p
    JOIN public.institutions i ON i.id = p.institution_id
    CROSS JOIN LATERAL public._ptm_busy_window(p.scheduled_date, p.start_time, p.end_time,
                                              p.slot_buffer_minutes, i.timezone) w
   WHERE p.id = _ptm_id;
$$;

-- Teachers added to an online PTM: every one of them must be free.
CREATE OR REPLACE FUNCTION public.tg_ptm_online_teachers_busy_ins()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.ptm_id, array_agg(DISTINCT n.teacher_id ORDER BY n.teacher_id) AS teachers
      FROM new_rows n GROUP BY n.ptm_id ORDER BY n.ptm_id
  LOOP
    PERFORM 1 FROM public.ptm_schedules p WHERE p.id = r.ptm_id FOR SHARE;
    IF EXISTS (SELECT 1 FROM public.ptm_schedules p
                WHERE p.id = r.ptm_id AND p.mode = 'online' AND p.status = 'scheduled') THEN
      PERFORM public._ptm_assert_teachers_free(r.ptm_id, r.teachers, w.starts_at, w.ends_at)
         FROM public._ptm_own_window(r.ptm_id) w;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- A session handed to another teacher (a swap): only rows whose teacher changed.
CREATE OR REPLACE FUNCTION public.tg_ptm_online_teachers_busy_upd()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.ptm_id, array_agg(DISTINCT n.teacher_id ORDER BY n.teacher_id) AS teachers
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE n.teacher_id IS DISTINCT FROM o.teacher_id OR n.ptm_id IS DISTINCT FROM o.ptm_id
     GROUP BY n.ptm_id ORDER BY n.ptm_id
  LOOP
    PERFORM 1 FROM public.ptm_schedules p WHERE p.id = r.ptm_id FOR SHARE;
    IF EXISTS (SELECT 1 FROM public.ptm_schedules p
                WHERE p.id = r.ptm_id AND p.mode = 'online' AND p.status = 'scheduled') THEN
      PERFORM public._ptm_assert_teachers_free(r.ptm_id, r.teachers, w.starts_at, w.ends_at)
         FROM public._ptm_own_window(r.ptm_id) w;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ptm_online_teachers_busy_ins ON public.ptm_online_teachers;
CREATE TRIGGER ptm_online_teachers_busy_ins AFTER INSERT ON public.ptm_online_teachers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_ptm_online_teachers_busy_ins();
DROP TRIGGER IF EXISTS ptm_online_teachers_busy_upd ON public.ptm_online_teachers;
CREATE TRIGGER ptm_online_teachers_busy_upd AFTER UPDATE ON public.ptm_online_teachers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_ptm_online_teachers_busy_upd();

-- An online PTM moved to a new date or time, or un-cancelled: all its teachers
-- must be free in the new window.
CREATE OR REPLACE FUNCTION public.tg_ptm_schedules_online_busy()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_teachers uuid[];
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
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
  SELECT array_agg(ot.teacher_id ORDER BY ot.teacher_id) INTO v_teachers
    FROM public.ptm_online_teachers ot WHERE ot.ptm_id = NEW.id;
  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = NEW.institution_id;
  SELECT w.starts_at, w.ends_at INTO v_from, v_to
    FROM public._ptm_busy_window(NEW.scheduled_date, NEW.start_time, NEW.end_time, NEW.slot_buffer_minutes, v_tz) w;
  PERFORM public._ptm_assert_teachers_free(NEW.id, v_teachers, v_from, v_to);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ptm_schedules_online_busy_guard ON public.ptm_schedules;
CREATE TRIGGER ptm_schedules_online_busy_guard
  BEFORE UPDATE OF scheduled_date, start_time, end_time, slot_buffer_minutes, status, mode ON public.ptm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_schedules_online_busy();

-- ── read RPC: who is busy on a day (for the admin's teacher picker) ────────
CREATE OR REPLACE FUNCTION public.ptm_teacher_busy_windows(_date date, _teacher_ids uuid[] DEFAULT NULL, _exclude_ptm uuid DEFAULT NULL)
RETURNS TABLE(teacher_id uuid, ptm_id uuid, mode text, title text, starts_at timestamptz, ends_at timestamptz, is_own boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_tz text;
  v_scope uuid[];
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF public.has_role(v_uid, 'student') OR _date IS NULL THEN RETURN; END IF;
  v_inst := public.get_user_institution(v_uid);
  IF v_inst IS NULL THEN RETURN; END IF;
  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;

  IF public.is_institution_admin(v_uid, v_inst) THEN
    SELECT array_agg(DISTINCT r.user_id) INTO v_scope
      FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
     WHERE r.role = 'teacher' AND p.institution_id = v_inst AND p.is_active IS NOT FALSE;
  ELSIF public._ptm_has_hat(v_uid, v_inst, 'coordinator') THEN
    SELECT array_agg(DISTINCT x.uid) INTO v_scope FROM (
      SELECT ca.user_id AS uid
        FROM public.wing_assignments wa
        JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
        JOIN public.class_assignments ca ON ca.class_id = wcm.class_id AND ca.role = 'teacher'
       WHERE wa.user_id = v_uid
      UNION SELECT v_uid WHERE public._ptm_has_hat(v_uid, v_inst, 'teacher')) x;
  ELSIF public._ptm_has_hat(v_uid, v_inst, 'teacher') THEN
    v_scope := ARRAY[v_uid];
  ELSE
    RETURN;
  END IF;

  IF _teacher_ids IS NULL THEN
    v_ids := v_scope;
  ELSE
    SELECT array_agg(t) INTO v_ids
      FROM (SELECT DISTINCT t FROM unnest(_teacher_ids) t LIMIT 100) s
     WHERE t = ANY (COALESCE(v_scope, ARRAY[]::uuid[]));
  END IF;
  IF v_ids IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT b.teacher_id, b.ptm_id, b.mode, b.title, b.starts_at, b.ends_at, b.created_by = v_uid
    FROM public._ptm_teacher_bookings(v_ids,
           (_date + time '00:00') AT TIME ZONE v_tz,
           ((_date + 1) + time '00:00') AT TIME ZONE v_tz,
           _exclude_ptm) b
   ORDER BY b.starts_at, b.teacher_id
   LIMIT 500;
END;
$$;

-- ── grants ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._ptm_busy_window(date, time, time, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ptm_teacher_bookings(uuid[], timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ptm_assert_teachers_free(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ptm_own_window(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_ptm_online_teachers_busy_ins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_ptm_online_teachers_busy_upd() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_ptm_schedules_online_busy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_busy_window(date, time, time, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._ptm_teacher_bookings(uuid[], timestamptz, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._ptm_assert_teachers_free(uuid, uuid[], timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public._ptm_own_window(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ptm_teacher_busy_windows(date, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ptm_teacher_busy_windows(date, uuid[], uuid) TO authenticated, service_role;
