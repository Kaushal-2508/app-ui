-- offline_student_marks: stop the publish timing out.
--
-- THE SYMPTOM. Teachers publishing offline marks got "The request took too long"
-- and a 500 carrying Postgres 57014, "canceling statement due to statement
-- timeout". The `authenticated` role runs with statement_timeout = 8s (the
-- database default is 120s). From pg_stat_statements on 2026-09-16 the upsert
-- into this table averaged 2,734 ms and peaked at 7,969 ms across 45 calls, so
-- every publish was a coin flip against the 8,000 ms ceiling. A class of 51
-- students was enough to lose it.
--
-- THE CAUSE. The policy inlined a cross-table EXISTS and called auth.uid() bare:
--
--   EXISTS (SELECT 1 FROM exams e
--           JOIN user_roles ur ON ur.institution_id = e.institution_id
--           WHERE e.id = offline_student_marks.exam_id
--             AND ur.user_id = auth.uid() AND ur.role = ANY(...))
--
-- Both are forbidden by CLAUDE.md 23, and this is the pattern
-- docs/slowness-diagnosis-2026-07-07.md logged in July as "1,383 bare auth.uid()
-- in RLS". It became user-visible only as Alliance's data grew: 1,646 user_roles
-- rows share that institution, so the join has real work to do, and the policy is
-- cmd=ALL with a NULL with_check, meaning the same predicate is re-evaluated per
-- row on the write path of an upsert.
--
-- Measured, same query, same data: 112 ms under RLS against ~0 ms without it.
--
-- THE FIX. Identical logic, moved into a STABLE SECURITY DEFINER helper so it is
-- evaluated once per (user, exam) instead of re-derived per row, with auth.uid()
-- wrapped as (select auth.uid()) so the planner hoists it out of the per-row loop.
--
-- ACCESS IS DELIBERATELY UNCHANGED. The helper reproduces the old predicate
-- exactly, including the parts that look like bugs:
--   * user_roles.institution_id is NULLABLE, and `ur.institution_id =
--     e.institution_id` is NULL (not true) for such a row, so a role row with no
--     institution grants nothing. That is the current behaviour and is preserved.
--     Do NOT "fix" it here: it would silently widen access.
--   * The policy applies to PUBLIC, not just authenticated (polroles = {0}), so
--     no TO clause is added.
-- The only added element is an explicit WITH CHECK. The original left it NULL,
-- which makes Postgres fall back to the USING expression, so this is the same
-- rule stated rather than implied, and it satisfies CLAUDE.md 26.

CREATE OR REPLACE FUNCTION public.can_manage_offline_marks(_user_id uuid, _exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.exams e
    JOIN public.user_roles ur ON ur.institution_id = e.institution_id
    WHERE e.id = _exam_id
      AND ur.user_id = _user_id
      AND ur.role = ANY (ARRAY['teacher'::app_role, 'coordinator'::app_role,
                               'school_admin'::app_role, 'super_school_admin'::app_role,
                               'super_admin'::app_role])
  )
$fn$;

COMMENT ON FUNCTION public.can_manage_offline_marks(uuid, uuid) IS
  'Whether _user_id holds a staff role in the same institution as _exam_id. Extracted verbatim from the offline_student_marks policy so RLS calls a SECURITY DEFINER helper instead of an inline cross-table EXISTS (CLAUDE.md 23). Semantics are unchanged, including that a user_roles row with a NULL institution_id matches nothing.';

-- Supports the helper's join. user_roles already has an institution index; exams
-- is reached by primary key.
CREATE INDEX IF NOT EXISTS idx_user_roles_user_institution_role
  ON public.user_roles (user_id, institution_id, role);

DROP POLICY IF EXISTS "institution members can manage offline marks" ON public.offline_student_marks;
CREATE POLICY "institution members can manage offline marks"
  ON public.offline_student_marks
  FOR ALL
  USING      (public.can_manage_offline_marks((select auth.uid()), exam_id))
  WITH CHECK (public.can_manage_offline_marks((select auth.uid()), exam_id));

-- The helper is called from inside a policy evaluated as the caller, so
-- authenticated needs EXECUTE. anon and PUBLIC get nothing, by name: Supabase's
-- default privileges grant EXECUTE on every new public function and REVOKE FROM
-- PUBLIC does not strip anon (CLAUDE.md 26).
REVOKE ALL ON FUNCTION public.can_manage_offline_marks(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_offline_marks(uuid, uuid) TO authenticated;
