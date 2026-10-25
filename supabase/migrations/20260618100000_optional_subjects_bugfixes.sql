-- =============================================================
-- OPTIONAL SUBJECTS — bug fixes
-- -------------------------------------------------------------
-- 1. Teachers can VIEW a student's subjects (Subjects tab was empty
--    for teachers because can_view_student_subjects excluded them →
--    get_student_subject_assignment raised 42501).
-- 2. check_subject_single_class_group falsely raised on idempotent
--    re-upserts (the BEFORE INSERT trigger saw a fresh NEW.id and
--    counted the row's own existing mapping). Compare class_group_id
--    instead — only a DIFFERENT class_group should be blocked.
-- 3. teacher_roster_student_ids: a teacher who teaches only an
--    OPTIONAL subject should see just the enrolled students, not the
--    whole class. Whole class for compulsory subjects (unchanged).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Teacher read access to the Subjects tab (read-only).
--    can_manage stays admin/coordinator-only, so teachers see the
--    toggles disabled.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_student_subjects(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    _actor = _student
    OR public.can_manage_student_subjects(_actor, _student)
    OR (
      public.has_role(_actor, 'teacher')
      AND EXISTS (
        SELECT 1 FROM public.profiles stu
        WHERE stu.id = _student
          AND stu.institution_id = public.get_user_institution(_actor)
      )
    );
$$;

-- -------------------------------------------------------------
-- 2. Single-class-group enforcement — compare class_group, not id.
--    Raise only when the institute subject is already attached to a
--    DIFFERENT class_group. This allows idempotent re-upserts of an
--    existing (class_group, subject) mapping (which the teacher
--    assignment flow does) while still enforcing one-class-group.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_subject_single_class_group()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inst_id        UUID;
  existing_count INT;
BEGIN
  SELECT institution_id INTO inst_id
  FROM public.universal_subjects WHERE id = NEW.subject_id;

  -- Global subjects (institution_id IS NULL) may map to many class_groups.
  IF inst_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO existing_count
  FROM public.subject_class_group_mappings
  WHERE subject_id = NEW.subject_id
    AND class_group_id <> NEW.class_group_id;

  IF existing_count > 0 THEN
    RAISE EXCEPTION 'A subject can only be attached to one class. Create a separate subject for the other class.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 3. Teacher roster — students a teacher should actually see across
--    the given classes. Whole class for compulsory subjects; only
--    enrolled students for optional subjects; plus the teacher's
--    optional-batch roster (cross-section).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_roster_student_ids(_teacher uuid, _class_ids uuid[])
RETURNS TABLE(student_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only the teacher themselves, or an admin/coordinator, may query.
  IF auth.uid() <> _teacher
     AND NOT public.is_super_admin(auth.uid())
     AND NOT public.has_role(auth.uid(), 'school_admin')
     AND NOT public.has_role(auth.uid(), 'super_school_admin')
     AND NOT public.has_role(auth.uid(), 'coordinator') THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- Class-subject teaching: whole class for compulsory, enrolled-only for optional.
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
      ca_tea.subject_id IS NULL          -- general class teacher → whole class
      OR scm.is_optional IS NOT TRUE     -- compulsory / unmapped → whole class
      OR EXISTS (                         -- optional → enrolled students only
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
GRANT EXECUTE ON FUNCTION public.teacher_roster_student_ids(uuid, uuid[]) TO authenticated;
