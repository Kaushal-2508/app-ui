-- Guard: a late-entry window of 0 must never lock every student out.
--
-- 20260630130000 made `expired` depend on the entry deadline
-- (start_time + late_entry_minutes). With late_entry_minutes = 0 that deadline
-- lands EXACTLY on start_time, so the exam was already expired the moment it
-- opened — every student saw "expired" and nobody could join. That is precisely
-- what happened to the Class 12 Science (Non-Medical) exam: the publish sheet
-- displayed the 15-minute default while an untouched field saved 0.
--
-- The frontend default is fixed separately (unset -> 15). This is the DB-side
-- backstop: treat 0 as "no dedicated join window" and fall back to the legacy
-- gate (end_time), which for a 0 window equals start + duration — i.e. exactly
-- the pre-late-entry behaviour. Only a POSITIVE late_entry_minutes creates a
-- distinct join deadline.
CREATE OR REPLACE VIEW public.student_eligible_exams
WITH (security_invoker = on) AS
 SELECT e.id AS exam_id,
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
            WHEN e.status <> ALL (ARRAY['published'::exam_status, 'active'::exam_status]) THEN 'not_available'::text
            WHEN sea.is_submitted = true THEN 'submitted'::text
            WHEN sea.is_locked = true THEN 'locked'::text
            WHEN sea.id IS NOT NULL THEN 'in_progress'::text
            WHEN e.start_time IS NOT NULL AND now() < e.start_time THEN 'not_started'::text
            WHEN w.entry_deadline IS NOT NULL AND now() > w.entry_deadline THEN 'expired'::text
            WHEN w.entry_deadline IS NULL AND e.scheduled_date IS NOT NULL AND now() > (e.scheduled_date::timestamp without time zone + '1 day'::interval) THEN 'expired'::text
            ELSE 'available'::text
        END AS attempt_status,
    exam_visible_to_student(e.id, ca.user_id) AS subject_visible,
    e.late_entry_minutes,
    w.entry_deadline
   FROM exams e
     JOIN exam_classes ec ON ec.exam_id = e.id
     JOIN classes c ON c.id = ec.class_id
     JOIN class_assignments ca ON ca.class_id = ec.class_id AND ca.role = 'student'::app_role
     LEFT JOIN student_exam_attempts sea ON sea.exam_id = e.id AND sea.student_id = ca.user_id
     CROSS JOIN LATERAL (
       SELECT
         CASE
           WHEN e.late_entry_minutes IS NOT NULL
                AND e.late_entry_minutes > 0
                AND e.start_time IS NOT NULL
             THEN e.start_time + make_interval(mins => e.late_entry_minutes)
           ELSE e.end_time
         END AS entry_deadline
     ) w
  WHERE (e.status = ANY (ARRAY['published'::exam_status, 'active'::exam_status])) AND e.exam_mode <> 'offline'::exam_mode;
