-- Late entry was written but never enforced.
--
-- `exams.availability_end` (= start + late entry) was computed on save and read
-- by NOTHING: no view, no function, no policy. The only gate anywhere was
-- `exams.end_time`, which the publish sheet computed as `start + duration`. So
-- the entry window always closed at the exam's own end:
--   * a student joining 10 min late lost those 10 min, and
--   * a 180-minute late-entry window was silently ignored.
--
-- Fix: store the late-entry window explicitly and gate entry on it.
--   entry deadline = start_time + late_entry_minutes   (last moment to JOIN)
--   end_time       = start_time + late_entry_minutes + duration_minutes
--                    (last possible FINISH — the latest joiner still gets their
--                     full duration; the per-student deadline stays
--                     started_at + duration, as the attempt timer and
--                     close_stale_exam_attempts_sweep already compute it)
--
-- BACKWARD COMPATIBILITY: late_entry_minutes stays NULL on existing rows, and a
-- NULL falls back to end_time — so every already-published exam keeps its
-- current behaviour exactly. Only exams saved after this ships carry the new
-- semantics.

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS late_entry_minutes INTEGER;

COMMENT ON COLUMN public.exams.late_entry_minutes IS
  'Minutes after start_time during which students may still JOIN. NULL = legacy row (entry gated by end_time). Each student always gets the full duration_minutes from their own started_at.';

ALTER TABLE public.exams
  DROP CONSTRAINT IF EXISTS exams_late_entry_minutes_range;

ALTER TABLE public.exams
  ADD CONSTRAINT exams_late_entry_minutes_range
  CHECK (late_entry_minutes IS NULL OR (late_entry_minutes >= 0 AND late_entry_minutes <= 1440));

-- Recreate the eligibility view so `expired` is driven by the ENTRY deadline.
-- CREATE OR REPLACE (not DROP) to avoid breaking dependents; existing columns
-- keep their position and type, the two new ones are appended.
-- WITH (security_invoker = on) MUST be re-stated — CREATE OR REPLACE resets
-- reloptions, and this view is required to run as the querying user.
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
           WHEN e.late_entry_minutes IS NOT NULL AND e.start_time IS NOT NULL
             THEN e.start_time + make_interval(mins => e.late_entry_minutes)
           ELSE e.end_time
         END AS entry_deadline
     ) w
  WHERE (e.status = ANY (ARRAY['published'::exam_status, 'active'::exam_status])) AND e.exam_mode <> 'offline'::exam_mode;
