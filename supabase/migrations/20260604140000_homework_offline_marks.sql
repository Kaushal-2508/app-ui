-- =====================================================================
-- Homework refined behavior, Phase D: offline-marked assignments (R5) +
-- entering marks for non-submitting / late students (R6).
--
-- - homework_assignments.offline_marks: a marked assignment whose marks are
--   entered by the teacher (students submitted on paper). Online submission
--   is disabled for it.
-- - homework_results.submission_id becomes nullable, with a new
--   (homework_assignment_id, student_id) identity, so a result can exist for
--   a student who never submitted online (offline marks / late acceptance).
-- - homework_upsert_roster_marks: bulk/single SECURITY DEFINER upsert keyed on
--   (assignment, student), powering the offline roster grid and Checked-tab
--   non-submitter entry.
-- - roster, submission gate, and publish gate are made offline-aware.
-- =====================================================================

ALTER TABLE public.homework_assignments
  ADD COLUMN IF NOT EXISTS offline_marks boolean NOT NULL DEFAULT false;

ALTER TABLE public.homework_results
  ALTER COLUMN submission_id DROP NOT NULL;

-- Canonical identity for a result (one per student per assignment), so results
-- can exist without a submission. (Existing rows are already unique here, since
-- homework_submissions is UNIQUE(assignment, student).)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'homework_results_assignment_student_key'
  ) THEN
    ALTER TABLE public.homework_results
      ADD CONSTRAINT homework_results_assignment_student_key
      UNIQUE (homework_assignment_id, student_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Roster: join results by (assignment, student) so offline / non-submitter
-- results show up (they have submission_id = NULL). Keep the ::text casts
-- (the 42804 fix) and DISTINCT ON one-row-per-student shape.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_marking_roster(_homework_id uuid)
RETURNS TABLE (
  student_id uuid, full_name text, roll_number text, class_id uuid,
  class_name text, class_section text, submission_id uuid, submitted_at timestamptz,
  is_late boolean, result_status text, marks_awarded numeric, feedback text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_homework(auth.uid(), _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT ON (ca.user_id)
    ca.user_id AS student_id,
    p.full_name::text AS full_name,
    p.roll_number::text AS roll_number,
    c.id AS class_id,
    c.name::text AS class_name,
    c.section::text AS class_section,
    s.id AS submission_id,
    s.submitted_at AS submitted_at,
    COALESCE(s.is_late, false) AS is_late,
    r.status::text AS result_status,
    r.marks_awarded AS marks_awarded,
    r.feedback::text AS feedback
  FROM public.homework_assignment_classes hac
  JOIN public.class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
  JOIN public.profiles p ON p.id = ca.user_id
  JOIN public.classes  c ON c.id = hac.class_id
  LEFT JOIN public.homework_submissions s
    ON s.homework_assignment_id = _homework_id AND s.student_id = ca.user_id
  LEFT JOIN public.homework_results r
    ON r.homework_assignment_id = _homework_id AND r.student_id = ca.user_id
  WHERE hac.homework_assignment_id = _homework_id
  ORDER BY ca.user_id, s.submitted_at NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_marking_roster(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_marking_roster(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Bulk/single roster marks upsert (offline + non-submitter / late entry).
-- _marks: jsonb array of { student_id, marks_awarded (number|null), feedback (string|null) }.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_upsert_roster_marks(_homework_id uuid, _marks jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_count  integer := 0;
  m        jsonb;
  v_sid    uuid;
  v_sub    uuid;
  v_marks  numeric;
  v_fb     text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF NOT public.can_manage_homework(v_uid, _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(_marks)
  LOOP
    v_sid := (m->>'student_id')::uuid;
    -- Only accept students actually assigned to this homework.
    IF NOT EXISTS (
      SELECT 1 FROM public.homework_assignment_classes hac
      JOIN public.class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
      WHERE hac.homework_assignment_id = _homework_id AND ca.user_id = v_sid
    ) THEN
      CONTINUE;
    END IF;

    v_marks := CASE WHEN COALESCE(m->>'marks_awarded','') = '' THEN NULL ELSE (m->>'marks_awarded')::numeric END;
    v_fb    := NULLIF(m->>'feedback', '');
    SELECT s.id INTO v_sub FROM public.homework_submissions s
      WHERE s.homework_assignment_id = _homework_id AND s.student_id = v_sid;

    INSERT INTO public.homework_results
      (homework_assignment_id, student_id, submission_id, marks_awarded, feedback, status, evaluated_by, evaluated_at)
    VALUES
      (_homework_id, v_sid, v_sub, v_marks, v_fb, 'graded', v_uid, now())
    ON CONFLICT (homework_assignment_id, student_id) DO UPDATE
      SET marks_awarded = EXCLUDED.marks_awarded,
          feedback      = EXCLUDED.feedback,
          status        = 'graded',
          submission_id = COALESCE(homework_results.submission_id, EXCLUDED.submission_id),
          evaluated_by  = EXCLUDED.evaluated_by,
          evaluated_at  = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_upsert_roster_marks(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_upsert_roster_marks(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- Offline assignments do not accept online submissions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_open_for_submission(_user_id uuid, _homework_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.homework_visible_to_student(_user_id, _homework_id)
     AND EXISTS (
       SELECT 1 FROM public.homework_assignments h
       WHERE h.id = _homework_id AND now() <= h.due_at AND h.offline_marks = false
     );
$$;

-- ---------------------------------------------------------------------
-- Publish gate: offline marked assignments skip the submission-based gates
-- (no online submissions; the "you missed N" confirm covers completeness).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_publish_marks(_homework_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_status text; v_carries boolean; v_offline boolean;
  v_due timestamptz; v_unprocessed integer; v_missing integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF NOT public.can_manage_homework(v_uid, _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT status, carries_marks, offline_marks, due_at
    INTO v_status, v_carries, v_offline, v_due
    FROM public.homework_assignments WHERE id = _homework_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  IF v_status = 'draft' THEN RAISE EXCEPTION 'Publish the assignment before marking.'; END IF;

  IF v_carries AND NOT v_offline THEN
    IF v_due > now() THEN
      SELECT count(*) INTO v_missing FROM (
        SELECT DISTINCT ca.user_id
        FROM public.homework_assignment_classes hac
        JOIN public.class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
        WHERE hac.homework_assignment_id = _homework_id
          AND NOT EXISTS (
            SELECT 1 FROM public.homework_submissions s
            WHERE s.homework_assignment_id = _homework_id AND s.student_id = ca.user_id
          )
      ) x;
      IF v_missing > 0 THEN
        RAISE EXCEPTION 'Wait until everyone submits or the due date passes (% student(s) have not submitted yet).', v_missing;
      END IF;
    END IF;

    SELECT count(*) INTO v_unprocessed
    FROM public.homework_submissions s
    LEFT JOIN public.homework_results r ON r.submission_id = s.id
    WHERE s.homework_assignment_id = _homework_id
      AND (r.id IS NULL OR r.status NOT IN ('graded','skipped'));
    IF v_unprocessed > 0 THEN
      RAISE EXCEPTION '% submission(s) not yet marked.', v_unprocessed;
    END IF;
  END IF;

  UPDATE public.homework_assignments
    SET status = 'checked', evaluated_by = v_uid, checked_at = now()
    WHERE id = _homework_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.homework_publish_marks(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_publish_marks(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Student feed exposes offline_marks so the student UI hides the uploader.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_student_feed()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(t.obj ORDER BY t.due_at), '[]'::jsonb) INTO v_out
  FROM (
    SELECT h.due_at AS due_at, jsonb_build_object(
      'id', h.id, 'title', h.title,
      'description', CASE WHEN h.visible_from > now() THEN NULL ELSE h.description END,
      'status', h.status, 'carries_marks', h.carries_marks, 'offline_marks', h.offline_marks,
      'max_marks', h.max_marks, 'due_at', h.due_at, 'visible_from', h.visible_from,
      'locked', (h.visible_from > now()),
      'attachment_path', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_path END,
      'attachment_name', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_name END,
      'attachment_mime', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_mime END,
      'checked_at', h.checked_at,
      'subject', (SELECT jsonb_build_object('id', us.id, 'name', us.name) FROM public.universal_subjects us WHERE us.id = h.subject_id),
      'classes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'section', c.section)), '[]'::jsonb) FROM public.homework_assignment_classes hac2 JOIN public.classes c ON c.id = hac2.class_id WHERE hac2.homework_assignment_id = h.id),
      'submission', (SELECT jsonb_build_object('id', s.id, 'submitted_at', s.submitted_at, 'is_late', s.is_late) FROM public.homework_submissions s WHERE s.homework_assignment_id = h.id AND s.student_id = v_uid),
      'result', (SELECT jsonb_build_object('marks_awarded', r.marks_awarded, 'feedback', r.feedback, 'status', r.status) FROM public.homework_results r WHERE r.homework_assignment_id = h.id AND r.student_id = v_uid AND h.status = 'checked')
    ) AS obj
    FROM public.homework_assignments h
    WHERE h.status IN ('published','checked')
      AND EXISTS (SELECT 1 FROM public.homework_assignment_classes hac JOIN public.class_assignments ca ON ca.class_id = hac.class_id WHERE hac.homework_assignment_id = h.id AND ca.user_id = v_uid AND ca.role = 'student')
  ) t;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_student_feed() FROM public;
GRANT EXECUTE ON FUNCTION public.homework_student_feed() TO authenticated;
