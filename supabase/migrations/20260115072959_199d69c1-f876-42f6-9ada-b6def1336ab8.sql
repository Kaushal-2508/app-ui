-- Allow students to view their assigned classes
-- This fixes the issue where exams don't appear for students because
-- the student_eligible_exams view joins the classes table which had no student SELECT policy

CREATE POLICY "Students can view their assigned classes"
ON public.classes
FOR SELECT
TO public
USING (
  has_role(auth.uid(), 'student'::app_role)
  AND EXISTS (
    SELECT 1 FROM class_assignments ca
    WHERE ca.class_id = classes.id
    AND ca.user_id = auth.uid()
    AND ca.role = 'student'
  )
);