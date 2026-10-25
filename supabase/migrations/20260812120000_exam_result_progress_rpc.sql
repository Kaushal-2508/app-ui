-- Per-exam result progress, so the My Exams status filter can offer
-- "Result Pending" / "Result Published" without pulling raw attempt rows into
-- the client and counting them there (CLAUDE.md §23: aggregate server-side).
--
-- Why this is needed: exams.status is NOT a reliable results signal.
-- Measured on prod 2026-08-12:
--   status='completed' → 76 exams, 73 with results, all 73 published
--   status='published' → 843 exams, 341 with results, 320 ALREADY published
-- So filtering "Result Published" on status='completed' would hide ~320 exams
-- whose results really are out. The authoritative flag is
-- final_results.is_published, which hangs off student_exam_attempts.
--
-- SECURITY INVOKER on purpose: RLS on student_exam_attempts / final_results
-- must still apply, so a teacher only aggregates attempts they may read.
CREATE OR REPLACE FUNCTION public.get_exam_result_progress(_exam_ids uuid[])
RETURNS TABLE (
  exam_id uuid,
  submitted_attempts bigint,
  published_results bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    a.exam_id,
    count(*) FILTER (WHERE a.is_submitted)   AS submitted_attempts,
    count(*) FILTER (WHERE r.is_published)   AS published_results
  FROM public.student_exam_attempts a
  LEFT JOIN public.final_results r ON r.attempt_id = a.id
  WHERE a.exam_id = ANY(_exam_ids)
  GROUP BY a.exam_id;
$$;

COMMENT ON FUNCTION public.get_exam_result_progress(uuid[]) IS
  'Per-exam counts of submitted attempts and published final_results, for the My Exams "Result Pending"/"Result Published" filters. SECURITY INVOKER so RLS still scopes the caller.';

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE broadly on every new
-- public function. Revoke BOTH the PUBLIC grant (which anon inherits) and anon
-- by name — verified on prod that revoking anon alone leaves PUBLIC:EXECUTE.
REVOKE EXECUTE ON FUNCTION public.get_exam_result_progress(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_exam_result_progress(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_exam_result_progress(uuid[]) TO authenticated;