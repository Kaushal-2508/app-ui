-- Migration: Allow teachers to INSERT student class assignments
-- Teachers can add students to classes they are assigned to as teachers.
-- The actual student user creation goes through the admin-operations edge function
-- which already permits teacher -> student creation. This policy covers the
-- client-side class_assignments INSERT that follows user creation.

-- Teachers can insert student assignments into classes they teach
DROP POLICY IF EXISTS "Teachers can assign students to their classes" ON public.class_assignments;

CREATE POLICY "Teachers can assign students to their classes"
ON public.class_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  -- The new row must be a student assignment
  role = 'student'
  -- The teacher must be assigned to the same class
  AND EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.class_id = class_assignments.class_id
      AND ca.user_id = auth.uid()
      AND ca.role = 'teacher'
  )
  -- The class must belong to the teacher's institution
  AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
);
