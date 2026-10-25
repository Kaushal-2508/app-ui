-- =====================================================================
-- Homework & Assignment — Phase 2: batched list counts RPC
-- Returns submission/grading/total-student counts for a set of
-- assignments the CALLER may manage. SECURITY DEFINER so the counts
-- aggregate server-side (§23) without exposing raw rows; access is
-- gated per-assignment by can_manage_homework so a caller only ever
-- gets counts for assignments they're allowed to see.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.homework_list_counts(_homework_ids uuid[])
RETURNS TABLE (
  homework_assignment_id uuid,
  submitted_count        integer,
  graded_count           integer,
  total_students         integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    h.id AS homework_assignment_id,
    (SELECT count(*)::int FROM public.homework_submissions s
       WHERE s.homework_assignment_id = h.id) AS submitted_count,
    (SELECT count(*)::int FROM public.homework_results r
       WHERE r.homework_assignment_id = h.id
         AND r.status IN ('graded','skipped')) AS graded_count,
    (SELECT count(DISTINCT ca.user_id)::int
       FROM public.homework_assignment_classes hac
       JOIN public.class_assignments ca ON ca.class_id = hac.class_id
       WHERE hac.homework_assignment_id = h.id
         AND ca.role = 'student') AS total_students
  FROM public.homework_assignments h
  WHERE h.id = ANY(_homework_ids)
    AND public.can_manage_homework(auth.uid(), h.id);
$$;

REVOKE ALL ON FUNCTION public.homework_list_counts(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_list_counts(uuid[]) TO authenticated;
