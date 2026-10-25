-- =====================================================
-- Teacher/Coordinator Onboarding Journey
-- =====================================================
-- Computes five milestone flags per teacher/coordinator from
-- existing tables so prior activity is reflected automatically.
--
-- Milestones:
--   1. first_task_assigned       : task_assignments.assignee_id = user
--   2. first_task_completed      : tasks.status='completed' joined via assignee
--   3. first_student_added       : class_assignments(role='student') in a class
--                                  the user is assigned to (teacher/coordinator)
--   4. first_exam_published      : exams.created_by = user
--                                  AND status IN ('published','completed')
--   5. first_result_validated    : final_results.finalized_by = user
--                                  OR final_results.published_by = user
--
-- Two RPCs:
--   get_user_onboarding_progress(_user_id)         — self or admin lookup
--   get_institution_onboarding_progress(_inst_id)  — admin roster
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_user_onboarding_progress(_user_id UUID)
RETURNS TABLE(
  user_id UUID,
  full_name TEXT,
  email TEXT,
  role TEXT,
  institution_id UUID,
  first_task_assigned BOOLEAN,
  first_task_completed BOOLEAN,
  first_student_added BOOLEAN,
  first_exam_published BOOLEAN,
  first_result_validated BOOLEAN,
  completed_count INT,
  completion_percent NUMERIC,
  is_journey_completed BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
  _target_inst UUID;
BEGIN
  -- Resolve target institution for permission check
  SELECT pr.institution_id INTO _target_inst
  FROM public.profiles pr
  WHERE pr.id = _user_id
  LIMIT 1;

  -- Caller must be: the user themselves, a super_admin, or a school admin
  -- / super_school_admin / coordinator of the target institution.
  IF _caller IS NULL OR (
    _caller <> _user_id
    AND NOT public.has_role(_caller, 'super_admin')
    AND NOT (
      _target_inst IS NOT NULL AND (
        public.has_role_at_institution(_caller, 'school_admin', _target_inst)
        OR public.has_role_at_institution(_caller, 'super_school_admin', _target_inst)
        OR public.has_role_at_institution(_caller, 'coordinator', _target_inst)
      )
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to read onboarding progress for this user';
  END IF;

  RETURN QUERY
  WITH p AS (
    SELECT
      pr.id           AS u_id,
      pr.full_name    AS u_name,
      pr.email        AS u_email,
      pr.institution_id AS u_inst,
      -- Pick the first teacher/coordinator role row (a user may have both)
      (
        SELECT ur.role::TEXT
        FROM public.user_roles ur
        WHERE ur.user_id = pr.id
          AND ur.role IN ('teacher', 'coordinator')
        ORDER BY CASE ur.role WHEN 'teacher' THEN 0 ELSE 1 END
        LIMIT 1
      ) AS u_role
    FROM public.profiles pr
    WHERE pr.id = _user_id
  ),
  flags AS (
    SELECT
      p.u_id, p.u_name, p.u_email, p.u_inst, p.u_role,
      EXISTS (
        SELECT 1 FROM public.task_assignments ta
        WHERE ta.assignee_id = p.u_id
      ) AS f_assigned,
      EXISTS (
        SELECT 1
        FROM public.task_assignments ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE ta.assignee_id = p.u_id
          AND t.status = 'completed'
      ) AS f_completed,
      EXISTS (
        SELECT 1
        FROM public.class_assignments ca_t
        JOIN public.class_assignments ca_s
          ON ca_s.class_id = ca_t.class_id
         AND ca_s.role = 'student'
        WHERE ca_t.user_id = p.u_id
          AND ca_t.role IN ('teacher', 'coordinator')
      ) AS f_student,
      EXISTS (
        SELECT 1 FROM public.exams ex
        WHERE ex.created_by = p.u_id
          AND ex.status IN ('published', 'completed')
      ) AS f_exam,
      EXISTS (
        SELECT 1 FROM public.final_results fr
        WHERE fr.finalized_by = p.u_id
           OR fr.published_by = p.u_id
      ) AS f_result
    FROM p
  )
  SELECT
    flags.u_id,
    flags.u_name,
    flags.u_email,
    COALESCE(flags.u_role, 'teacher'),
    flags.u_inst,
    flags.f_assigned,
    flags.f_completed,
    flags.f_student,
    flags.f_exam,
    flags.f_result,
    (flags.f_assigned::int + flags.f_completed::int + flags.f_student::int
     + flags.f_exam::int + flags.f_result::int)::int AS completed_count,
    ROUND(
      (flags.f_assigned::int + flags.f_completed::int + flags.f_student::int
       + flags.f_exam::int + flags.f_result::int) * 100.0 / 5.0,
      2
    ) AS completion_percent,
    (flags.f_assigned AND flags.f_completed AND flags.f_student
     AND flags.f_exam AND flags.f_result) AS is_journey_completed
  FROM flags;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_institution_onboarding_progress(_institution_id UUID)
RETURNS TABLE(
  user_id UUID,
  full_name TEXT,
  email TEXT,
  role TEXT,
  first_task_assigned BOOLEAN,
  first_task_completed BOOLEAN,
  first_student_added BOOLEAN,
  first_exam_published BOOLEAN,
  first_result_validated BOOLEAN,
  completed_count INT,
  completion_percent NUMERIC,
  is_journey_completed BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
BEGIN
  IF _caller IS NULL OR (
    NOT public.has_role(_caller, 'super_admin')
    AND NOT public.has_role_at_institution(_caller, 'school_admin', _institution_id)
    AND NOT public.has_role_at_institution(_caller, 'super_school_admin', _institution_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to read institution onboarding progress';
  END IF;

  RETURN QUERY
  WITH staff AS (
    SELECT
      pr.id             AS u_id,
      pr.full_name      AS u_name,
      pr.email          AS u_email,
      (
        SELECT ur2.role::TEXT
        FROM public.user_roles ur2
        WHERE ur2.user_id = pr.id
          AND ur2.role IN ('teacher', 'coordinator')
        ORDER BY CASE ur2.role WHEN 'teacher' THEN 0 ELSE 1 END
        LIMIT 1
      ) AS u_role
    FROM public.profiles pr
    WHERE pr.institution_id = _institution_id
      AND pr.is_active = true
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = pr.id
          AND ur.role IN ('teacher', 'coordinator')
      )
  ),
  flags AS (
    SELECT
      s.u_id, s.u_name, s.u_email, s.u_role,
      EXISTS (
        SELECT 1 FROM public.task_assignments ta
        WHERE ta.assignee_id = s.u_id
      ) AS f_assigned,
      EXISTS (
        SELECT 1
        FROM public.task_assignments ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE ta.assignee_id = s.u_id
          AND t.status = 'completed'
      ) AS f_completed,
      EXISTS (
        SELECT 1
        FROM public.class_assignments ca_t
        JOIN public.class_assignments ca_s
          ON ca_s.class_id = ca_t.class_id
         AND ca_s.role = 'student'
        WHERE ca_t.user_id = s.u_id
          AND ca_t.role IN ('teacher', 'coordinator')
      ) AS f_student,
      EXISTS (
        SELECT 1 FROM public.exams ex
        WHERE ex.created_by = s.u_id
          AND ex.status IN ('published', 'completed')
      ) AS f_exam,
      EXISTS (
        SELECT 1 FROM public.final_results fr
        WHERE fr.finalized_by = s.u_id
           OR fr.published_by = s.u_id
      ) AS f_result
    FROM staff s
  )
  SELECT
    flags.u_id,
    flags.u_name,
    flags.u_email,
    COALESCE(flags.u_role, 'teacher'),
    flags.f_assigned,
    flags.f_completed,
    flags.f_student,
    flags.f_exam,
    flags.f_result,
    (flags.f_assigned::int + flags.f_completed::int + flags.f_student::int
     + flags.f_exam::int + flags.f_result::int)::int,
    ROUND(
      (flags.f_assigned::int + flags.f_completed::int + flags.f_student::int
       + flags.f_exam::int + flags.f_result::int) * 100.0 / 5.0,
      2
    ),
    (flags.f_assigned AND flags.f_completed AND flags.f_student
     AND flags.f_exam AND flags.f_result)
  FROM flags
  ORDER BY flags.u_name NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_onboarding_progress(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_institution_onboarding_progress(UUID) TO authenticated;
