-- The exam timer was a pure client countdown, reseeded to the full duration
-- every time an attempt was started OR resumed:
--
--   remainingSeconds: (exam?.duration_minutes || 60) * 60
--
-- start_exam_attempt correctly returns the EXISTING attempt on re-entry (it
-- logs 'resumed' and never touches started_at), so the server was right all
-- along. The client simply threw the elapsed time away. A student could press
-- Back, land on the exam list, re-enter, and get a fresh full-length clock --
-- unlimited time on a timed exam, repeatable forever.
--
-- Fixing this on the client alone would leave the device clock as the source of
-- truth, so a student could just wind their phone back. This function makes the
-- server the authority.
--
-- SECURITY INVOKER on purpose: it runs under the caller's own RLS, so a student
-- can only ever read their own attempt and there is no privilege to escalate.
-- Do NOT convert this to SECURITY DEFINER without adding an ownership check.
CREATE OR REPLACE FUNCTION public.exam_attempt_remaining_seconds(_attempt_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    0,
    LEAST(
      -- The student's OWN clock. Identical definition to the one
      -- close_stale_exam_attempts sweeps on (started_at + duration_minutes) --
      -- these two must not drift apart, or the sweep would auto-submit a
      -- student whose on-screen timer still showed time remaining.
      FLOOR(EXTRACT(EPOCH FROM (
        COALESCE(a.started_at, a.created_at)
        + make_interval(mins => COALESCE(e.duration_minutes, 0))
        - now()
      )))::bigint,
      -- The absolute window. end_time is the last possible finish
      -- (start + late entry + duration), so a student who entered at the last
      -- permitted moment is never cut short by this -- it only bounds a bogus
      -- started_at. NULL end_time means no window cap.
      COALESCE(
        FLOOR(EXTRACT(EPOCH FROM (e.end_time - now())))::bigint,
        2147483647::bigint
      )
    )
  )::integer
  FROM student_exam_attempts a
  JOIN exams e ON e.id = a.exam_id
  WHERE a.id = _attempt_id;
$function$;

COMMENT ON FUNCTION public.exam_attempt_remaining_seconds(uuid) IS
  'Seconds left on a student''s attempt, computed with server now() so the device clock cannot be used to gain time. Mirrors close_stale_exam_attempts'' definition of a student clock (started_at + duration_minutes), clamped to exams.end_time. SECURITY INVOKER: RLS restricts it to the caller''s own attempt.';

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE broadly on every new
-- public function. BOTH revokes are required and neither implies the other:
-- revoking from `anon` by name leaves the PUBLIC grant, which anon is a member
-- of; revoking from PUBLIC leaves a direct anon grant if one exists. Verified
-- on prod: after the by-name revoke alone, PUBLIC still held EXECUTE.
REVOKE ALL ON FUNCTION public.exam_attempt_remaining_seconds(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exam_attempt_remaining_seconds(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.exam_attempt_remaining_seconds(uuid) TO authenticated;
