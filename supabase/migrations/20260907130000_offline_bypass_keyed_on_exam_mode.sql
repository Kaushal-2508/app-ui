-- =============================================================
-- validate_attempt_creation(): the staff offline bypass follows the EXAM's mode
-- -------------------------------------------------------------
-- APPLIED TO PROD 2026-09-07 via scripts/run-sql.ps1. Verified in pg_proc (keyed on mode,
-- refuses archived, online path intact) and functionally (rolled back): a teacher's
-- offline insert on a closed ONLINE exam -> P0001 "Exam time window has expired"; the
-- same insert on a closed HYBRID exam -> succeeds. Do not edit; write a new file.
--
-- 20260904130000 (applied 2026-09-05) let staff record a paper mark after the
-- exam window closed by skipping the status/time checks when the row is an
-- offline attempt created by someone other than the student. It keyed that on
-- NEW.is_offline, which is supplied by whoever inserts the row. Students cannot
-- reach it (they have no direct INSERT policy and start_exam_attempt hard-codes
-- student_id := auth.uid() with no is_offline), but any teacher assigned to the
-- class could insert {is_offline: true, is_submitted: true} for a student who
-- never sat an ONLINE exam, weeks after it closed, and the row would be
-- accepted. Review finding, 2026-09-05.
--
-- Fix: the bypass now also requires the exam itself to be a paper exam
-- (exams.exam_mode IN ('offline','hybrid') OR exams.is_results_only), so an
-- online exam keeps its window for everyone. 'archived' joins 'draft' as a
-- status that never receives new attempts. The online path (auth.uid() =
-- NEW.student_id, is_offline false) is byte-for-byte unchanged.
--
-- Full re-emit of the 20260904130000 body; the only changes are the two new
-- DECLARE entries, the widened SELECT, the COALESCE'd bypass expression, and
-- 'archived' in the refusal list.
-- =============================================================

CREATE OR REPLACE FUNCTION public.validate_attempt_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_status  public.exam_status;
  v_start_time   TIMESTAMP WITH TIME ZONE;
  v_end_time     TIMESTAMP WITH TIME ZONE;
  v_exam_mode    public.exam_mode;
  v_results_only BOOLEAN;
  -- A paper exam's marks are entered by staff, not started by the pupil.
  v_staff_entry BOOLEAN :=
    COALESCE(NEW.is_offline, false)
    AND (SELECT auth.uid()) IS DISTINCT FROM NEW.student_id;
  v_staff_offline_entry BOOLEAN := false;
BEGIN
  SELECT status, start_time, end_time, exam_mode, COALESCE(is_results_only, false)
  INTO v_exam_status, v_start_time, v_end_time, v_exam_mode, v_results_only
  FROM public.exams WHERE id = NEW.exam_id;

  -- The bypass needs BOTH: a staff-created offline row AND a paper exam. A NULL
  -- exam_mode must read as "not a paper exam", hence the COALESCE: plpgsql's
  -- IF treats NULL as false, which would otherwise fall through to the ELSE
  -- branch and grant the bypass.
  v_staff_offline_entry := COALESCE(
    v_staff_entry AND (v_exam_mode IN ('offline', 'hybrid') OR v_results_only),
    false);

  IF NOT v_staff_offline_entry THEN
    -- Online: the pupil is starting the exam now, so the window matters.
    IF v_exam_status NOT IN ('published', 'active') THEN
      RAISE EXCEPTION 'Exam is not available for attempts';
    END IF;

    IF v_start_time IS NOT NULL AND now() < v_start_time THEN
      RAISE EXCEPTION 'Exam has not started yet';
    END IF;

    IF v_end_time IS NOT NULL AND now() > v_end_time THEN
      RAISE EXCEPTION 'Exam time window has expired';
    END IF;
  ELSE
    -- Paper exam, entered by staff: drafts and archived exams are off limits.
    -- Published, active and completed exams all legitimately receive paper
    -- marks late.
    IF v_exam_status IN ('draft', 'archived') THEN
      RAISE EXCEPTION 'Exam is not available for attempts';
    END IF;
  END IF;

  -- Everyone: the student must belong to a class this exam is set for.
  IF NOT public.is_student_assigned_to_exam(NEW.student_id, NEW.exam_id) THEN
    RAISE EXCEPTION 'Student is not assigned to this exam';
  END IF;

  NEW.started_at := now();
  NEW.last_activity_at := now();

  RETURN NEW;
END;
$$;

-- The trigger (validate_attempt_start, BEFORE INSERT ON student_exam_attempts)
-- is unchanged; only the function body is replaced. A function returning
-- TRIGGER cannot be called through PostgREST, so no grant changes.
--
-- Verify after applying:
--   SELECT prosrc LIKE '%v_exam_mode IN (''offline'', ''hybrid'')%' AS keyed_on_mode,
--          prosrc LIKE '%(''draft'', ''archived'')%'                  AS refuses_archived
--   FROM pg_proc WHERE proname = 'validate_attempt_creation';
-- and, as a teacher: a late offline mark on a closed HYBRID or results-only
-- exam still saves; the same insert against a closed ONLINE exam is refused
-- with "Exam time window has expired".
