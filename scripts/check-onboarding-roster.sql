-- Mirror the get_institution_onboarding_progress logic but bypass auth.uid()
-- (Management API SQL has no auth context, so the RPC's permission check fails).
-- Limited to Alliance International School institution.

WITH staff AS (
  SELECT
    pr.id           AS u_id,
    pr.full_name    AS u_name,
    pr.email        AS u_email
  FROM public.profiles pr
  WHERE pr.institution_id = '8af718c6-ca11-482b-9d6b-832f2b767928'
    AND pr.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = pr.id
        AND ur.role IN ('teacher', 'coordinator')
    )
),
flags AS (
  SELECT
    s.u_id, s.u_name, s.u_email,
    EXISTS (SELECT 1 FROM public.task_assignments ta WHERE ta.assignee_id = s.u_id) AS m1_assigned_to_me,
    EXISTS (
      SELECT 1
      FROM public.task_assignments ta
      JOIN public.tasks t ON t.id = ta.task_id
      WHERE ta.assignee_id = s.u_id AND t.status = 'completed'
    ) AS m2_completed,
    EXISTS (SELECT 1 FROM public.study_materials sm WHERE sm.created_by = s.u_id) AS m3_material,
    EXISTS (
      SELECT 1 FROM public.exams ex
      WHERE ex.created_by = s.u_id AND ex.status IN ('published','completed')
    ) AS m4_exam,
    EXISTS (
      SELECT 1 FROM public.final_results fr
      WHERE fr.finalized_by = s.u_id OR fr.published_by = s.u_id
    ) AS m5_result,
    -- Context: tasks they assigned (NOT a milestone)
    (SELECT COUNT(*) FROM public.task_assignments ta WHERE ta.assigner_id = s.u_id) AS ctx_assigner_count
  FROM staff s
)
SELECT
  u_name,
  u_email,
  (m1_assigned_to_me::int + m2_completed::int + m3_material::int + m4_exam::int + m5_result::int) AS done_of_5,
  m1_assigned_to_me,
  m2_completed,
  m3_material,
  m4_exam,
  m5_result,
  ctx_assigner_count
FROM flags
ORDER BY done_of_5 DESC, ctx_assigner_count DESC, u_name;
