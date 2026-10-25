-- RLS policies for proctoring-screenshots bucket
CREATE POLICY "Teachers can view proctoring screenshots"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'proctoring-screenshots'
  AND (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.proctoring_sessions ps
      JOIN public.student_exam_attempts sea ON sea.id = ps.attempt_id
      JOIN public.class_assignments ca ON ca.class_id = sea.class_id
      WHERE ca.user_id = auth.uid()
      AND ca.role IN ('teacher', 'coordinator')
      AND (storage.foldername(name))[1] = ps.id::text
    )
  )
);

CREATE POLICY "System can upload proctoring screenshots"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'proctoring-screenshots'
  AND auth.uid() IS NOT NULL
);