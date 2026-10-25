-- set_student_class — the single write path for moving a student between
-- sections, backing the new "Update Class & Section" bulk screen.
--
-- Why an RPC and not the client:
--   AssignStudentClassDialog moves a student with two separate client calls
--   (insert the new row, then prune the old ones). Ordering makes it survivable,
--   but they are still two dependent writes over the network — if the second
--   never lands the student sits in two classes, and nothing names the actor.
--   This function does the same swap inside ONE transaction, checks authority
--   over BOTH ends of the move, and lets trg_log_class_assignment_deletion
--   (20260807140000) capture every removed row for restore.
--
-- Authority model — deliberately narrower than update_student_details:
--   * student end: can_manage_student_subjects = super admin, school admin,
--     super school admin, student-manager override, or the wing coordinator of
--     the student's current class. Teachers are NOT admitted; editing a roll
--     number is class-local, moving a student rewrites their whole portal
--     (exams, homework, attendance, timetable).
--   * destination end: checked separately, so a wing coordinator cannot push a
--     student into a class outside their wing.

CREATE OR REPLACE FUNCTION public.set_student_class(_student uuid, _class uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller        uuid := auth.uid();
  v_student_inst  uuid;
  v_target_inst   uuid;
  v_target_active boolean;
  v_target_label  text;
  v_moved_from    uuid[];
  v_already       boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'You are signed out. Sign in and try again.' USING ERRCODE = '42501';
  END IF;

  IF _student IS NULL OR _class IS NULL THEN
    RAISE EXCEPTION 'Both a student and a destination class are required.' USING ERRCODE = '22023';
  END IF;

  -- ---- authority over the STUDENT ----------------------------------------
  IF NOT public.can_manage_student_subjects(v_caller, _student) THEN
    RAISE EXCEPTION 'You do not have permission to move this student.' USING ERRCODE = '42501';
  END IF;

  SELECT p.institution_id INTO v_student_inst
  FROM public.profiles p WHERE p.id = _student;

  IF v_student_inst IS NULL THEN
    RAISE EXCEPTION 'Student record not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _student AND ur.role = 'student'
  ) THEN
    RAISE EXCEPTION 'That account is not a student.' USING ERRCODE = '22023';
  END IF;

  -- ---- the DESTINATION class ---------------------------------------------
  SELECT c.institution_id,
         COALESCE(c.is_active, false),
         c.name || COALESCE(' - ' || c.section, '')
    INTO v_target_inst, v_target_active, v_target_label
  FROM public.classes c WHERE c.id = _class;

  IF v_target_inst IS NULL THEN
    RAISE EXCEPTION 'Destination class not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_target_inst <> v_student_inst THEN
    RAISE EXCEPTION 'Destination class belongs to a different school.' USING ERRCODE = '42501';
  END IF;

  IF NOT v_target_active THEN
    RAISE EXCEPTION '% is archived. Pick an active section.', v_target_label USING ERRCODE = '22023';
  END IF;

  -- ---- authority over the DESTINATION -------------------------------------
  IF NOT (
    public.is_super_admin(v_caller)
    OR (
      v_target_inst = public.get_user_institution(v_caller)
      AND (
        public.has_role(v_caller, 'school_admin')
        OR public.has_role(v_caller, 'super_school_admin')
        OR public.is_student_manager(v_caller)
        OR (
          public.has_role(v_caller, 'coordinator')
          AND public.is_coordinator_for_class(v_caller, _class)
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'You do not have permission to move students into %.', v_target_label
      USING ERRCODE = '42501';
  END IF;

  -- ---- the move ------------------------------------------------------------
  SELECT array_agg(ca.class_id) INTO v_moved_from
  FROM public.class_assignments ca
  WHERE ca.user_id = _student AND ca.role = 'student' AND ca.class_id <> _class;

  SELECT EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = _student AND ca.role = 'student' AND ca.class_id = _class
  ) INTO v_already;

  -- Insert first, prune second, both inside this function's single transaction:
  -- any failure rolls the whole move back, so the student can never be left
  -- with no class at all. The explicit existence check (not ON CONFLICT) is
  -- deliberate — the unique index is (user_id, class_id, subject_id) and
  -- subject_id is NULL on student rows, so NULLs-are-distinct means ON CONFLICT
  -- would happily write a duplicate. This also makes a repeat call a no-op.
  IF NOT v_already THEN
    INSERT INTO public.class_assignments (user_id, class_id, role, assigned_by)
    VALUES (_student, _class, 'student', v_caller);
  END IF;

  DELETE FROM public.class_assignments
  WHERE user_id = _student AND role = 'student' AND class_id <> _class;

  RETURN jsonb_build_object(
    'student_id',  _student,
    'class_id',    _class,
    'class_label', v_target_label,
    'moved_from',  COALESCE(to_jsonb(v_moved_from), '[]'::jsonb),
    'was_already_there', v_already AND COALESCE(array_length(v_moved_from, 1), 0) = 0
  );
END;
$$;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new
-- public function, and REVOKE ... FROM PUBLIC does not strip it. Name anon.
REVOKE ALL ON FUNCTION public.set_student_class(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_student_class(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_student_class(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.set_student_class(uuid, uuid) IS
  'Moves a student to one section in a single transaction. Admin / student-manager / wing-coordinator only, checked at both ends of the move. Deletions land in class_assignment_deletions.';
