-- Allow students to view their own exam attempts
CREATE POLICY "Students can view their own attempts"
ON public.student_exam_attempts
FOR SELECT
TO public
USING (
  student_id = auth.uid()
);