-- =============================================================
-- Teachers may no longer CHANGE a student's optional subjects
-- -------------------------------------------------------------
-- Reverses the write half of 20260729150000_teacher_optional_choice_edit.sql
-- on user request (2026-08-26). Optional-subject choices are an
-- admissions/administration decision, not a teaching one: a choice
-- rewrites which exams, homework and rosters a student belongs to.
--
-- The single helper can_manage_student_optional_choices gated FOUR things at
-- once, read and write together:
--     1. soe_select_manage        (SELECT)  - teacher READ
--     2. soe_update_manage        (UPDATE)  - teacher WRITE
--     3. set_student_optional_group_choices (the Save RPC gate)
--     4. get_student_optional_group_assignment.can_manage (UI enable flag)
-- Narrowing it wholesale would also blind teachers to what their students
-- take, which they legitimately need. So the helper is SPLIT:
--
--   can_manage_student_optional_choices -> admins / super admins /
--       student-managers / wing coordinators ONLY  (drives 2, 3, 4)
--   can_view_student_optional_choices   -> the previous wider rule,
--       still admitting class teachers   (drives 1 only)
--
-- Net effect: a teacher opening ViewUserSheet -> Subjects still SEES the
-- compulsory list and each optional group's current choice; the dropdowns
-- render disabled, the "Save choices" button is not rendered at all, and the
-- tab shows "You don't have permission to change this student's subjects."
-- The frontend needs no change - it already keys off can_manage.
--
-- Enforcement is at the database, so a crafted request fails too: the Save
-- RPC raises 42501 and the UPDATE policy rejects a direct PostgREST write.
-- INSERT/DELETE on student_optional_enrollments were already admin-only.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Read gate — keeps the pre-existing (wider) rule verbatim.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_student_optional_choices(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.can_manage_student_subjects(_actor, _student)
    OR (
      public.has_role(_actor, 'teacher')
      AND EXISTS (
        SELECT 1
        FROM public.class_assignments ca_t
        JOIN public.class_assignments ca_s
          ON ca_s.class_id = ca_t.class_id AND ca_s.role = 'student'
        WHERE ca_t.user_id = _actor
          AND ca_t.role = 'teacher'
          AND ca_s.user_id = _student
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_student_optional_choices(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_student_optional_choices(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_student_optional_choices(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.can_view_student_optional_choices(uuid, uuid) IS
  'READ gate for a student''s optional-subject choices: admins, wing coordinators, and any teacher sharing a class with the student. Read only - see can_manage_student_optional_choices for writes.';

-- -------------------------------------------------------------
-- 2. Write gate — teachers removed. Now exactly the admin /
--    student-manager / wing-coordinator set.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_student_optional_choices(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.can_manage_student_subjects(_actor, _student);
$$;

REVOKE ALL ON FUNCTION public.can_manage_student_optional_choices(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_student_optional_choices(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_manage_student_optional_choices(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.can_manage_student_optional_choices(uuid, uuid) IS
  'WRITE gate for a student''s optional-subject choices: admins, student-managers and wing coordinators. Teachers were admitted 2026-07-29 and removed 2026-08-26 - do not re-widen this without also re-checking soe_update_manage and the Save RPC.';

-- -------------------------------------------------------------
-- 3. Re-point the SELECT policy at the read gate so teachers keep
--    their visibility. UPDATE keeps the (now narrow) write gate.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS soe_select_manage ON public.student_optional_enrollments;
CREATE POLICY soe_select_manage ON public.student_optional_enrollments
  FOR SELECT TO authenticated
  USING (public.can_view_student_optional_choices((select auth.uid()), student_id));

-- Recreated unchanged in shape, but the helper underneath is now narrow.
DROP POLICY IF EXISTS soe_update_manage ON public.student_optional_enrollments;
CREATE POLICY soe_update_manage ON public.student_optional_enrollments
  FOR UPDATE TO authenticated
  USING (public.can_manage_student_optional_choices((select auth.uid()), student_id))
  WITH CHECK (public.can_manage_student_optional_choices((select auth.uid()), student_id));
