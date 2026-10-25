-- Add policy for students to view their own proctoring sessions
CREATE POLICY "Students can view own proctoring session"
ON public.proctoring_sessions
FOR SELECT
USING (get_attempt_student_id(attempt_id) = auth.uid());

-- Add policy for students to view their own proctoring events
CREATE POLICY "Students can view own proctoring events"
ON public.proctoring_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM proctoring_sessions ps
    WHERE ps.id = proctoring_events.session_id
    AND get_attempt_student_id(ps.attempt_id) = auth.uid()
  )
);