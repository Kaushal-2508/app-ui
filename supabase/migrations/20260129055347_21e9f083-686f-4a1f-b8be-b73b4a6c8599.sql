-- Fix: Allow teachers (exam creators) to publish their own exams
-- The current policy only allows updates when status = 'draft', but publishing changes status to 'published'
-- This creates a race condition where the status update fails

-- Drop the overly restrictive policy
DROP POLICY IF EXISTS "Creators can update draft exams" ON exams;

-- Create a new policy that allows creators to update their exams 
-- (including publishing) but NOT after it's completed
CREATE POLICY "Creators can update own exams"
ON exams
FOR UPDATE
USING (
  created_by = auth.uid() 
  AND status NOT IN ('completed', 'archived')
)
WITH CHECK (
  created_by = auth.uid()
  AND status NOT IN ('completed', 'archived')
);

-- Also add INSERT policy for exam_publication_logs so teachers can log publications
CREATE POLICY "Exam creators can insert publication_logs"
ON exam_publication_logs
FOR INSERT
WITH CHECK (
  is_exam_creator(exam_id, auth.uid()) 
  AND actor_id = auth.uid()
);