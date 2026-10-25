-- 20260525120000_attendance_tz_fix_and_admin_override.sql
--
-- Attendance — timezone fix + instant materialization RPC + admin override.
-- See docs/superpowers/specs/2026-05-25-attendance-tz-fix-and-admin-override-design.md
--
-- Three changes:
--  (A1) institutions.timezone column (default 'Asia/Kolkata' — all current
--       SALCI institutions are Indian; future non-IST schools change the column).
--  (A2) tt_run_attendance_pass_for_institution(uuid) — reusable per-inst body
--       with institution-local time-of-day comparison, decoupled from the
--       substitution feature flag (sub flag now only gates sub generation).
--  (A3) tt_run_attendance_cron_pass() rewritten to delegate to (A2).
--  (C3) RLS INSERT/UPDATE/DELETE policies on staff_attendance_records for admin
--       override.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- (A1) institutions.timezone
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

COMMENT ON COLUMN public.institutions.timezone IS
  'IANA timezone name (e.g. Asia/Kolkata). Used by the attendance cron to compare local time-of-day to staff_check_in_time, and by any future feature that needs institution-local time. Defaults to Asia/Kolkata since SALCI is India-only today.';

-- ─────────────────────────────────────────────────────────────────────
-- (A2) tt_run_attendance_pass_for_institution(uuid)
--
-- Per-institution body. Called by both the cron (every 15 min) and the
-- client RPC (when an admin/coordinator lands on the Attendance page past
-- local cutoff — skips the 15-min lag). Idempotent: UNIQUE(staff_id,date)
-- + UNIQUE(slot_id,date) prevent duplicate work.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tt_run_attendance_pass_for_institution(p_institution_id UUID)
RETURNS TABLE(institution_id UUID, staff_marked INT, subs_generated INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_today    DATE := CURRENT_DATE;
  v_settings RECORD;
  v_tz       TEXT;
  v_marked   INT := 0;
  v_subs     INT := 0;
BEGIN
  -- Caller authorization. The cron job invokes this with no auth context
  -- (auth.uid() IS NULL) and is trusted. Otherwise require an admin or
  -- coordinator role scoped to the requested institution.
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
    RETURN; -- no settings row → nothing to do
  END IF;

  v_tz := COALESCE(v_settings.timezone, 'Asia/Kolkata');

  -- Cutoff check in INSTITUTION-LOCAL time-of-day. The pre-existing cron
  -- compared (now() AT TIME ZONE 'UTC')::time to a TIME column that is
  -- stored as wall-clock — wrong for IST schools (auto-mark fired at
  -- ~14:00 IST instead of ~08:30 IST). See CLAUDE.md §24.
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

  -- Holiday short-circuit (unchanged behavior).
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
  -- and no row yet. Runs REGARDLESS of staff_substitution_enabled (the
  -- pre-existing cron coupled the two — wrong: schools that don't want
  -- auto-subs still need correct attendance).
  WITH staff_today AS (
    SELECT DISTINCT s.teacher_id AS staff_id
    FROM public.tt_slots s
    WHERE s.institution_id = p_institution_id
      AND s.day            = public.tt_dow_to_text(v_today)
      AND s.teacher_id IS NOT NULL
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

REVOKE ALL ON FUNCTION public.tt_run_attendance_pass_for_institution(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tt_run_attendance_pass_for_institution(UUID) TO authenticated;

COMMENT ON FUNCTION public.tt_run_attendance_pass_for_institution(UUID) IS
  'Auto-mark absent + generate pending subs for one institution. Idempotent. Called by tt_run_attendance_cron_pass every 15 min AND by the client when an admin/coordinator lands on the Attendance page past cutoff (skips the cron lag).';

-- ─────────────────────────────────────────────────────────────────────
-- (A3) tt_run_attendance_cron_pass() — now just a loop
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tt_run_attendance_cron_pass()
RETURNS TABLE(institution_id UUID, staff_marked INT, subs_generated INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT s.institution_id FROM public.attendance_settings s LOOP
    RETURN QUERY SELECT * FROM public.tt_run_attendance_pass_for_institution(r.institution_id);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tt_run_attendance_cron_pass() IS
  '15-min fallback. Loops every institution with attendance_settings and calls tt_run_attendance_pass_for_institution. Live admin views fire the per-institution function directly via RPC so they do not wait for the next tick.';

-- ─────────────────────────────────────────────────────────────────────
-- (C3) RLS INSERT/UPDATE/DELETE policies on staff_attendance_records
--
-- The base table already has SELECT + self-INSERT policies from phase 1.
-- Admin override needs to UPSERT and DELETE arbitrary teachers' rows.
-- DROP IF EXISTS first so the migration is idempotent across re-runs.
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can insert staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Admins can insert staff attendance"
  ON public.staff_attendance_records
  FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.institution_id = staff_attendance_records.institution_id
        AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
    )
  );

DROP POLICY IF EXISTS "Admins can update staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Admins can update staff attendance"
  ON public.staff_attendance_records
  FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.institution_id = staff_attendance_records.institution_id
        AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.institution_id = staff_attendance_records.institution_id
        AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
    )
  );

DROP POLICY IF EXISTS "Admins can delete staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Admins can delete staff attendance"
  ON public.staff_attendance_records
  FOR DELETE
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.institution_id = staff_attendance_records.institution_id
        AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
    )
  );

COMMIT;
