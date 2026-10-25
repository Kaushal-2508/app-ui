
-- Add SELECT policy for teachers to view all tasks in their institution
-- This is needed because teachers can create tasks (bidirectional task flow)
-- and need to see tasks they create or are assigned to

CREATE POLICY "Teachers can view all tasks in their institution"
ON public.tasks
FOR SELECT
TO authenticated
USING (has_role_at_institution(auth.uid(), 'teacher'::app_role, institution_id));
