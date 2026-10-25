-- =============================================================
-- Offline marks entry: staff may record a mark after the exam window closes
-- -------------------------------------------------------------
-- Reported 2026-09-04 on a results-only offline exam ("jih"): after results
-- were published, entering a mark for a student who had none yet failed with
-- the generic toast "That action isn't allowed right now" (SQLSTATE P0001).
--
-- Root cause: a student with no mark has no student_exam_attempts row, so the
-- marks save INSERTs one (is_offline = true). The BEFORE INSERT trigger
-- validate_attempt_start -> validate_attempt_creation() (migration
-- 20260104120228) validates that insert as if a pupil were sitting down to
-- START the exam online: status must be published/active, now() must be inside
-- start_time..end_time. For a paper exam those checks are meaningless - the
-- exam was written on paper, possibly weeks ago - yet they raise the moment
-- the scheduled window passes or results publish. The trigger never had an
-- offline bypass, so BOTH offline pipelines (offline_student_marks via
-- src/hooks/useOfflineMarks.ts and offline_section_marks via
-- src/hooks/useOfflineMarksEntry.ts) could only add a student while the
-- window was open. Students marked early worked; late additions and
-- corrections for the previously unentered did not.
--
-- Fix: skip the status and time-window checks when the row is a STAFF-entered
-- offline attempt. "Staff-entered" is expressed as "someone other than the
-- student is creating the row" (auth.uid() IS DISTINCT FROM NEW.student_id),
-- so a pupil can never bypass their own exam window by flagging an insert as
-- offline. The class-assignment check stays for everyone, and the
-- optional-subject eligibility trigger (trg_enforce_exam_subject_enrollment,
-- 20260617120000) is untouched and still runs.
--
-- Behaviour for online attempts (auth.uid() = NEW.student_id, is_offline
-- false) is byte-for-byte unchanged.
-- =============================================================

CREATE OR REPLACE FUNCTION public.validate_attempt_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_status public.exam_status;
  v_start_time TIMESTAMP WITH TIME ZONE;
  v_end_time TIMESTAMP WITH TIME ZONE;
  -- A paper exam's marks are entered by staff, not started by the pupil.
  v_staff_offline_entry BOOLEAN :=
    COALESCE(NEW.is_offline, false)
    AND (SELECT auth.uid()) IS DISTINCT FROM NEW.student_id;
BEGIN
  SELECT status, start_time, end_time
  INTO v_exam_status, v_start_time, v_end_time
  FROM public.exams WHERE id = NEW.exam_id;

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
    -- Offline, entered by staff: only a draft exam is off limits. Published,
    -- active and completed exams all legitimately receive paper marks late.
    IF v_exam_status = 'draft' THEN
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

-- The trigger itself (validate_attempt_start, BEFORE INSERT ON
-- student_exam_attempts) is unchanged; only the function body is replaced.
--
-- Verify after applying (prod-operations skill: Management API, then check
-- pg_proc rather than the migration ledger):
--   SELECT prosrc FROM pg_proc WHERE proname = 'validate_attempt_creation';
-- and, as a school admin on a published offline exam whose end_time has
-- passed, enter a mark for a student with no attempt: it must save.
