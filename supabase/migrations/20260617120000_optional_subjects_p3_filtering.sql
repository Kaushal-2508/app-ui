-- =============================================================
-- OPTIONAL SUBJECTS — P3: student-facing filtering
-- -------------------------------------------------------------
-- An unenrolled student must not see / be eligible for an optional
-- subject's exams or homework. Compulsory subjects are unchanged
-- (they're in student_visible_subject_ids for every section member),
-- and rows with NO subject linkage stay visible to everyone.
--
-- Behavioural no-op until a subject is actually marked optional and
-- a student is left unenrolled.
-- =============================================================

-- -------------------------------------------------------------
-- 0. "Blocking set" — optional subjects mapped to the student's
--    section(s) that they are NOT enrolled in. This is the ONLY
--    thing filtering may hide. Crucially it does NOT include
--    compulsory subjects, enrolled optionals, or subjects not
--    mapped to the student's class (global/unmapped exam subjects),
--    so filtering never removes content for those reasons.
--    Empty set => nothing is ever hidden (current state).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_blocked_subject_ids(_student uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT scm.subject_id), ARRAY[]::uuid[])
  FROM public.class_assignments ca
  JOIN public.subject_class_mappings scm ON scm.class_id = ca.class_id
  WHERE ca.user_id = _student
    AND ca.role = 'student'
    AND scm.is_optional = true
    AND NOT EXISTS (
      SELECT 1 FROM public.student_optional_enrollments soe
      WHERE soe.student_id = _student
        AND soe.subject_id = scm.subject_id
        AND soe.is_active = true
    );
$$;
GRANT EXECUTE ON FUNCTION public.student_blocked_subject_ids(uuid) TO authenticated;

-- -------------------------------------------------------------
-- 1. Visibility helper for a (possibly multi-subject) exam.
--    Hidden ONLY if it has subject linkage AND every linked subject
--    is blocked (optional + unenrolled). Otherwise visible — this
--    preserves exams with no linkage, compulsory subjects, and
--    subjects not mapped to the student's class.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_visible_to_student(_exam uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.exam_subjects es WHERE es.exam_id = _exam)
    OR EXISTS (
      SELECT 1 FROM public.exam_subjects es
      WHERE es.exam_id = _exam
        AND es.subject_id <> ALL (public.student_blocked_subject_ids(_student))
    );
$$;
GRANT EXECUTE ON FUNCTION public.exam_visible_to_student(uuid, uuid) TO authenticated;

-- -------------------------------------------------------------
-- 2. Recreate student_eligible_exams with a `subject_visible`
--    column appended (CREATE OR REPLACE keeps existing columns in
--    order + adds new ones at the end). Consumers opt in via
--    `.eq('subject_visible', true)`; existing readers are unaffected.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.student_eligible_exams AS
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
            WHEN e.end_time IS NOT NULL AND now() > e.end_time THEN 'expired'::text
            WHEN e.end_time IS NULL AND e.scheduled_date IS NOT NULL AND now() > (e.scheduled_date::timestamp without time zone + '1 day'::interval) THEN 'expired'::text
            ELSE 'available'::text
        END AS attempt_status,
    public.exam_visible_to_student(e.id, ca.user_id) AS subject_visible
   FROM exams e
     JOIN exam_classes ec ON ec.exam_id = e.id
     JOIN classes c ON c.id = ec.class_id
     JOIN class_assignments ca ON ca.class_id = ec.class_id AND ca.role = 'student'::app_role
     LEFT JOIN student_exam_attempts sea ON sea.exam_id = e.id AND sea.student_id = ca.user_id
  WHERE (e.status = ANY (ARRAY['published'::exam_status, 'active'::exam_status])) AND e.exam_mode <> 'offline'::exam_mode;

-- -------------------------------------------------------------
-- 3. homework_student_feed — exclude assignments whose subjects the
--    student doesn't take. Visible set computed once. No-linkage
--    homework stays visible.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_student_feed()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_blocked uuid[];
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_blocked := public.student_blocked_subject_ids(v_uid);

  SELECT COALESCE(jsonb_agg(t.obj ORDER BY t.due_at), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT
      h.due_at AS due_at,
      jsonb_build_object(
        'id', h.id,
        'title', h.title,
        'description',     CASE WHEN h.visible_from > now() THEN NULL ELSE h.description END,
        'status', h.status,
        'carries_marks', h.carries_marks,
        'max_marks', h.max_marks,
        'due_at', h.due_at,
        'visible_from', h.visible_from,
        'locked', (h.visible_from > now()),
        'attachment_path', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_path END,
        'attachment_name', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_name END,
        'attachment_mime', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_mime END,
        'checked_at', h.checked_at,
        'subject', (
          SELECT jsonb_build_object('id', us.id, 'name', us.name)
          FROM public.universal_subjects us
          WHERE us.id = h.subject_id
        ),
        'subjects', (
          SELECT COALESCE(
                   jsonb_agg(jsonb_build_object('id', us.id, 'name', us.name) ORDER BY us.name),
                   '[]'::jsonb)
          FROM public.homework_assignment_subjects has2
          JOIN public.universal_subjects us ON us.id = has2.subject_id
          WHERE has2.homework_assignment_id = h.id
        ),
        'classes', (
          SELECT COALESCE(
                   jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'section', c.section)),
                   '[]'::jsonb)
          FROM public.homework_assignment_classes hac2
          JOIN public.classes c ON c.id = hac2.class_id
          WHERE hac2.homework_assignment_id = h.id
        ),
        'submission', (
          SELECT jsonb_build_object('id', s.id, 'submitted_at', s.submitted_at, 'is_late', s.is_late)
          FROM public.homework_submissions s
          WHERE s.homework_assignment_id = h.id AND s.student_id = v_uid
        ),
        'result', (
          SELECT jsonb_build_object('marks_awarded', r.marks_awarded, 'feedback', r.feedback, 'status', r.status)
          FROM public.homework_results r
          WHERE r.homework_assignment_id = h.id
            AND r.student_id = v_uid
            AND h.status = 'checked'
        )
      ) AS obj
    FROM public.homework_assignments h
    WHERE h.status IN ('published','checked')
      AND EXISTS (
        SELECT 1
        FROM public.homework_assignment_classes hac
        JOIN public.class_assignments ca ON ca.class_id = hac.class_id
        WHERE hac.homework_assignment_id = h.id
          AND ca.user_id = v_uid
          AND ca.role = 'student'
      )
      -- Optional-subject filtering: hide only when every linked subject is
      -- blocked (optional + unenrolled). No-linkage / compulsory / unmapped
      -- subjects keep the homework visible.
      AND (
        ( h.subject_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.homework_assignment_subjects hs
                          WHERE hs.homework_assignment_id = h.id) )
        OR ( h.subject_id IS NOT NULL AND h.subject_id <> ALL (v_blocked) )
        OR EXISTS (
          SELECT 1 FROM public.homework_assignment_subjects hs
          WHERE hs.homework_assignment_id = h.id
            AND hs.subject_id <> ALL (v_blocked)
        )
      )
  ) t;

  RETURN v_out;
END;
$function$;

-- -------------------------------------------------------------
-- 4. Attempt-start guard — a student cannot start an attempt for an
--    optional-subject exam they're not enrolled in. No-op for
--    compulsory / no-linkage exams (exam_visible_to_student = true).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_exam_subject_enrollment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.exam_visible_to_student(NEW.exam_id, NEW.student_id) THEN
    RAISE EXCEPTION 'This exam covers an optional subject the student is not enrolled in.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_exam_subject_enrollment ON public.student_exam_attempts;
CREATE TRIGGER trg_enforce_exam_subject_enrollment
  BEFORE INSERT ON public.student_exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_exam_subject_enrollment();
