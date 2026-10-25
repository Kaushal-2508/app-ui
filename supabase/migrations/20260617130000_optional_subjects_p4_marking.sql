-- =============================================================
-- OPTIONAL SUBJECTS — P4: marking rosters
-- -------------------------------------------------------------
-- A student unenrolled from an optional subject must not appear in
-- that subject's homework marking roster (else they read as
-- "missing marks"). Online exams are already handled by the P3
-- attempt-start guard (no attempt => no result/aggregate/passport
-- slot); offline-exam rosters are filtered client-side (useOfflineMarks).
--
-- Uses the same "blocked set" primitive as P3 (student_blocked_subject_ids)
-- — only optional + unenrolled subjects are ever excluded; compulsory
-- rosters are byte-identical.
--
-- NOTE: a homework-module function `homework_visible_to_student(_user_id,
-- _homework_id)` already exists (class-membership gate, no subject logic) —
-- we do NOT touch it. The subject check is inlined into the roster below.
-- =============================================================

CREATE OR REPLACE FUNCTION public.homework_marking_roster(_homework_id uuid)
 RETURNS TABLE(student_id uuid, full_name text, roll_number text, class_id uuid, class_name text, class_section text, submission_id uuid, submitted_at timestamp with time zone, is_late boolean, result_status text, marks_awarded numeric, feedback text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Optional-subject filtering: keep the student unless EVERY subject this
    -- homework carries is blocked (optional + this student unenrolled).
    AND (
      (
        (SELECT h.subject_id FROM public.homework_assignments h WHERE h.id = _homework_id) IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.homework_assignment_subjects hs
          WHERE hs.homework_assignment_id = _homework_id
        )
      )
      OR EXISTS (
        SELECT 1 FROM public.homework_assignments h
        WHERE h.id = _homework_id
          AND h.subject_id IS NOT NULL
          AND h.subject_id <> ALL (public.student_blocked_subject_ids(ca.user_id))
      )
      OR EXISTS (
        SELECT 1 FROM public.homework_assignment_subjects hs
        WHERE hs.homework_assignment_id = _homework_id
          AND hs.subject_id <> ALL (public.student_blocked_subject_ids(ca.user_id))
      )
    )
  ORDER BY ca.user_id, s.submitted_at NULLS LAST;
END;
$function$;

-- -------------------------------------------------------------
-- Offline-exam marking roster eligibility — the set of student ids
-- who should appear in an exam's marks grid (class members minus
-- those for whom the exam covers only optional subjects they're not
-- enrolled in). Used client-side by useOfflineMarks. Reuses the P3
-- exam_visible_to_student helper.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_marking_eligible_students(_exam uuid)
RETURNS TABLE(student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ca.user_id
  FROM public.exam_classes ec
  JOIN public.class_assignments ca ON ca.class_id = ec.class_id AND ca.role = 'student'
  WHERE ec.exam_id = _exam
    AND public.exam_visible_to_student(_exam, ca.user_id);
$$;
GRANT EXECUTE ON FUNCTION public.exam_marking_eligible_students(uuid) TO authenticated;
