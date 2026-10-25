-- Diagnose why three Alliance teachers show 0/5 onboarding progress.
-- Email-keyed; pulls every profile row (incl. duplicates), every role,
-- and per-milestone source-table evidence in one shot.

WITH targets AS (
  SELECT unnest(ARRAY[
    'mkaur788872@gmail.com',     -- Manpreet Kaur
    'poonam30.ais@gmail.com',    -- Poonam Kamra
    'boxersidhu6565@gmail.com'   -- Prabhjeet Singh
  ]) AS email
),
matched AS (
  SELECT
    t.email                  AS searched_email,
    p.id                     AS profile_id,
    p.full_name,
    p.email                  AS profile_email,
    p.institution_id,
    p.is_active,
    p.created_at
  FROM targets t
  LEFT JOIN public.profiles p ON lower(p.email) = lower(t.email)
)
SELECT
  m.searched_email,
  m.profile_id,
  m.full_name,
  m.profile_email,
  m.institution_id,
  m.is_active,
  m.created_at,

  -- Roles attached to this profile
  (
    SELECT string_agg(ur.role::text, ',' ORDER BY ur.role::text)
    FROM public.user_roles ur
    WHERE ur.user_id = m.profile_id
  ) AS roles,

  -- Milestone 1: tasks ASSIGNED to this user (the actual milestone)
  (SELECT COUNT(*) FROM public.task_assignments ta WHERE ta.assignee_id = m.profile_id)
    AS m1_task_assignments_as_assignee,

  -- For context: tasks they ASSIGNED to others (NOT a milestone, but commonly confused with it)
  (SELECT COUNT(*) FROM public.task_assignments ta WHERE ta.assigner_id = m.profile_id)
    AS ctx_task_assignments_as_assigner,

  -- Milestone 2: completed tasks they were assigned
  (
    SELECT COUNT(*)
    FROM public.task_assignments ta
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.assignee_id = m.profile_id
      AND t.status = 'completed'
  ) AS m2_completed_tasks,

  -- Milestone 3: study materials they uploaded
  (SELECT COUNT(*) FROM public.study_materials sm WHERE sm.created_by = m.profile_id)
    AS m3_study_materials_created,

  -- Milestone 4: exams they created (any status)
  (SELECT COUNT(*) FROM public.exams ex WHERE ex.created_by = m.profile_id)
    AS m4a_exams_created_any,
  -- Milestone 4 (real definition): exams published or completed
  (
    SELECT COUNT(*) FROM public.exams ex
    WHERE ex.created_by = m.profile_id
      AND ex.status IN ('published', 'completed')
  ) AS m4b_exams_published_or_completed,

  -- Milestone 5: results validated
  (SELECT COUNT(*) FROM public.final_results fr WHERE fr.finalized_by = m.profile_id)
    AS m5a_results_finalized,
  (SELECT COUNT(*) FROM public.final_results fr WHERE fr.published_by = m.profile_id)
    AS m5b_results_published

FROM matched m
ORDER BY m.searched_email, m.created_at NULLS LAST;
