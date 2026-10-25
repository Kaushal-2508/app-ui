-- =====================================================================
-- Auto-close abandoned (never-submitted) online exam attempts
-- =====================================================================
-- A student who opens an exam but never presses Submit leaves
-- student_exam_attempts.is_submitted = false forever. get_exam_window_status
-- counts that row as an ACTIVE attempt, so "Validate Results" stays blocked
-- with "N student(s) still have active attempts" while the report list shows
-- those students as "Not Attempted" (invisible blocker, observed 2026-07-17).
--
-- IMPORTANT TIMING SEMANTICS: exams.end_time (= availability_end) is only the
-- LATE-ENTRY cutoff. A student who enters late may legitimately keep writing
-- until started_at + duration_minutes, which can be well past end_time. An
-- attempt is therefore only stale once BOTH are true:
--   1. the entry window is over (end_time <= now()), and
--   2. that student's own clock has run out
--      (started_at + duration_minutes + 5 min grace <= now()).
-- The 5-minute grace lets the client-side auto-submit win the race.
--
-- Closed attempts become submitted (auto_submitted = true) so saved answers
-- still count; a zero-answer attempt renders as Checked with score 0 (existing
-- convention in useExamResults.ts).
--
-- TRIGGER INTERACTION: the BEFORE UPDATE trigger handle_attempt_submission
-- fires on the is_submitted false->true transition and unconditionally sets
-- submitted_at := now() and time_spent_seconds := now() - started_at. Since a
-- close happens at least (grace + cron cadence) after the deadline, that always
-- overshoots the allotted time, and for an old backlog it inflates to
-- hours/days, polluting time-analysis histograms (pre-migration these rows were
-- NULL and excluded). Both functions therefore run a SECOND, corrective UPDATE
-- on the rows they just closed, bounding submitted_at to the student's personal
-- deadline and capping time_spent_seconds at the exam duration. It changes
-- neither is_submitted nor is_locked, so it does not re-fire
-- handle_attempt_submission or create_offline_placeholder_answers.
--
-- The correction MUST be a separate statement, not the outer UPDATE of a
-- data-modifying CTE: every sub-statement of one command shares a snapshot, and
-- Postgres applies only ONE modification per row per command — so a
-- `WITH closed AS (UPDATE ...) UPDATE ... FROM closed` form silently discards
-- the correction AND reports ROW_COUNT = 0 (breaking the returned count that
-- the UI uses to decide whether to refresh). Capture the ids, then correct.
--
-- Two entry points, both idempotent:
--   * close_stale_exam_attempts(p_exam_id) - staff-authorized, kicked
--     automatically by the exam results page for instant feedback.
--   * close_stale_exam_attempts_sweep() - cron-only, sweeps every published/
--     active exam so attempts close even if nobody opens the report page.

CREATE OR REPLACE FUNCTION public.close_stale_exam_attempts(p_exam_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := (select auth.uid());
  v_exam record;
  v_closed integer;
  v_authorized boolean;
  v_ids uuid[];
BEGIN
  SELECT e.id, e.end_time, e.institution_id, e.created_by, e.duration_minutes
  INTO v_exam
  FROM exams e
  WHERE e.id = p_exam_id;

  IF v_exam.id IS NULL THEN
    RAISE EXCEPTION 'Exam not found';
  END IF;

  -- Caller must be the exam creator, an admin of the exam's institution, or
  -- teaching staff assigned to (or coordinating) one of the exam's classes.
  v_authorized := public.has_role(v_caller, 'super_admin')
    OR v_exam.created_by = v_caller
    OR (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = v_caller AND p.institution_id = v_exam.institution_id
      )
      AND (
        public.has_role(v_caller, 'school_admin')
        OR public.has_role(v_caller, 'super_school_admin')
        OR EXISTS (
          SELECT 1 FROM exam_classes ec
          JOIN class_assignments ca
            ON ca.class_id = ec.class_id
           AND ca.user_id = v_caller
           AND ca.role = 'teacher'
          WHERE ec.exam_id = p_exam_id
        )
        OR EXISTS (
          SELECT 1 FROM exam_classes ec
          WHERE ec.exam_id = p_exam_id
            AND public.is_coordinator_for_class(v_caller, ec.class_id)
        )
      )
    );

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to close attempts for this exam';
  END IF;

  -- Entry window must be over; per-attempt clocks are checked in the UPDATE.
  IF v_exam.end_time IS NULL OR v_exam.end_time > now() THEN
    RAISE EXCEPTION 'Exam window is still open';
  END IF;

  -- Statement 1: close the abandoned attempts, capturing their ids.
  WITH closed AS (
    UPDATE student_exam_attempts a
    SET is_submitted = true,
        auto_submitted = true
    WHERE a.exam_id = p_exam_id
      AND a.is_submitted = false
      -- only attempts whose own time has run out (late entrants keep writing
      -- past end_time until started_at + duration)
      AND a.started_at + make_interval(mins => COALESCE(v_exam.duration_minutes, 0))
          + interval '5 minutes' <= now()
    RETURNING a.id
  )
  SELECT array_agg(id) INTO v_ids FROM closed;

  v_closed := COALESCE(array_length(v_ids, 1), 0);

  -- Statement 2 (separate command, fresh snapshot): bound the values the
  -- submission trigger just wrote.
  IF v_closed > 0 THEN
    UPDATE student_exam_attempts a
    SET submitted_at = a.started_at + make_interval(mins => COALESCE(v_exam.duration_minutes, 0)),
        time_spent_seconds = LEAST(
          COALESCE(a.time_spent_seconds, 0),
          COALESCE(v_exam.duration_minutes, 0) * 60
        )
    WHERE a.id = ANY(v_ids);
  END IF;

  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.close_stale_exam_attempts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_stale_exam_attempts(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Platform-wide sweep (cron-only; not callable by app users)
-- ---------------------------------------------------------------------
-- Scoped to exams still in the checking pipeline (published/active). Completed
-- exams keep their historical rows untouched so already-validated results
-- never sprout new pending evaluations.

CREATE OR REPLACE FUNCTION public.close_stale_exam_attempts_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed integer;
  v_ids uuid[];
BEGIN
  -- Statement 1: close abandoned attempts across every in-flight exam.
  WITH closed AS (
    UPDATE student_exam_attempts a
    SET is_submitted = true,
        auto_submitted = true
    FROM exams e
    WHERE e.id = a.exam_id
      AND a.is_submitted = false
      AND e.status IN ('published', 'active')
      AND e.end_time IS NOT NULL
      AND e.end_time <= now()
      AND a.started_at + make_interval(mins => COALESCE(e.duration_minutes, 0))
          + interval '5 minutes' <= now()
    RETURNING a.id
  )
  SELECT array_agg(id) INTO v_ids FROM closed;

  v_closed := COALESCE(array_length(v_ids, 1), 0);

  -- Statement 2 (separate command, fresh snapshot): bound the values the
  -- submission trigger just wrote. Duration varies per exam, so rejoin exams.
  IF v_closed > 0 THEN
    UPDATE student_exam_attempts a
    SET submitted_at = a.started_at + make_interval(mins => COALESCE(e.duration_minutes, 0)),
        time_spent_seconds = LEAST(
          COALESCE(a.time_spent_seconds, 0),
          COALESCE(e.duration_minutes, 0) * 60
        )
    FROM exams e
    WHERE e.id = a.exam_id
      AND a.id = ANY(v_ids);
  END IF;

  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.close_stale_exam_attempts_sweep() FROM PUBLIC, anon, authenticated;

-- Schedule every 5 minutes. cron.schedule is idempotent on jobname in
-- pg_cron 1.5+; guard for older versions by unscheduling first if present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-stale-exam-attempts') THEN
    PERFORM cron.unschedule('close-stale-exam-attempts');
  END IF;
  PERFORM cron.schedule(
    'close-stale-exam-attempts',
    '*/5 * * * *',
    $job$ SELECT public.close_stale_exam_attempts_sweep(); $job$
  );
END;
$$;
