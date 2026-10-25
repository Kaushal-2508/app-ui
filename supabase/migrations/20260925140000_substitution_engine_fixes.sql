-- =====================================================================
-- Substitution engine fixes (audit 2026-09-25)
-- =====================================================================
-- The substitute save itself (42703 on a stray subject_id conflict key) was a
-- frontend bug, fixed in useUpsertSubstitution. This migration fixes the
-- server-side half of the same audit:
--
--   1. tt_substitutions_cancel_on_late_checkin compared the period start to
--      now() AT TIME ZONE 'UTC' (CLAUDE.md §24). For an IST school the UTC
--      wall clock runs 5h30 behind, so a late check-in cancelled the pending
--      covers of periods that had ALREADY been taught, or were in progress,
--      stamping them "Original teacher checked in".
--   2. tt_run_attendance_pass_for_institution took "today" from the server's
--      (UTC) date while taking the time of day in institution time.
--   3. The pass and tt_create_pending_subs_for_absent_staff read tt_slots of
--      EVERY academic year. Harmless while only 2026-27 exists; once next
--      year's timetable is copied in, every absent teacher would get covers
--      raised for both years and last year's staff would be auto-marked
--      absent. Now scoped to the institution's current timetable year.
--   4. Pending covers were never closed. 18,984 rows sat in 'pending' for
--      dates back to 2026-05-25. Past-dated pending rows now close as
--      'no_teacher_available' on every pass (and once here, with a backup).
--   5. A teacher who checked in late had their pending covers cancelled; if
--      they were then marked absent again, ON CONFLICT DO NOTHING left the
--      cancelled rows in place and the periods never re-appeared as needing
--      cover. Cancelled-by-check-in rows for periods not yet started re-open.
--   6. tt_get_free_teachers_for_slot:
--        * `sub.id <> p_slot_id` compared a substitution id to a slot id
--          (always true); meant `sub.slot_id <> p_slot_id`.
--        * "busy" only matched the SAME period_slot_id, so a teacher teaching
--          at the same time in a class on another period structure (every
--          school here runs two) was offered as free.
--        * teachers inside an optional-group (basket) period were never busy.
--        * no caller check: any caller could list a school's free teachers.
--   7. anon held EXECUTE on the pass functions (where a NULL auth.uid() is the
--      trusted-cron branch), on tt_create_pending_subs_for_absent_staff and on
--      tt_get_free_teachers_for_slot. Revoked by name (CLAUDE.md §26).
--   8. tt_substitutions_select let every member of the school, students
--      included, read every cover row and its free-text reason. Staff only now
--      (plus the substitute themself).
--   9. New read-only tt_my_covers(from, to) for the teacher's My Week, which
--      never showed cover periods at all (isSubstitute was always false).
--
-- The nightly tt-notify-absence-pending job is RETIRED, not scheduled: it
-- flipped the original teacher's 'planned' lesson plan to 'pending', but the
-- lesson plan dialog no longer has status controls, so nobody could clear it.
-- The original teacher now sees "Covered by <name>" on that period instead.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helper: which academic_year code the institution's timetable runs on
-- ---------------------------------------------------------------------
-- Same resolution order as dash5_coord_ctx / tt_lesson_plan_export (the year
-- containing the date, then the active one, then the newest). Returns NULL,
-- meaning "do not filter", when no tt_slots carry that code, so a school whose
-- calendar and timetable disagree on the code keeps working as before.
CREATE OR REPLACE FUNCTION public.tt_timetable_ay_code(p_institution_id uuid, p_on date)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT ay.code INTO v_code
    FROM public.cal_academic_years ay
   WHERE ay.institution_id = p_institution_id
   ORDER BY (p_on BETWEEN ay.starts_on::date AND ay.ends_on::date) DESC,
            ay.is_active DESC,
            ay.starts_on::date DESC
   LIMIT 1;

  IF v_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tt_slots s
     WHERE s.institution_id = p_institution_id AND s.academic_year = v_code
  ) THEN
    v_code := NULL;
  END IF;

  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tt_timetable_ay_code(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tt_timetable_ay_code(uuid, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.tt_timetable_ay_code(uuid, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.tt_timetable_ay_code(uuid, date) TO service_role;

-- ---------------------------------------------------------------------
-- 1. Late check-in cancels only covers for periods that have not started
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_substitutions_cancel_on_late_checkin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fires when a staff row flips into present/late after having been
  -- absent. Auto-cancel still-pending subs for that staff today whose
  -- period hasn't started yet (5-minute buffer so subs already in
  -- progress aren't yanked). Period times are institution wall-clock, so
  -- "now" must be too (§24); UTC cancelled periods already taught.
  IF NEW.status NOT IN ('present','late') THEN
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT') OR (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.tt_substitutions sub
    SET status           = 'cancelled',
        cancelled_reason = 'Original teacher checked in',
        updated_at       = now()
    FROM public.tt_slots ss
    JOIN public.tt_period_slots ps ON ps.id = ss.period_slot_id
    JOIN public.institutions   i  ON i.id  = ss.institution_id
    WHERE sub.slot_id             = ss.id
      AND sub.original_teacher_id = NEW.staff_id
      AND sub.date                = NEW.date
      AND sub.status              = 'pending'
      AND (NEW.date + ps.start_time)
          > ((now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')) + INTERVAL '5 minutes');
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Pending covers: current timetable year, re-open after a late check-in
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_create_pending_subs_for_absent_staff(p_institution_id uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed  INTEGER := 0;
  v_day      TEXT := public.tt_dow_to_text(p_date);
  v_ay       TEXT := public.tt_timetable_ay_code(p_institution_id, p_date);
  v_now      TIMESTAMP;
BEGIN
  SELECT now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') INTO v_now
    FROM public.institutions i WHERE i.id = p_institution_id;

  -- One statement: both data-modifying CTEs read the same snapshot, so the
  -- INSERT skips (ON CONFLICT) exactly the cancelled rows the UPDATE re-opens
  -- and neither can touch a row the other wrote.
  WITH absent_staff AS (
    SELECT staff_id
    FROM public.staff_attendance_records
    WHERE institution_id = p_institution_id
      AND date           = p_date
      AND status         IN ('absent','on_leave')
  ),
  absent_periods AS (
  SELECT DISTINCT ON (x.slot_id) x.slot_id, x.teacher_id
  FROM (
    SELECT s.id AS slot_id, s.teacher_id
    FROM public.tt_slots s
    JOIN absent_staff a ON a.staff_id = s.teacher_id
    JOIN public.classes cl ON cl.id = s.class_id AND cl.is_active IS NOT FALSE
    WHERE s.institution_id = p_institution_id
      AND s.day            = v_day
      AND s.teacher_id IS NOT NULL
      AND s.slot_type NOT IN ('free','break')
      AND (v_ay IS NULL OR s.academic_year = v_ay)
    UNION
    -- Basket periods: resolve the absent teacher through the subject she
    -- teaches inside the basket. tt_substitutions cannot yet express
    -- "cover only the Political Science half", so one pending row per
    -- period is raised for a human to sort out.
    SELECT s.id AS slot_id, ca.user_id AS teacher_id
    FROM public.tt_slots s
    JOIN public.classes cl ON cl.id = s.class_id AND cl.is_active IS NOT FALSE
    JOIN public.optional_group_subjects ogs ON ogs.group_id = s.optional_group_id
    JOIN public.class_assignments ca ON ca.class_id = s.class_id
         AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher'
    JOIN absent_staff a2 ON a2.staff_id = ca.user_id
    WHERE s.institution_id = p_institution_id
      AND s.day            = v_day
      AND s.optional_group_id IS NOT NULL
      AND (v_ay IS NULL OR s.academic_year = v_ay)
  ) x
  ORDER BY x.slot_id, x.teacher_id
  ),
  inserted AS (
    INSERT INTO public.tt_substitutions
      (slot_id, date, original_teacher_id, status, source, created_by)
    SELECT ap.slot_id, p_date, ap.teacher_id, 'pending', 'auto', NULL
    FROM absent_periods ap
    ON CONFLICT (slot_id, date) DO NOTHING
    RETURNING 1
  ),
  -- A late check-in cancelled these; the teacher is absent again, so the
  -- periods still ahead need cover again. Only rows the check-in trigger
  -- cancelled, never one a person cancelled or one with a substitute on it.
  reopened AS (
    UPDATE public.tt_substitutions sub
       SET status           = 'pending',
           cancelled_reason = NULL,
           updated_at       = now()
      FROM absent_periods ap
      JOIN public.tt_slots s         ON s.id  = ap.slot_id
      JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
     WHERE sub.slot_id               = ap.slot_id
       AND sub.date                  = p_date
       AND sub.status                = 'cancelled'
       AND sub.cancelled_reason      = 'Original teacher checked in'
       AND sub.substitute_teacher_id IS NULL
       AND (p_date + ps.start_time)  > v_now
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM inserted) + (SELECT COUNT(*) FROM reopened)
    INTO v_changed;

  RETURN v_changed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tt_create_pending_subs_for_absent_staff(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tt_create_pending_subs_for_absent_staff(uuid, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.tt_create_pending_subs_for_absent_staff(uuid, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.tt_create_pending_subs_for_absent_staff(uuid, date) TO service_role;

-- ---------------------------------------------------------------------
-- 3. The attendance pass: local date, timetable year, close stale covers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_run_attendance_pass_for_institution(p_institution_id uuid)
RETURNS TABLE(institution_id uuid, staff_marked integer, subs_generated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today    DATE;
  v_settings RECORD;
  v_tz       TEXT;
  v_ay       TEXT;
  v_marked   INT := 0;
  v_subs     INT := 0;
BEGIN
  -- Caller authorization. The cron job invokes this with no auth context
  -- (auth.uid() IS NULL) and is trusted. anon has no EXECUTE any more, and a
  -- request that still arrives as anon is refused here as well, because a
  -- NULL uid is exactly the trusted branch. Otherwise require an admin or
  -- coordinator role scoped to the requested institution.
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'not authorized to run attendance pass' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT (
        public.has_role(auth.uid(), 'super_admin'::app_role)
     OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
     OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.institution_id = p_institution_id
            AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
        )
  ) THEN
    RAISE EXCEPTION 'not authorized to run attendance pass for institution %', p_institution_id
      USING ERRCODE = '42501';
  END IF;

  SELECT s.staff_check_in_time,
         s.staff_late_check_in_allowed,
         s.staff_late_grace_minutes,
         s.staff_substitution_enabled,
         i.timezone
  INTO v_settings
  FROM public.attendance_settings s
  JOIN public.institutions i ON i.id = s.institution_id
  WHERE s.institution_id = p_institution_id;

  IF NOT FOUND THEN
    RETURN; -- no settings row, nothing to do
  END IF;

  v_tz    := COALESCE(v_settings.timezone, 'Asia/Kolkata');
  -- Institution-local date (§24); the server's own date is the UTC one.
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_ay    := public.tt_timetable_ay_code(p_institution_id, v_today);

  -- Close covers left pending on days that are over. Nobody was assigned,
  -- so the period went uncovered; leaving them 'pending' forever made every
  -- sweep over tt_substitutions read them as still open. Runs every pass,
  -- before the cutoff gate, so yesterday closes first thing in the morning.
  UPDATE public.tt_substitutions sub
     SET status           = 'no_teacher_available',
         cancelled_reason = 'The day ended with no cover assigned',
         updated_at       = now()
    FROM public.tt_slots s
   WHERE s.id             = sub.slot_id
     AND s.institution_id = p_institution_id
     AND sub.status       = 'pending'
     AND sub.date         < v_today;

  -- Cutoff check in INSTITUTION-LOCAL time-of-day (§24).
  IF (now() AT TIME ZONE v_tz)::time
       < (v_settings.staff_check_in_time
          + CASE WHEN v_settings.staff_late_check_in_allowed
                 THEN make_interval(mins => v_settings.staff_late_grace_minutes)
                 ELSE INTERVAL '0' END)
  THEN
    institution_id := p_institution_id; staff_marked := 0; subs_generated := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Holiday short-circuit.
  IF EXISTS (
    SELECT 1 FROM public.cal_events e
    WHERE e.institution_id = p_institution_id
      AND e.kind = 'holiday'
      AND v_today BETWEEN e.starts_on AND e.ends_on
  ) THEN
    institution_id := p_institution_id; staff_marked := 0; subs_generated := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Auto-mark absent for every staff member with at least one slot today
  -- and no row yet. Runs REGARDLESS of staff_substitution_enabled (schools
  -- that don't want auto-subs still need correct attendance).
  WITH staff_today AS (
    SELECT DISTINCT s.teacher_id AS staff_id
    FROM public.tt_slots s
    WHERE s.institution_id = p_institution_id
      AND s.day            = public.tt_dow_to_text(v_today)
      AND s.teacher_id IS NOT NULL
      AND (v_ay IS NULL OR s.academic_year = v_ay)
    UNION
    -- Optional-group (basket) periods carry no teacher of their own, so a
    -- teacher rostered only into baskets was never auto-marked absent and
    -- their class read as covered.
    SELECT DISTINCT ca.user_id AS staff_id
    FROM public.tt_slots s
    JOIN public.optional_group_subjects ogs ON ogs.group_id = s.optional_group_id
    JOIN public.class_assignments ca ON ca.class_id = s.class_id
         AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher'
    WHERE s.institution_id = p_institution_id
      AND s.day            = public.tt_dow_to_text(v_today)
      AND s.optional_group_id IS NOT NULL
      AND (v_ay IS NULL OR s.academic_year = v_ay)
  ),
  inserted AS (
    INSERT INTO public.staff_attendance_records
      (institution_id, staff_id, date, status, auto_marked_absent)
    SELECT p_institution_id, st.staff_id, v_today, 'absent', TRUE
    FROM staff_today st
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_attendance_records sa
      WHERE sa.staff_id = st.staff_id AND sa.date = v_today
    )
    RETURNING staff_id
  )
  SELECT COUNT(*)::INT INTO v_marked FROM inserted;

  -- Subs only if the institution opted in.
  IF v_settings.staff_substitution_enabled THEN
    v_subs := public.tt_create_pending_subs_for_absent_staff(p_institution_id, v_today);
  END IF;

  institution_id := p_institution_id;
  staff_marked   := v_marked;
  subs_generated := v_subs;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tt_run_attendance_pass_for_institution(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tt_run_attendance_pass_for_institution(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.tt_run_attendance_pass_for_institution(uuid) TO authenticated, service_role;

-- The every-institution loop is cron-only (it runs as postgres). No client
-- calls it; an authenticated user reaching it would only error on the first
-- school they don't administer.
REVOKE EXECUTE ON FUNCTION public.tt_run_attendance_cron_pass() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tt_run_attendance_cron_pass() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tt_run_attendance_cron_pass() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.tt_run_attendance_cron_pass() TO postgres, service_role;

-- ---------------------------------------------------------------------
-- 4. Free-teacher ranking: time overlap, basket periods, caller check
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_get_free_teachers_for_slot(p_slot_id uuid, p_date date)
RETURNS TABLE(teacher_id uuid, full_name text, rank integer, same_subject boolean, same_class_group boolean, subs_today integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot           RECORD;
  v_settings       RECORD;
  v_day            TEXT;
  v_class_group_id UUID;
  v_max_subs       INTEGER := 2;
  v_include_coords BOOLEAN := FALSE;
  v_uid            UUID := auth.uid();
BEGIN
  SELECT s.id, s.class_id, s.period_slot_id, s.subject_id, s.teacher_id,
         s.academic_year, s.institution_id, c.class_group_id,
         ps.start_time, ps.end_time
  INTO v_slot
  FROM public.tt_slots s
  JOIN public.classes  c ON c.id = s.class_id
  JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
  WHERE s.id = p_slot_id;

  IF v_slot.id IS NULL THEN
    RETURN;
  END IF;

  -- Only someone who may arrange cover for this class sees who is free.
  -- Returns nothing rather than raising so dash5_coord_cover, which counts
  -- these rows per period, degrades to "0 free" instead of failing whole.
  -- A NULL uid is a server context (service role); anon holds no EXECUTE.
  IF v_uid IS NOT NULL AND NOT public.tt_user_can_edit_class_slots(v_uid, v_slot.class_id) THEN
    RETURN;
  END IF;

  v_day := public.tt_dow_to_text(p_date);
  v_class_group_id := v_slot.class_group_id;

  SELECT max_subs_per_teacher_per_day, coordinators_in_sub_pool
  INTO v_settings
  FROM public.attendance_settings
  WHERE institution_id = v_slot.institution_id;

  IF v_settings.max_subs_per_teacher_per_day IS NOT NULL THEN
    v_max_subs := v_settings.max_subs_per_teacher_per_day;
  END IF;
  IF v_settings.coordinators_in_sub_pool IS NOT NULL THEN
    v_include_coords := v_settings.coordinators_in_sub_pool;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT DISTINCT p.id, p.full_name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.institution_id = v_slot.institution_id
      AND p.is_active IS NOT FALSE
      AND p.id <> COALESCE(v_slot.teacher_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        ur.role = 'teacher'
        OR (v_include_coords AND ur.role = 'coordinator')
      )
  ),
  -- Every period in the school on that weekday and year whose TIME overlaps
  -- the one needing cover, whatever period structure it belongs to. Matching
  -- on period_slot_id alone missed the second structure entirely. Exclusive
  -- bounds, so back-to-back periods do not collide (same rule as
  -- tt_prevent_overlapping_period_slots).
  overlapping AS (
    SELECT s2.id, s2.teacher_id, s2.class_id, s2.optional_group_id
    FROM public.tt_slots s2
    JOIN public.tt_period_slots ps2 ON ps2.id = s2.period_slot_id
    WHERE s2.institution_id = v_slot.institution_id
      AND s2.day            = v_day
      AND s2.academic_year  = v_slot.academic_year
      AND ps2.start_time    < v_slot.end_time
      AND ps2.end_time      > v_slot.start_time
  ),
  busy_at_period AS (
    SELECT o.teacher_id
    FROM overlapping o
    WHERE o.teacher_id IS NOT NULL
    UNION
    -- Basket periods carry no teacher; the teachers of the basket's subjects
    -- in that class are the ones in the room.
    SELECT ca.user_id
    FROM overlapping o
    JOIN public.optional_group_subjects ogs ON ogs.group_id = o.optional_group_id
    JOIN public.class_assignments ca ON ca.class_id = o.class_id
         AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher'
    WHERE o.optional_group_id IS NOT NULL
    UNION
    -- Already covering another overlapping period on this date.
    SELECT sub.substitute_teacher_id
    FROM public.tt_substitutions sub
    JOIN overlapping o ON o.id = sub.slot_id
    WHERE sub.date = p_date
      AND sub.substitute_teacher_id IS NOT NULL
      AND sub.status IN ('assigned','completed','pending')
      AND sub.slot_id <> p_slot_id
  ),
  unavailable AS (
    SELECT staff_id AS id
    FROM public.staff_attendance_records
    WHERE date = p_date
      AND status IN ('absent','on_leave','holiday')
  ),
  sub_counts AS (
    SELECT substitute_teacher_id AS id, COUNT(*)::INTEGER AS n
    FROM public.tt_substitutions
    WHERE date = p_date
      AND status IN ('assigned','completed')
      AND substitute_teacher_id IS NOT NULL
    GROUP BY substitute_teacher_id
  ),
  ranked AS (
    SELECT
      c.id   AS teacher_id,
      c.full_name,
      EXISTS (
        SELECT 1
        FROM public.tt_slots ss
        WHERE ss.teacher_id = c.id
          AND ss.subject_id = v_slot.subject_id
          AND ss.academic_year = v_slot.academic_year
          AND v_slot.subject_id IS NOT NULL
      ) AS same_subject,
      EXISTS (
        SELECT 1
        FROM public.tt_slots ss
        JOIN public.classes cc ON cc.id = ss.class_id
        WHERE ss.teacher_id = c.id
          AND ss.academic_year = v_slot.academic_year
          AND cc.class_group_id = v_class_group_id
          AND v_class_group_id IS NOT NULL
      ) AS same_class_group,
      COALESCE(sc.n, 0) AS subs_today
    FROM candidates c
    LEFT JOIN sub_counts sc ON sc.id = c.id
    WHERE NOT EXISTS (SELECT 1 FROM busy_at_period bp WHERE bp.teacher_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM unavailable un WHERE un.id = c.id)
      AND COALESCE(sc.n, 0) < v_max_subs
  )
  SELECT
    r.teacher_id,
    r.full_name,
    CASE
      WHEN r.same_subject     THEN 1
      WHEN r.same_class_group THEN 2
      ELSE 3
    END AS rank,
    r.same_subject,
    r.same_class_group,
    r.subs_today
  FROM ranked r
  ORDER BY rank ASC, r.subs_today ASC, r.full_name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tt_get_free_teachers_for_slot(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tt_get_free_teachers_for_slot(uuid, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.tt_get_free_teachers_for_slot(uuid, date) TO authenticated, service_role;

-- Guarded on auth.uid() already; strip the anon grant anyway (§26).
REVOKE EXECUTE ON FUNCTION public.tt_assign_substitute(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tt_assign_substitute(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.tt_assign_substitute(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Read access: staff of the school, and the substitute themself
-- ---------------------------------------------------------------------
-- Was any member of the institution, students included, which exposed every
-- cover's free-text reason ("sick leave", ...). No student surface reads this
-- table. Helpers are SECURITY DEFINER and wrapped per §23.
DROP POLICY IF EXISTS tt_substitutions_select ON public.tt_substitutions;
CREATE POLICY tt_substitutions_select ON public.tt_substitutions
  FOR SELECT TO authenticated
  USING (
    substitute_teacher_id = (select auth.uid())
    OR (
      public.tt_slot_institution(slot_id) = (select public.get_user_institution(auth.uid()))
      AND NOT (select public.has_role(auth.uid(), 'student'::app_role))
    )
  );

-- ---------------------------------------------------------------------
-- 6. tt_my_covers: the caller's covers for My Week
-- ---------------------------------------------------------------------
-- Both directions in one call: periods the caller is covering for someone
-- ('covering') and the caller's own periods someone else is covering
-- ('covered'). Only real covers (assigned/completed). Window capped at 62
-- days and 500 rows; the page asks for one week.
CREATE OR REPLACE FUNCTION public.tt_my_covers(p_from date, p_to date)
RETURNS TABLE(
  substitution_id    uuid,
  slot_id            uuid,
  cover_date         date,
  cover_role         text,
  class_id           uuid,
  class_name         text,
  class_section      text,
  subject_id         uuid,
  subject_name       text,
  period_label       text,
  start_time         time,
  end_time           time,
  other_teacher_name text,
  reason             text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sub.id,
         sub.slot_id,
         sub.date,
         CASE WHEN sub.substitute_teacher_id = (select auth.uid()) THEN 'covering' ELSE 'covered' END,
         s.class_id,
         c.name::text,
         c.section::text,
         s.subject_id,
         COALESCE(us.name, og.name)::text,
         ps.label::text,
         ps.start_time,
         ps.end_time,
         CASE WHEN sub.substitute_teacher_id = (select auth.uid())
              THEN ot.full_name ELSE st.full_name END::text,
         sub.reason
    FROM public.tt_substitutions sub
    JOIN public.tt_slots s         ON s.id  = sub.slot_id
    JOIN public.classes c          ON c.id  = s.class_id
    JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
    LEFT JOIN public.universal_subjects us ON us.id = s.subject_id
    LEFT JOIN public.optional_groups og    ON og.id = s.optional_group_id
    LEFT JOIN public.profiles ot ON ot.id = sub.original_teacher_id
    LEFT JOIN public.profiles st ON st.id = sub.substitute_teacher_id
   WHERE (select auth.uid()) IS NOT NULL
     AND sub.status IN ('assigned','completed')
     AND sub.substitute_teacher_id IS NOT NULL
     AND (sub.substitute_teacher_id = (select auth.uid())
          OR sub.original_teacher_id = (select auth.uid()))
     AND sub.date BETWEEN p_from AND LEAST(p_to, p_from + 62)
   ORDER BY sub.date, ps.start_time
   LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION public.tt_my_covers(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tt_my_covers(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.tt_my_covers(date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. One-time close of the stale pending backlog (backed up first)
-- ---------------------------------------------------------------------
-- Rollback:
--   UPDATE public.tt_substitutions t
--      SET status = b.status, cancelled_reason = b.cancelled_reason, updated_at = b.updated_at
--     FROM salci_backups.tt_substitutions_pending_20260925 b WHERE b.id = t.id;
CREATE SCHEMA IF NOT EXISTS salci_backups;
CREATE TABLE IF NOT EXISTS salci_backups.tt_substitutions_pending_20260925 AS
  SELECT id, slot_id, date, status, cancelled_reason, updated_at
    FROM public.tt_substitutions
   WHERE false;
INSERT INTO salci_backups.tt_substitutions_pending_20260925 (id, slot_id, date, status, cancelled_reason, updated_at)
SELECT t.id, t.slot_id, t.date, t.status, t.cancelled_reason, t.updated_at
  FROM public.tt_substitutions t
  JOIN public.tt_slots s ON s.id = t.slot_id
  JOIN public.institutions i ON i.id = s.institution_id
 WHERE t.status = 'pending'
   AND t.date < (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date
   AND NOT EXISTS (SELECT 1 FROM salci_backups.tt_substitutions_pending_20260925 b WHERE b.id = t.id);
REVOKE ALL ON SCHEMA salci_backups FROM anon, authenticated;
REVOKE ALL ON salci_backups.tt_substitutions_pending_20260925 FROM PUBLIC, anon, authenticated;

UPDATE public.tt_substitutions t
   SET status           = 'no_teacher_available',
       cancelled_reason = 'The day ended with no cover assigned',
       updated_at       = now()
  FROM salci_backups.tt_substitutions_pending_20260925 b
 WHERE b.id = t.id
   AND t.status = 'pending';
