
DROP POLICY IF EXISTS "School admins can delete institution topics" ON public.syllabus_topics;

CREATE POLICY "Institution staff can delete institution topics"
ON public.syllabus_topics
FOR DELETE
TO authenticated
USING (
  institution_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('school_admin', 'super_school_admin', 'teacher', 'coordinator')
  )
  AND institution_id IN (
    SELECT institution_id FROM public.profiles WHERE id = auth.uid()
  )
);
