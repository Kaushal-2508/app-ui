-- Fix SECURITY DEFINER view issue
-- Drop and recreate as SECURITY INVOKER (default)

DROP VIEW IF EXISTS public.student_eligible_exams;

-- Recreate view with explicit SECURITY INVOKER
CREATE VIEW public.student_eligible_exams 
WITH (security_invoker = true)
AS
SELECT 
  e.id AS exam_id,
  e.title,
  e.description,
  e.exam_mode,
  e.status,
  e.total_marks,
  e.duration_minutes,
  e.scheduled_date,
  e.start_time,
  e.end_time,
  e.instructions,
  ec.class_id,
  c.name AS class_name,
  ca.user_id AS student_id,
  sea.id AS attempt_id,
  sea.is_submitted,
  sea.is_locked,
  sea.started_at AS attempt_started_at,
  sea.submitted_at AS attempt_submitted_at,
  CASE 
    WHEN e.status != 'published' AND e.status != 'active' THEN 'not_available'
    WHEN sea.is_submitted = true THEN 'submitted'
    WHEN sea.is_locked = true THEN 'locked'
    WHEN sea.id IS NOT NULL THEN 'in_progress'
    WHEN e.start_time IS NOT NULL AND now() < e.start_time THEN 'not_started'
    WHEN e.end_time IS NOT NULL AND now() > e.end_time THEN 'expired'
    ELSE 'available'
  END AS attempt_status
FROM public.exams e
JOIN public.exam_classes ec ON ec.exam_id = e.id
JOIN public.classes c ON c.id = ec.class_id
JOIN public.class_assignments ca ON ca.class_id = ec.class_id AND ca.role = 'student'
LEFT JOIN public.student_exam_attempts sea ON sea.exam_id = e.id AND sea.student_id = ca.user_id
WHERE e.status IN ('published', 'active');

-- Re-grant access
GRANT SELECT ON public.student_eligible_exams TO authenticated;