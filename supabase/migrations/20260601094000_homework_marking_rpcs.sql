-- =====================================================================
-- Homework & Assignment — Phase 4: marking roster + publish RPCs
-- Both SECURITY DEFINER + can_manage_homework-gated (§23 server-side).
-- =====================================================================

-- Full per-student roster for the marking page (submitted + not-submitted),
-- with each student's submission + result fields. One row per student.
CREATE OR REPLACE FUNCTION public.homework_marking_roster(_homework_id uuid)
RETURNS TABLE (
  student_id     uuid,
  full_name      text,
  roll_number    text,
  class_id       uuid,
  class_name     text,
  class_section  text,
  submission_id  uuid,
  submitted_at   timestamptz,
  is_late        boolean,
  result_status  text,
  marks_awarded  numeric,
  feedback       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_homework(auth.uid(), _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ca.user_id)
    ca.user_id                         AS student_id,
    p.full_name,
    p.roll_number,
    c.id                               AS class_id,
    c.name                             AS class_name,
    c.section                          AS class_section,
    s.id                               AS submission_id,
    s.submitted_at,
    COALESCE(s.is_late, false)         AS is_late,
    r.status                           AS result_status,
    r.marks_awarded,
    r.feedback
  FROM public.homework_assignment_classes hac
  JOIN public.class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
  JOIN public.profiles p ON p.id = ca.user_id
  JOIN public.classes  c ON c.id = hac.class_id
  LEFT JOIN public.homework_submissions s
    ON s.homework_assignment_id = _homework_id AND s.student_id = ca.user_id
  LEFT JOIN public.homework_results r ON r.submission_id = s.id
  WHERE hac.homework_assignment_id = _homework_id
  ORDER BY ca.user_id, s.submitted_at NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_marking_roster(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_marking_roster(uuid) TO authenticated;

-- Publish gate: only flip to 'checked' when EVERY submission has a
-- graded/skipped result. Sets evaluated_by + checked_at.
CREATE OR REPLACE FUNCTION public.homework_publish_marks(_homework_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_status       text;
  v_unprocessed  integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF NOT public.can_manage_homework(v_uid, _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT status INTO v_status FROM public.homework_assignments WHERE id = _homework_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  IF v_status = 'draft' THEN RAISE EXCEPTION 'Publish the assignment before marking.'; END IF;

  SELECT count(*) INTO v_unprocessed
  FROM public.homework_submissions s
  LEFT JOIN public.homework_results r ON r.submission_id = s.id
  WHERE s.homework_assignment_id = _homework_id
    AND (r.id IS NULL OR r.status NOT IN ('graded','skipped'));

  IF v_unprocessed > 0 THEN
    RAISE EXCEPTION '% submission(s) not yet marked.', v_unprocessed;
  END IF;

  UPDATE public.homework_assignments
    SET status = 'checked', evaluated_by = v_uid, checked_at = now()
    WHERE id = _homework_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.homework_publish_marks(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_publish_marks(uuid) TO authenticated;
