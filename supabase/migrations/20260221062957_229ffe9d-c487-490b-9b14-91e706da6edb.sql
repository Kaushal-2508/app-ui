CREATE OR REPLACE VIEW public.student_eligible_exams AS
SELECT e.id AS exam_id,
    e.title, e.description, e.exam_mode, e.status,
    e.total_marks, e.duration_minutes, e.scheduled_date,
    e.start_time, e.end_time, e.instructions,
    ec.class_id, c.name AS class_name,
    ca.user_id AS student_id,
    sea.id AS attempt_id, sea.is_submitted, sea.is_locked,
    sea.started_at AS attempt_started_at,
    sea.submitted_at AS attempt_submitted_at,
    CASE
        WHEN e.status NOT IN ('published', 'active') THEN 'not_available'
        WHEN sea.is_submitted = true THEN 'submitted'
        WHEN sea.is_locked = true THEN 'locked'
        WHEN sea.id IS NOT NULL THEN 'in_progress'
        WHEN e.start_time IS NOT NULL AND now() < e.start_time THEN 'not_started'
        WHEN e.end_time IS NOT NULL AND now() > e.end_time THEN 'expired'
        ELSE 'available'
    END AS attempt_status
FROM exams e
JOIN exam_classes ec ON ec.exam_id = e.id
JOIN classes c ON c.id = ec.class_id
JOIN class_assignments ca ON ca.class_id = ec.class_id AND ca.role = 'student'
LEFT JOIN student_exam_attempts sea ON sea.exam_id = e.id AND sea.student_id = ca.user_id
WHERE e.status IN ('published', 'active')
  AND e.exam_mode != 'offline';