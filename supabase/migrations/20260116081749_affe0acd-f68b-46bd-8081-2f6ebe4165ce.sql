-- Add INSERT policy for teachers to create student exam attempts for their assigned classes
CREATE POLICY "Teachers can insert attempts for assigned classes"
ON public.student_exam_attempts
FOR INSERT
WITH CHECK (
  is_assigned_to_class(auth.uid(), class_id) 
  AND (has_role(auth.uid(), 'teacher'::app_role) OR has_role(auth.uid(), 'coordinator'::app_role))
);