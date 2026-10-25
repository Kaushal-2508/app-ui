-- =============================================================
-- HOTFIX: 42P17 infinite recursion on class_assignments INSERT
-- (2026-07-25, applied to prod ~10:35 IST; broken window was
-- ~09:40-10:30 IST while 20260714120000 was live unpatched).
--
-- INCIDENT. After 20260714120000_staff_manager_overrides.sql went
-- live, EVERY INSERT into class_assignments (admins, coordinators,
-- teachers assigning students - platform-wide, not just the override
-- user) failed with:
--   ERROR 42P17: infinite recursion detected in policy for relation
--   "class_assignments"
--
-- ROOT CAUSE (two ingredients, both required):
--   1. The pre-existing INSERT policy "Teachers can assign students
--      to their classes" carried an INLINE self-referential
--      EXISTS (SELECT 1 FROM class_assignments ...) in its WITH CHECK
--      - exactly the CLAUDE.md §22 recursion trap, dormant until now.
--   2. The new class_assignments_staff_manager_write policy was the
--      only policy on this table written in the scalar-subquery style
--      (SELECT fn(auth.uid())). Expanding that SubLink inside the
--      self-referential policy's re-entry of class_assignments trips
--      the planner's recursion detector. Every other policy on the
--      table uses bare SECURITY DEFINER function calls, which the
--      rewriter treats as opaque - which is why the trap never fired
--      before.
--
-- LESSON: the §23 "(select auth.uid())" initplan style is FORBIDDEN
-- on any table that still has a policy with an inline same-table
-- reference. Defuse the inline reference first (wrap in a SECURITY
-- DEFINER helper), or use bare function calls.
-- =============================================================

-- Fix 1 - restyle the override policy to bare SECURITY DEFINER calls
-- (semantics unchanged; matches every other policy on this table).
ALTER POLICY class_assignments_staff_manager_write ON public.class_assignments
  USING (
    public.is_staff_manager(auth.uid())
    AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  )
  WITH CHECK (
    public.is_staff_manager(auth.uid())
    AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  );

-- Fix 2 - defuse the dormant trap itself: replace the inline
-- self-referential EXISTS with the pre-existing SECURITY DEFINER helper
-- is_teacher_for_class(uuid, uuid), which is semantically identical
-- (EXISTS ca WHERE user_id AND class_id AND role = 'teacher').
ALTER POLICY "Teachers can assign students to their classes" ON public.class_assignments
  WITH CHECK (
    (role = 'student'::public.app_role)
    AND public.is_teacher_for_class(auth.uid(), class_id)
    AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  );

-- Verified on prod (all in rollback-protected blocks, no data changed):
--   * staff-manager user: full assign-dialog sequence (DELETE 13 rows ->
--     INSERT -> classes SELECT -> scgm UPSERT) - ok
--   * teacher assigning a student to their own class - ok
--   * school admin delete + insert - ok
