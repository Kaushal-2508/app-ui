-- 20260811120000_attendance_edit_window_days_and_guard.sql
--
-- Class attendance date navigation + 2-day edit window
-- (spec: docs/superpowers/specs/2026-08-11-attendance-date-window-design.md)
--
-- 1. attendance_settings.student_attendance_edit_window_days (default 2)
--    replaces the hours-based window for the class-marker flow. The old
--    student_attendance_edit_window_hours column stays (unused) to avoid
--    a destructive drop.
--
-- 2. BEFORE INSERT OR UPDATE trigger on attendance_records enforcing,
--    for non-admin authenticated writers (teachers):
--      - no future dates
--      - date within (today - window_days .. today), where "today" is the
--        institution's local date (CLAUDE.md §24 — never bare CURRENT_DATE)
--      - an existing row marked by another user cannot be overwritten
--    Service-role writes (auth.uid() IS NULL: crons, edge functions) and
--    super/institution admins are exempt, matching their full-access RLS.
--    Until now the 12h lock was UI-only — nothing stopped a crafted API call.

ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS student_attendance_edit_window_days INTEGER NOT NULL DEFAULT 2;

CREATE OR REPLACE FUNCTION public.enforce_student_attendance_edit_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _today date;
  _window_days integer;
BEGIN
  -- Service-role / cron writes carry no user context.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_super_admin(_uid)
     OR public.is_institution_admin(_uid, NEW.institution_id) THEN
    RETURN NEW;
  END IF;

  SELECT (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date
    INTO _today
    FROM public.institutions i
   WHERE i.id = NEW.institution_id;
  IF _today IS NULL THEN
    _today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;

  SELECT s.student_attendance_edit_window_days
    INTO _window_days
    FROM public.attendance_settings s
   WHERE s.institution_id = NEW.institution_id;
  _window_days := COALESCE(_window_days, 2);

  -- Messages are short and non-technical on purpose: they surface directly
  -- in the UI via toastError/isLikelyUserFriendly.
  IF NEW.date > _today THEN
    RAISE EXCEPTION 'Attendance cannot be marked for a future date.';
  END IF;

  IF NEW.date < _today - _window_days THEN
    RAISE EXCEPTION 'Attendance older than % days can only be changed by an admin.', _window_days;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.marked_by IS NOT NULL
     AND OLD.marked_by <> _uid THEN
    RAISE EXCEPTION 'Only the teacher who marked this attendance can change it.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_student_attendance_edit_window
  ON public.attendance_records;
CREATE TRIGGER trg_enforce_student_attendance_edit_window
  BEFORE INSERT OR UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_attendance_edit_window();
