-- Admit TEACHERS (class-scoped) to student-detail editing, on top of the
-- existing admin + wing-coordinator authority — WITHOUT widening the shared
-- can_manage_student_subjects helper (which also backs 4 optional-enrollment
-- RLS policies; widening it there would grant teachers enrollment writes).
--
-- Teacher scope source = class_assignments(role='teacher') via is_teacher_for_class.

CREATE OR REPLACE FUNCTION public.can_edit_student_details(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.can_manage_student_subjects(_actor, _student)   -- admins + wing-coordinators
    OR (
      public.has_role(_actor, 'teacher')
      AND EXISTS (
        SELECT 1 FROM public.profiles stu
        WHERE stu.id = _student
          AND stu.institution_id = public.get_user_institution(_actor)
      )
      AND EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = _student
          AND ca.role = 'student'
          AND public.is_teacher_for_class(_actor, ca.class_id)
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_edit_student_details(uuid, uuid) TO authenticated;

-- Re-point the update_student_details gate at the new helper. Body otherwise
-- identical to migration 20260620120000 (only line changed: the gate).
CREATE OR REPLACE FUNCTION public.update_student_details(
  _student            uuid,
  _full_name          text,
  _roll_number        text,
  _admission_number   text,
  _phone              text,
  _date_of_birth      date,
  _guardian_name      text,
  _guardian_phone     text,
  _guardian_email     text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst          uuid;
  v_conflict_name text;
BEGIN
  IF NOT public.can_edit_student_details(auth.uid(), _student) THEN
    RAISE EXCEPTION 'You do not have permission to edit this student.'
      USING ERRCODE = '42501';
  END IF;

  -- Normalise blanks to NULL so empty inputs clear the field.
  _full_name        := NULLIF(btrim(_full_name), '');
  _roll_number      := NULLIF(btrim(_roll_number), '');
  _admission_number := NULLIF(btrim(_admission_number), '');
  _phone            := NULLIF(btrim(_phone), '');
  _guardian_name    := NULLIF(btrim(_guardian_name), '');
  _guardian_phone   := NULLIF(btrim(_guardian_phone), '');
  _guardian_email   := NULLIF(btrim(_guardian_email), '');

  IF _full_name IS NULL THEN
    RAISE EXCEPTION 'Student name cannot be empty.' USING ERRCODE = '23514';
  END IF;

  SELECT institution_id INTO v_inst FROM public.profiles WHERE id = _student;

  -- Roll number: unique within the student's class(es).
  IF _roll_number IS NOT NULL THEN
    SELECT p.full_name INTO v_conflict_name
    FROM public.profiles p
    JOIN public.class_assignments ca ON ca.user_id = p.id AND ca.role = 'student'
    WHERE p.roll_number = _roll_number
      AND p.id <> _student
      AND ca.class_id IN (
        SELECT class_id FROM public.class_assignments
        WHERE user_id = _student AND role = 'student'
      )
    LIMIT 1;
    IF v_conflict_name IS NOT NULL THEN
      RAISE EXCEPTION 'Roll number % is already assigned to % in this class. Use a different roll number.',
        _roll_number, v_conflict_name USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Admission number: unique within the institution.
  IF _admission_number IS NOT NULL THEN
    SELECT p.full_name INTO v_conflict_name
    FROM public.profiles p
    WHERE p.admission_number = _admission_number
      AND p.id <> _student
      AND p.institution_id IS NOT DISTINCT FROM v_inst
    LIMIT 1;
    IF v_conflict_name IS NOT NULL THEN
      RAISE EXCEPTION 'Admission number % is already used by %. Use a different admission number.',
        _admission_number, v_conflict_name USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.profiles
  SET full_name        = _full_name,
      roll_number      = _roll_number,
      admission_number = _admission_number,
      phone            = _phone,
      updated_at       = now()
  WHERE id = _student;

  -- School-managed personal details (1:1 with the profile).
  INSERT INTO public.student_personal_details
    (profile_id, date_of_birth, guardian_name, guardian_phone, guardian_email, updated_by, updated_at)
  VALUES
    (_student, _date_of_birth, _guardian_name, _guardian_phone, _guardian_email, auth.uid(), now())
  ON CONFLICT (profile_id) DO UPDATE SET
    date_of_birth  = EXCLUDED.date_of_birth,
    guardian_name  = EXCLUDED.guardian_name,
    guardian_phone = EXCLUDED.guardian_phone,
    guardian_email = EXCLUDED.guardian_email,
    updated_by     = EXCLUDED.updated_by,
    updated_at     = now();
END;
$$;
