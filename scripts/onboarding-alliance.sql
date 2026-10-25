-- Inlined body of get_institution_onboarding_progress for Alliance International School.
-- Auth gate omitted because Management API already executes as postgres
-- (this is the same logic the RPC runs after passing the gate).
WITH staff AS (
  SELECT
    pr.id        AS u_id,
    pr.full_name AS u_name,
    pr.email     AS u_email,
    (
      SELECT ur2.role::TEXT
      FROM public.user_roles ur2
      WHERE ur2.user_id = pr.id
        AND ur2.role IN ('teacher', 'coordinator')
      ORDER BY CASE ur2.role WHEN 'teacher' THEN 0 ELSE 1 END
      LIMIT 1
    ) AS u_role
  FROM public.profiles pr
  WHERE pr.institution_id = '8af718c6-ca11-482b-9d6b-832f2b767928'::uuid
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
      WHERE ta.assignee_id = s.u_id OR ta.assigner_id = s.u_id
    ) AS f_assigned,
    EXISTS (
      SELECT 1
      FROM public.task_assignments ta
      JOIN public.tasks t ON t.id = ta.task_id
      WHERE ta.assignee_id = s.u_id AND t.status = 'completed'
    ) AS f_completed,
    EXISTS (
      SELECT 1 FROM public.study_materials sm WHERE sm.created_by = s.u_id
    ) AS f_material,
    EXISTS (
      SELECT 1 FROM public.exams ex
      WHERE ex.created_by = s.u_id AND ex.status IN ('published', 'completed')
    ) AS f_exam,
    EXISTS (
      SELECT 1 FROM public.final_results fr
      WHERE fr.finalized_by = s.u_id OR fr.published_by = s.u_id
    ) AS f_result
  FROM staff s
)
SELECT
  flags.u_id            AS user_id,
  flags.u_name          AS full_name,
  flags.u_email         AS email,
  COALESCE(flags.u_role, 'teacher') AS role,
  flags.f_assigned      AS first_task_assigned,
  flags.f_completed     AS first_task_completed,
  flags.f_material      AS first_study_material_uploaded,
  flags.f_exam          AS first_exam_published,
  flags.f_result        AS first_result_validated,
  (flags.f_assigned::int + flags.f_completed::int + flags.f_material::int
   + flags.f_exam::int + flags.f_result::int)::int AS completed_count,
  ROUND(
    (flags.f_assigned::int + flags.f_completed::int + flags.f_material::int
     + flags.f_exam::int + flags.f_result::int) * 100.0 / 5.0,
    2
  ) AS completion_percent,
  (flags.f_assigned AND flags.f_completed AND flags.f_material
   AND flags.f_exam AND flags.f_result) AS is_journey_completed
FROM flags
ORDER BY flags.u_name NULLS LAST;
