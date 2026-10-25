-- /ocr-review never finished loading at Alliance.
--
-- usePendingEvaluations ran ONE unbounded query for every submitted attempt on
-- an online exam awaiting evaluation, then looped over the result and issued
-- THREE more sequential round-trips per attempt (student_answers, then
-- teacher_overrides and ai_evaluations keyed on those answers). Measured on
-- prod 2026-09-11:
--
--   Alliance International School   845 attempts  ->  2,535 sequential requests
--   Salci National School            29 attempts  ->     87 sequential requests
--   platform total                  894 attempts,  6,414 answers behind them
--
-- Salci finished in a few seconds, which is why this was never noticed; Alliance
-- sat on skeletons for minutes. This does the same counting in one round trip.
--
-- Deliberately SECURITY INVOKER. The old client queries were scoped by RLS
-- alone (there is no institution filter anywhere in that hook), so running as
-- the caller keeps visibility byte-identical. A DEFINER function here would
-- have to re-implement those policies and could only widen what people see.
--
-- The caller still derives `status` and the display strings, so the queue's
-- semantics are untouched: this migration changes how the numbers are fetched,
-- not what they mean.

CREATE OR REPLACE FUNCTION public.attempt_evaluation_queue(_limit integer DEFAULT 1000)
RETURNS TABLE (
  attempt_id                uuid,
  exam_id                   uuid,
  student_id                uuid,
  exam_title                text,
  exam_total_marks          numeric,
  class_name                text,
  class_section             text,
  student_full_name         text,
  student_roll_number       text,
  student_admission_number  text,
  submitted_at              timestamptz,
  is_finalized              boolean,
  total_questions           integer,
  teacher_reviewed_count    integer,
  ai_evaluated_count        integer,
  pending_review_count      integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = 'public', 'pg_temp'
AS $$
  WITH att AS (
    SELECT a.id, a.exam_id, a.student_id, a.class_id, a.submitted_at, a.is_finalized
    FROM student_exam_attempts a
    JOIN exams e ON e.id = a.exam_id
    WHERE a.is_submitted
      AND e.exam_mode = 'online'
      AND a.evaluation_status IN ('pending', 'ai_evaluated', 'teacher_reviewed')
    ORDER BY a.submitted_at DESC NULLS LAST, a.id
    -- Bounded, unlike the original: PostgREST silently capped that one at 1,000
    -- and nothing said so. Same ceiling, now explicit and clamped.
    LIMIT LEAST(GREATEST(COALESCE(_limit, 1000), 1), 2000)
  ),
  ans AS (
    SELECT sa.attempt_id, sa.id
    FROM student_answers sa
    WHERE sa.attempt_id IN (SELECT id FROM att)
  ),
  -- Row counts, not distinct answers: the loop this replaces counted rows, and
  -- the queue's status ladder compares those counts to each other.
  q AS (
    SELECT attempt_id, count(*)::int AS total_questions
    FROM ans GROUP BY attempt_id
  ),
  ovr AS (
    SELECT n.attempt_id, count(*)::int AS teacher_reviewed
    FROM ans n JOIN teacher_overrides t ON t.answer_id = n.id
    GROUP BY n.attempt_id
  ),
  aie AS (
    SELECT n.attempt_id,
           count(*)::int AS ai_evaluated,
           count(*) FILTER (WHERE ae.requires_teacher_review)::int AS pending_review
    FROM ans n JOIN ai_evaluations ae ON ae.answer_id = n.id
    GROUP BY n.attempt_id
  )
  SELECT a.id,
         a.exam_id,
         a.student_id,
         e.title,
         e.total_marks,
         c.name,
         c.section,
         p.full_name,
         p.roll_number,
         p.admission_number,
         a.submitted_at,
         a.is_finalized,
         COALESCE(q.total_questions, 0),
         COALESCE(ovr.teacher_reviewed, 0),
         COALESCE(aie.ai_evaluated, 0),
         COALESCE(aie.pending_review, 0)
  FROM att a
  JOIN exams   e ON e.id = a.exam_id
  JOIN classes c ON c.id = a.class_id
  LEFT JOIN profiles p ON p.id = a.student_id
  LEFT JOIN q   ON q.attempt_id   = a.id
  LEFT JOIN ovr ON ovr.attempt_id = a.id
  LEFT JOIN aie ON aie.attempt_id = a.id
  ORDER BY a.submitted_at DESC NULLS LAST, a.id;
$$;

REVOKE ALL ON FUNCTION public.attempt_evaluation_queue(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attempt_evaluation_queue(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.attempt_evaluation_queue(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_evaluation_queue(integer) TO service_role;

DO $verify$
DECLARE v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'attempt_evaluation_queue';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'verify: attempt_evaluation_queue is missing';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'verify: attempt_evaluation_queue must stay SECURITY INVOKER so RLS still scopes it';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'verify: anon can EXECUTE attempt_evaluation_queue';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'verify: PUBLIC can EXECUTE attempt_evaluation_queue';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'verify: authenticated cannot EXECUTE attempt_evaluation_queue';
  END IF;
END
$verify$;
