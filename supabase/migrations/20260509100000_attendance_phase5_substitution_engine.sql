-- =====================================================================
-- Attendance Phase 5 — Substitution engine
-- =====================================================================
-- Builds the auto-flow that runs at the staff check-in cutoff:
--
--   1. tt_get_free_teachers_for_slot(slot, date)
--      SECURITY DEFINER. Returns a ranked candidate list:
--        rank 1 — teaches the same subject in any class (best fit)
--        rank 2 — teaches in the same class_group (knows the kids)
--        rank 3 — any other teacher in the institution
--      Excluding: original teacher, teachers already busy at the same
--      period slot on that day, teachers absent / on leave / holiday,
--      teachers who have hit the max-subs-per-day cap, and (by default)
--      coordinators — unless `attendance_settings.coordinators_in_sub_pool`
--      is true.
--
--   2. tt_assign_substitute(sub_id, candidate_id)
--      SECURITY DEFINER. Lets a coordinator (or admin) accept a
--      candidate from the free-teacher list. Re-validates availability
--      so two coordinators racing on the same row can't double-book.
--      Honors the existing tt_user_can_edit_class_slots() write check.
--
--   3. tt_create_pending_subs_for_absent_staff(institution_id, date)
--      SECURITY DEFINER. For every absent staff row, spawns a pending
--      tt_substitutions row per matching tt_slot. Idempotent — the
--      UNIQUE(slot_id, date) constraint guards repeats.
--
--   4. tt_run_attendance_cron_pass()
--      SECURITY DEFINER. The hourly cron entry-point. For every
--      institution that has substitutions enabled, if the cutoff has
--      passed and today isn't a school-wide holiday: insert
--      auto-marked-absent staff_attendance rows for everyone who
--      didn't check in, then call (3).
--
--   5. tt_substitutions_cancel_on_late_checkin
--      AFTER UPDATE trigger on staff_attendance_records. When a teacher
--      flips from absent → present/late (i.e. they walked in late),
--      cancel any STILL-PENDING substitutions for their future periods
--      today. Subs that are already assigned stay — coverage already
--      happened.
--
--   6. pg_cron schedule — every 15 minutes runs the pass. The
--      function is idempotent and per-institution time-gated, so
--      running too often is harmless.
--
-- All functions are SECURITY DEFINER and search_path-locked. They are
-- granted EXECUTE to authenticated; the (1) and (3)+ functions also
-- need EXECUTE on cron's behalf — pg_cron runs as superuser by default
-- in Supabase managed projects, so no extra grant.

-- ---------------------------------------------------------------------
-- Helper: postgres-day-of-week ↔ tt_slots.day text mapping.
-- tt_slots.day is lowercase 'monday'..'sunday'; EXTRACT(ISODOW)
-- returns 1=Mon..7=Sun. We avoid an array literal to keep this
-- inlinable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_dow_to_text(p_date DATE)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE EXTRACT(ISODOW FROM p_date)::INTEGER
    WHEN 1 THEN 'monday'
    WHEN 2 THEN 'tuesday'
    WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday'
    WHEN 5 THEN 'friday'
    WHEN 6 THEN 'saturday'
    WHEN 7 THEN 'sunday'
  END
$$;

-- ---------------------------------------------------------------------
-- 1. tt_get_free_teachers_for_slot
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tt_get_free_teachers_for_slot(UUID, DATE);
CREATE OR REPLACE FUNCTION public.tt_get_free_teachers_for_slot(
  p_slot_id UUID,
  p_date    DATE
)
RETURNS TABLE (
  teacher_id        UUID,
  full_name         TEXT,
  rank              INTEGER,
  same_subject      BOOLEAN,
  same_class_group  BOOLEAN,
  subs_today        INTEGER
)
LANGUAGE plpgsql
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
BEGIN
  SELECT s.id, s.class_id, s.period_slot_id, s.subject_id, s.teacher_id,
         s.academic_year, s.institution_id, c.class_group_id
  INTO v_slot
  FROM public.tt_slots s
  JOIN public.classes  c ON c.id = s.class_id
  WHERE s.id = p_slot_id;

  IF v_slot.id IS NULL THEN
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
  busy_at_period AS (
    -- Same period_slot_id on the same weekday in the same AY → busy.
    SELECT s2.teacher_id
    FROM public.tt_slots s2
    WHERE s2.period_slot_id = v_slot.period_slot_id
      AND s2.day = v_day
      AND s2.academic_year = v_slot.academic_year
      AND s2.teacher_id IS NOT NULL
    UNION
    -- Already a substitute for some other slot at the same period_slot
    -- on this date.
    SELECT sub.substitute_teacher_id
    FROM public.tt_substitutions sub
    JOIN public.tt_slots ss ON ss.id = sub.slot_id
    WHERE sub.date = p_date
      AND ss.period_slot_id = v_slot.period_slot_id
      AND sub.substitute_teacher_id IS NOT NULL
      AND sub.status IN ('assigned','completed','pending')
      AND sub.id <> COALESCE(p_slot_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
          AND v_slot.subject_id IS NOT NULL
      ) AS same_subject,
      EXISTS (
        SELECT 1
        FROM public.tt_slots ss
        JOIN public.classes cc ON cc.id = ss.class_id
        WHERE ss.teacher_id = c.id
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

GRANT EXECUTE ON FUNCTION public.tt_get_free_teachers_for_slot(UUID, DATE)
  TO authenticated;

-- ---------------------------------------------------------------------
-- 2. tt_assign_substitute
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tt_assign_substitute(UUID, UUID);
CREATE OR REPLACE FUNCTION public.tt_assign_substitute(
  p_sub_id        UUID,
  p_substitute_id UUID
)
RETURNS public.tt_substitutions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub      public.tt_substitutions;
  v_class_id UUID;
  v_actor    UUID := auth.uid();
  v_ok       BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_sub
  FROM public.tt_substitutions
  WHERE id = p_sub_id
  FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'Substitution not found';
  END IF;

  IF v_sub.status NOT IN ('pending') THEN
    RAISE EXCEPTION 'This substitution has already been actioned';
  END IF;

  SELECT class_id INTO v_class_id FROM public.tt_slots WHERE id = v_sub.slot_id;

  -- Reuse the existing slot-edit authorization helper.
  SELECT public.tt_user_can_edit_class_slots(v_actor, v_class_id) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'You don''t have permission to assign a substitute for this class';
  END IF;

  -- Re-validate the candidate is still free.
  IF NOT EXISTS (
    SELECT 1 FROM public.tt_get_free_teachers_for_slot(v_sub.slot_id, v_sub.date) f
    WHERE f.teacher_id = p_substitute_id
  ) THEN
    RAISE EXCEPTION 'That teacher is no longer available for this period';
  END IF;

  UPDATE public.tt_substitutions
  SET substitute_teacher_id = p_substitute_id,
      status                = 'assigned',
      assigned_by           = v_actor,
      assigned_at           = now()
  WHERE id = p_sub_id
  RETURNING * INTO v_sub;

  RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tt_assign_substitute(UUID, UUID)
  TO authenticated;

-- ---------------------------------------------------------------------
-- 3. tt_create_pending_subs_for_absent_staff
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tt_create_pending_subs_for_absent_staff(UUID, DATE);
CREATE OR REPLACE FUNCTION public.tt_create_pending_subs_for_absent_staff(
  p_institution_id UUID,
  p_date           DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_day      TEXT := public.tt_dow_to_text(p_date);
BEGIN
  WITH absent_staff AS (
    SELECT staff_id
    FROM public.staff_attendance_records
    WHERE institution_id = p_institution_id
      AND date           = p_date
      AND status         IN ('absent','on_leave')
  ),
  inserted AS (
    INSERT INTO public.tt_substitutions
      (slot_id, date, original_teacher_id, status, source, created_by)
    SELECT s.id, p_date, s.teacher_id, 'pending', 'auto', NULL
    FROM public.tt_slots s
    JOIN absent_staff a ON a.staff_id = s.teacher_id
    WHERE s.institution_id = p_institution_id
      AND s.day            = v_day
      AND s.teacher_id IS NOT NULL
    ON CONFLICT (slot_id, date) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tt_create_pending_subs_for_absent_staff(UUID, DATE)
  TO authenticated;

-- ---------------------------------------------------------------------
-- 4. tt_run_attendance_cron_pass — hourly entry point
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tt_run_attendance_cron_pass();
CREATE OR REPLACE FUNCTION public.tt_run_attendance_cron_pass()
RETURNS TABLE (
  institution_id   UUID,
  staff_marked     INTEGER,
  subs_generated   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  r       RECORD;
BEGIN
  FOR r IN
    SELECT s.institution_id,
           s.staff_check_in_time,
           s.staff_late_check_in_allowed,
           s.staff_late_grace_minutes,
           s.staff_substitution_enabled
    FROM public.attendance_settings s
  LOOP
    -- Skip if substitution is disabled for this institution.
    IF NOT r.staff_substitution_enabled THEN
      CONTINUE;
    END IF;

    -- Skip if the cutoff hasn't passed yet (now < check_in + grace).
    IF (now() AT TIME ZONE 'UTC')::time
       < (r.staff_check_in_time
          + CASE WHEN r.staff_late_check_in_allowed
                 THEN make_interval(mins => r.staff_late_grace_minutes)
                 ELSE INTERVAL '0' END)
    THEN
      CONTINUE;
    END IF;

    -- Skip if today is a school-wide holiday (cal_events).
    IF EXISTS (
      SELECT 1 FROM public.cal_events e
      WHERE e.institution_id = r.institution_id
        AND e.kind = 'holiday'
        AND v_today BETWEEN e.starts_on AND e.ends_on
    ) THEN
      CONTINUE;
    END IF;

    -- Auto-mark absent every teacher / coordinator who has no row yet
    -- for today AND has at least one tt_slot scheduled for this weekday
    -- (no point marking a phys-ed teacher absent on a day they don't teach).
    WITH staff_today AS (
      SELECT DISTINCT s.teacher_id AS staff_id
      FROM public.tt_slots s
      WHERE s.institution_id = r.institution_id
        AND s.day            = public.tt_dow_to_text(v_today)
        AND s.teacher_id IS NOT NULL
    ),
    inserted AS (
      INSERT INTO public.staff_attendance_records
        (institution_id, staff_id, date, status, auto_marked_absent)
      SELECT r.institution_id, st.staff_id, v_today, 'absent', TRUE
      FROM staff_today st
      WHERE NOT EXISTS (
        SELECT 1 FROM public.staff_attendance_records sa
        WHERE sa.staff_id = st.staff_id AND sa.date = v_today
      )
      RETURNING staff_id
    )
    SELECT COUNT(*)::INTEGER INTO staff_marked FROM inserted;

    -- Generate pending subs for the newly-absent set (and any pre-existing
    -- absent rows that didn't get subs yet).
    subs_generated := public.tt_create_pending_subs_for_absent_staff(r.institution_id, v_today);
    institution_id := r.institution_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- pg_cron will invoke this from an extensions schema function call;
-- grant EXECUTE to postgres so the cron runner (which executes as the
-- DB owner on Supabase) can call it. authenticated grant is included
-- so admins can manually trigger a pass from the dashboard if needed.
GRANT EXECUTE ON FUNCTION public.tt_run_attendance_cron_pass()
  TO authenticated, postgres;

-- ---------------------------------------------------------------------
-- 5. Late check-in cancels still-pending substitutions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_substitutions_cancel_on_late_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fires when a staff row flips into present/late after having been
  -- absent. Auto-cancel still-pending subs for that staff today whose
  -- period hasn't started yet (5-minute buffer so subs already in
  -- progress aren't yanked).
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
    WHERE sub.slot_id            = ss.id
      AND sub.original_teacher_id = NEW.staff_id
      AND sub.date               = NEW.date
      AND sub.status             = 'pending'
      AND (NEW.date + ps.start_time) > (now() AT TIME ZONE 'UTC' + INTERVAL '5 minutes');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tt_substitutions_cancel_on_late_checkin_trg
  ON public.staff_attendance_records;
CREATE TRIGGER tt_substitutions_cancel_on_late_checkin_trg
  AFTER INSERT OR UPDATE OF status ON public.staff_attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.tt_substitutions_cancel_on_late_checkin();

-- ---------------------------------------------------------------------
-- 6. pg_cron schedule
-- ---------------------------------------------------------------------
-- Run every 15 minutes. The function is per-institution time-gated so
-- frequent runs are cheap. Idempotent against re-marking.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Drop any pre-existing schedule with the same name first so this
    -- migration is rerunnable.
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'tt-attendance-substitution-pass';

    PERFORM cron.schedule(
      'tt-attendance-substitution-pass',
      '*/15 * * * *',
      $job$ SELECT public.tt_run_attendance_cron_pass(); $job$
    );
  END IF;
END;
$$;
