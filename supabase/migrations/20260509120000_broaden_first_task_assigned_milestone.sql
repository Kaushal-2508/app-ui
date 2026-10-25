-- =====================================================
-- Onboarding Journey — broaden `first_task_assigned`
-- =====================================================
-- Product decision (2026-05-09): the milestone fired only when a task was
-- assigned TO a teacher (`task_assignments.assignee_id = user`). Three
-- Alliance teachers (Manpreet Kaur, Poonam Kamra, Prabhjeet Singh) had
-- created and assigned tasks to students themselves but never received
-- one — so the report stuck them at 0/5 even though they had clearly
-- engaged with the Tasks module.
--
-- New semantics (column name unchanged for backwards compatibility):
--   first_task_assigned :=
--     EXISTS(task_assignments WHERE assignee_id = user
--                                OR assigner_id = user)
--
-- The other four milestones are unchanged. `first_task_completed` stays
-- scoped to assignee — completing a task means executing one assigned to
-- you; assigning one to a student is engagement, not completion.
--
-- Effect on existing data: completed_count can only INCREASE for users
-- who had m1=false but had assigned at least one task. Existing m1=true
-- users are unaffected. No data is rewritten — the booleans are computed
-- live from the source tables on every RPC call.
--
-- This is a CREATE OR REPLACE — column names and types are identical, so
-- no DROP is required and the TypeScript types in supabase/types.ts stay
-- valid. SECURITY DEFINER context is preserved.
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
  first_study_material_uploaded BOOLEAN,
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
  SELECT pr.institution_id INTO _target_inst
  FROM public.profiles pr
  WHERE pr.id = _user_id
  LIMIT 1;

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
           OR ta.assigner_id = p.u_id
      ) AS f_assigned,
      EXISTS (
        SELECT 1
        FROM public.task_assignments ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE ta.assignee_id = p.u_id
          AND t.status = 'completed'
      ) AS f_completed,
      EXISTS (
        SELECT 1 FROM public.study_materials sm
        WHERE sm.created_by = p.u_id
      ) AS f_material,
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
    flags.f_material,
    flags.f_exam,
    flags.f_result,
    (flags.f_assigned::int + flags.f_completed::int + flags.f_material::int
     + flags.f_exam::int + flags.f_result::int)::int AS completed_count,
    ROUND(
      (flags.f_assigned::int + flags.f_completed::int + flags.f_material::int
       + flags.f_exam::int + flags.f_result::int) * 100.0 / 5.0,
      2
    ) AS completion_percent,
    (flags.f_assigned AND flags.f_completed AND flags.f_material
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
  first_study_material_uploaded BOOLEAN,
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
           OR ta.assigner_id = s.u_id
      ) AS f_assigned,
      EXISTS (
        SELECT 1
        FROM public.task_assignments ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE ta.assignee_id = s.u_id
          AND t.status = 'completed'
      ) AS f_completed,
      EXISTS (
        SELECT 1 FROM public.study_materials sm
        WHERE sm.created_by = s.u_id
      ) AS f_material,
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
    flags.f_material,
    flags.f_exam,
    flags.f_result,
    (flags.f_assigned::int + flags.f_completed::int + flags.f_material::int
     + flags.f_exam::int + flags.f_result::int)::int,
    ROUND(
      (flags.f_assigned::int + flags.f_completed::int + flags.f_material::int
       + flags.f_exam::int + flags.f_result::int) * 100.0 / 5.0,
      2
    ),
    (flags.f_assigned AND flags.f_completed AND flags.f_material
     AND flags.f_exam AND flags.f_result)
  FROM flags
  ORDER BY flags.u_name NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_onboarding_progress(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_institution_onboarding_progress(UUID) TO authenticated;
