-- Teacher Targets: a results-upload exam counts only once its results reach students.
--
-- THE BUG. `exams.status = 'published'` was the whole test. For an ordinary exam
-- that is correct: publishing is the act of sending it to students. But a
-- results-ONLY exam (is_results_only, the "Already Created" offline flow) is
-- CREATED AND PUBLISHED IN ONE SHOT, before a single mark exists. Verified on
-- Salci National: exam "dfgdfg" had status='published' 1.3 seconds after
-- created_at, is_results_only=true, zero final_results rows and zero published
-- results, yet it moved a teacher's target to "1 of 2 published".
--
-- The spec called this out as an accepted imprecision and it was wrong to accept:
-- the paper is not authored by the teacher, so creating the record is not the
-- work. The work is getting the marks out.
--
-- THE RULE NOW, decided by the product owner 2026-09-16:
--   ordinary exam    -> counts when status is published/active/completed, as before
--   results-only exam -> ALSO needs at least one final_results row with is_published
--
-- Deliberately NOT applied to ordinary exams. A teacher who correctly schedules
-- an online exam for next week has done that work and should see credit for it;
-- requiring marks would leave them reading as idle until after the exam runs.
--
-- WHY final_results AND NOT offline_student_marks. Results-only exams do flow
-- into final_results through student_exam_attempts: measured in prod, 372
-- results-only exams carry 10,380 attempts, 10,373 final_results rows and 5,652
-- published ones. offline_student_marks is the separate section-marks pipeline
-- and is NOT the publication signal.
--
-- Excluding results-only exams from the count altogether was considered and
-- rejected: 89% of marks entry on this platform is offline, so that would make
-- the whole feature inert for most real schools.

CREATE OR REPLACE FUNCTION public.tgt_count_exams_published(
  _teacher uuid, _institution uuid, _from date, _to date
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT count(*)::int
  FROM public.exams e
  WHERE e.created_by     = _teacher
    AND e.institution_id = _institution
    AND e.status IN ('published','active','completed')
    -- The canonical date chain, shared with every dash_* and school_analytics_*
    -- RPC. Two rival chains exist in this codebase; using a different one makes
    -- the same teacher's month read differently on two screens.
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
        BETWEEN _from AND _to
    AND (
      NOT COALESCE(e.is_results_only, false)
      OR EXISTS (
        SELECT 1
        FROM public.final_results fr
        JOIN public.student_exam_attempts a ON a.id = fr.attempt_id
        WHERE a.exam_id = e.id
          AND fr.is_published
      )
    )
$fn$;

COMMENT ON FUNCTION public.tgt_count_exams_published(uuid, uuid, date, date) IS
  'Exams this teacher published inside the window. An ordinary exam counts once its status is published/active/completed. A results-only exam additionally needs at least one PUBLISHED final_results row, because that flow creates and publishes the exam record in one action before any marks exist, and would otherwise credit a teacher for zero work.';

REVOKE ALL ON FUNCTION public.tgt_count_exams_published(uuid, uuid, date, date)
  FROM PUBLIC, anon, authenticated;
