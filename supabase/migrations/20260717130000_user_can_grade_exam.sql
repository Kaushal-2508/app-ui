-- =====================================================================
-- Tenant-scoped authorization helper for exam grading
-- =====================================================================
-- The auto-grade-submission edge function previously authorized callers with a
-- bare "does this user hold ANY staff role anywhere" check (user_roles IN
-- (...)) and then ran everything on the service-role client with no
-- institution/class binding. A teacher/coordinator/admin at School A could POST
-- another school's attempt_id and have it graded, writing ai_evaluations +
-- teacher_overrides into School B's data (cross-tenant IDOR; matches H4 in
-- docs/security-audit-2026-07-07.md).
--
-- This helper binds the caller to the exam's tenant, mirroring the
-- authorization already used by close_stale_exam_attempts: exam creator,
-- super_admin, an admin of the exam's institution, a teacher assigned to one of
-- the exam's classes, or a coordinator for one of them. The edge function calls
-- it (passing the JWT-derived caller id explicitly, since the service-role
-- client has no auth.uid()) and 403s when it returns false.

CREATE OR REPLACE FUNCTION public.user_can_grade_exam(_user_id uuid, _exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin')
    OR EXISTS (
      SELECT 1 FROM exams e
      WHERE e.id = _exam_id AND e.created_by = _user_id
    )
    OR (
      EXISTS (
        SELECT 1 FROM exams e
        JOIN profiles p ON p.id = _user_id
        WHERE e.id = _exam_id
          AND p.institution_id = e.institution_id
      )
      AND (
        public.has_role(_user_id, 'school_admin')
        OR public.has_role(_user_id, 'super_school_admin')
        OR EXISTS (
          SELECT 1 FROM exam_classes ec
          JOIN class_assignments ca
            ON ca.class_id = ec.class_id
           AND ca.user_id = _user_id
           AND ca.role = 'teacher'
          WHERE ec.exam_id = _exam_id
        )
        OR EXISTS (
          SELECT 1 FROM exam_classes ec
          WHERE ec.exam_id = _exam_id
            AND public.is_coordinator_for_class(_user_id, ec.class_id)
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_grade_exam(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_grade_exam(uuid, uuid) TO authenticated, service_role;
