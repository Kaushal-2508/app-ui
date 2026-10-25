-- Allow students to view sibling sections inside their own class_group.
--
-- Why
--   The "Students can view their assigned classes" SELECT policy only
--   matches a row in `classes` when the student has a class_assignments
--   row pointing at that exact class. So a student assigned to
--   "Class 9 - A" can read just that one row — they cannot read sibling
--   sections like "Class 9 - B" even though the two share a class_group
--   and the same syllabus.
--
--   That breaks the Study Materials hook (`useIsolatedStudyMaterials`).
--   `study_materials.grade_level_id` is overloaded in this codebase —
--   admins sometimes upload a material with grade_level_id = grade UUID
--   (the canonical Class 9 tag) and sometimes with grade_level_id = the
--   SECTION UUID they happened to be in (observed for Alliance Class 9:
--   7 of 9 English Reader PDFs are tagged to Class 9 - B's section UUID,
--   only 2 to Class 9 - A's). A Class 9 - A student must be able to
--   read Class 9 - B's id to filter materials by it.
--
-- Why a SECURITY DEFINER helper (and not an inline subquery in the
-- policy)
--   An earlier attempt put the inner `SELECT class_group_id FROM classes
--   WHERE … class_assignments …` directly into the policy's USING
--   clause. The planner re-enters every applicable policy on `classes`
--   when evaluating the inner reference, including this same new one,
--   producing the well-known 42P17 infinite-recursion error and broke
--   reads for ALL roles (admin syllabus page came back with zero
--   grades/subjects/chapters). The §22 RLS-recursion trap describes
--   this exact pattern — the canonical fix is to wrap the cross-table
--   check in a SECURITY DEFINER helper that bypasses RLS internally.
--
-- Recursion safety
--   `get_student_class_group_ids` is SECURITY DEFINER and walks
--   `classes` and `class_assignments` directly — no RLS evaluation,
--   no recursion. The policy itself only references the helper plus
--   the row's own column.
--
-- Scope
--   `coordinator`, `teacher`, `school_admin`, `super_school_admin`,
--   `super_admin` already have policies that grant read access to
--   institution-wide or wing-wide classes; this policy only adds the
--   missing student case.

-- 1. SECURITY DEFINER helper returning the class_group_ids a student
--    is assigned to. Bypasses RLS so it can join classes ↔
--    class_assignments without re-entering the policy on `classes`.
CREATE OR REPLACE FUNCTION public.get_student_class_group_ids(p_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT DISTINCT c.class_group_id
  FROM public.classes c
  JOIN public.class_assignments ca
    ON ca.class_id = c.id
  WHERE ca.user_id = p_user_id
    AND ca.role = 'student'::public.app_role
    AND c.class_group_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_class_group_ids(UUID)
  TO authenticated;

COMMENT ON FUNCTION public.get_student_class_group_ids(UUID) IS
  'Returns the class_group_ids the given student is assigned to. SECURITY DEFINER so it can be called from RLS policies on classes without recursion. Used by the "Students can view sibling classes in their class_group" policy.';

-- 2. The new policy. Uses the helper, no inline cross-table query.
DROP POLICY IF EXISTS "Students can view sibling classes in their class_group"
  ON public.classes;

CREATE POLICY "Students can view sibling classes in their class_group"
  ON public.classes
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'student'::public.app_role)
    AND class_group_id IS NOT NULL
    AND class_group_id IN (
      SELECT public.get_student_class_group_ids(auth.uid())
    )
  );

COMMENT ON POLICY "Students can view sibling classes in their class_group"
  ON public.classes IS
  'Students can read every class that shares a class_group with one of their student assignments. Required by useIsolatedStudyMaterials so the study-materials hook can resolve sibling section UUIDs and accept materials tagged to grade_level_id = any section in the same class_group. See migration 20260513120000.';
