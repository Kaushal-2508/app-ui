-- Fix: The previous policy had an ambiguous column reference inside the subquery.
-- ca.class_id = class_id resolved to ca.class_id = ca.class_id (always true).
-- Use class_assignments.class_id to reference the inserted row explicitly.

DROP POLICY IF EXISTS "Teachers can assign students to their classes" ON public.class_assignments;

CREATE POLICY "Teachers can assign students to their classes"
ON public.class_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  role = 'student'
  AND EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.class_id = class_assignments.class_id
      AND ca.user_id = auth.uid()
      AND ca.role = 'teacher'
  )
  AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
);
