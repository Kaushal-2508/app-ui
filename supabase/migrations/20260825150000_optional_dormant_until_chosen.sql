-- =============================================================
-- OPTIONAL SUBJECTS — dormant until a section records choices
-- -------------------------------------------------------------
-- INCIDENT (2026-08-25, Alliance): every teacher whose only subjects are
-- optional-flagged saw ZERO students (6 teachers, up to 12 classes each),
-- and Class 10-12 students had every optional subject's exams + homework
-- hidden (3,827 live student-subject blocks), because AIS flagged subjects
-- optional in May but never recorded a single senior-class choice in
-- student_optional_enrollments. The narrowing helpers all FAILED CLOSED on
-- missing data:
--   * teacher_roster_student_ids: optional -> enrolled-only -> 0 students
--   * student_blocked_subject_ids: optional + unenrolled -> blocked, which
--     hid exams/homework and made trg_enforce_exam_subject_enrollment
--     refuse attempt starts
--   * student_visible_subject_ids: optional + unenrolled -> absent
--
-- THE RULE THIS MIGRATION INSTALLS: an optional subject only narrows
-- anything once the school has actually recorded at least one active
-- choice for that (subject, section). Until then the subject behaves as
-- compulsory (whole class, fully visible). The moment real choices land,
-- enrolled-only narrowing switches on for that section automatically.
-- P3's stated intent was always "behavioural no-op until used" — it was
-- just keyed on the individual student instead of the section.
--
-- NOTE: soe.class_id is NULL on every real row (the optional-groups writer
-- never populates it), so "choices recorded for this section" must join
-- through class_assignments — never key on soe.class_id.
--
-- Also fixed while replacing these functions:
--   * teacher_roster_student_ids treated auth.uid() IS NULL as a PASS
--     (NULL <> x is NULL, so the caller guard fell through) — now an
--     explicit empty return.
--   * anon had EXECUTE on all of these via Supabase's default privileges;
--     revoked BY NAME below (REVOKE FROM PUBLIC does not remove it).
-- =============================================================

-- -------------------------------------------------------------
-- 0. The dormancy switch: has this section recorded any active
--    choice for this subject?
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.optional_choices_recorded(_subject uuid, _class uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_optional_enrollments soe
    JOIN public.class_assignments ca
      ON ca.user_id = soe.student_id
     AND ca.role = 'student'
     AND ca.class_id = _class
    WHERE soe.subject_id = _subject
      AND soe.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.optional_choices_recorded(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.optional_choices_recorded(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.optional_choices_recorded(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.optional_choices_recorded(uuid, uuid) IS
  'True when at least one active optional-subject choice exists for this (subject, section). All optional-subject narrowing (teacher rosters, student blocking) stays dormant until this is true.';

-- -------------------------------------------------------------
-- 1. Teacher roster. Feeds TeacherStudentsPage plus six dash_teacher_*
--    RPCs (activity signal, action queue, phase3, portal adoption,
--    header/laggards). Optional narrowing now applies per assignment row
--    only when that section has recorded choices.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_roster_student_ids(_teacher uuid, _class_ids uuid[])
RETURNS TABLE(student_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only the teacher themselves, or an admin/coordinator, may query.
  -- auth.uid() IS NULL must fail closed here (it used to fall through:
  -- NULL <> _teacher is NULL, and IF NULL skips the block).
  IF auth.uid() IS NULL
     OR (auth.uid() <> _teacher
         AND NOT public.is_super_admin(auth.uid())
         AND NOT public.has_role(auth.uid(), 'school_admin')
         AND NOT public.has_role(auth.uid(), 'super_school_admin')
         AND NOT public.has_role(auth.uid(), 'coordinator')) THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- Class-subject teaching: whole class for compulsory, for unmapped, and for
  -- optional subjects whose section has no recorded choices yet (dormant);
  -- enrolled-only once the section has real choices.
  SELECT DISTINCT ca_stu.user_id
  FROM public.class_assignments ca_tea
  JOIN public.class_assignments ca_stu
    ON ca_stu.class_id = ca_tea.class_id AND ca_stu.role = 'student'
  LEFT JOIN public.subject_class_mappings scm
    ON scm.class_id = ca_tea.class_id AND scm.subject_id = ca_tea.subject_id
  WHERE ca_tea.user_id = _teacher
    AND ca_tea.role = 'teacher'
    AND ca_tea.class_id = ANY (_class_ids)
    AND (
      ca_tea.subject_id IS NULL          -- general class teacher -> whole class
      OR scm.is_optional IS NOT TRUE     -- compulsory / unmapped -> whole class
      OR NOT public.optional_choices_recorded(ca_tea.subject_id, ca_tea.class_id)
                                         -- optional but dormant -> whole class
      OR EXISTS (                        -- optional + in use -> enrolled only
        SELECT 1 FROM public.student_optional_enrollments soe
        WHERE soe.student_id = ca_stu.user_id
          AND soe.subject_id = ca_tea.subject_id
          AND soe.is_active = true
      )
    )

  UNION

  -- Optional-batch teaching: the teacher's batch roster, scoped to the classes.
  SELECT obs.student_id
  FROM public.optional_batches ob
  JOIN public.optional_batch_students obs ON obs.batch_id = ob.id
  JOIN public.class_assignments ca_stu2
    ON ca_stu2.user_id = obs.student_id
   AND ca_stu2.role = 'student'
   AND ca_stu2.class_id = ANY (_class_ids)
  WHERE ob.teacher_id = _teacher;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_roster_student_ids(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_roster_student_ids(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_roster_student_ids(uuid, uuid[]) TO authenticated;

-- -------------------------------------------------------------
-- 2. Student blocked set. Feeds exam_visible_to_student (student exam
--    list + the attempt-start trigger), homework_student_feed, the
--    homework marking roster, and the staff-view student dashboard.
--    A subject can only block once its section has recorded choices.
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
    AND public.optional_choices_recorded(scm.subject_id, ca.class_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.student_optional_enrollments soe
      WHERE soe.student_id = _student
        AND soe.subject_id = scm.subject_id
        AND soe.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.student_blocked_subject_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_blocked_subject_ids(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_blocked_subject_ids(uuid) TO authenticated;

-- -------------------------------------------------------------
-- 3. Student visible set (complement of the blocked set): dormant
--    optionals count as visible, exactly like compulsory subjects.
--    For every student, visible ∪ blocked still covers all mapped
--    subjects and the two never overlap.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_visible_subject_ids(_student uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT sid), ARRAY[]::uuid[]) FROM (
    -- Compulsory: every non-optional subject mapped to the student's section(s).
    SELECT scm.subject_id AS sid
    FROM public.class_assignments ca
    JOIN public.subject_class_mappings scm ON scm.class_id = ca.class_id
    WHERE ca.user_id = _student AND ca.role = 'student' AND scm.is_optional = false
    UNION
    -- Optional but dormant (section has no recorded choices): visible.
    SELECT scm.subject_id AS sid
    FROM public.class_assignments ca
    JOIN public.subject_class_mappings scm ON scm.class_id = ca.class_id
    WHERE ca.user_id = _student AND ca.role = 'student'
      AND scm.is_optional = true
      AND NOT public.optional_choices_recorded(scm.subject_id, ca.class_id)
    UNION
    -- Optional in use: enrolled subjects still mapped to one of the student's sections.
    SELECT scm.subject_id AS sid
    FROM public.student_optional_enrollments soe
    JOIN public.class_assignments ca
      ON ca.user_id = soe.student_id AND ca.role = 'student'
    JOIN public.subject_class_mappings scm
      ON scm.class_id = ca.class_id AND scm.subject_id = soe.subject_id
    WHERE soe.student_id = _student AND soe.is_active = true
  ) u;
$$;

REVOKE ALL ON FUNCTION public.student_visible_subject_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_visible_subject_ids(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_visible_subject_ids(uuid) TO authenticated;

-- -------------------------------------------------------------
-- 4. Hygiene: exam_visible_to_student had an anon grant too (body
--    unchanged — it composes the blocked set).
-- -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.exam_visible_to_student(uuid, uuid) FROM anon;
