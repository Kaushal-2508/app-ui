-- Create proctoring-screenshots bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('proctoring-screenshots', 'proctoring-screenshots', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policy for INSERT - Teachers and above can upload proctoring screenshots
CREATE POLICY "Authorized users can upload proctoring screenshots"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'proctoring-screenshots' AND
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('teacher'::public.app_role, 'coordinator'::public.app_role, 'school_admin'::public.app_role, 'super_admin'::public.app_role)
  )
);

-- RLS policy for SELECT - Teachers and above can view proctoring screenshots  
CREATE POLICY "Authorized users can view proctoring screenshots"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'proctoring-screenshots' AND
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('teacher'::public.app_role, 'coordinator'::public.app_role, 'school_admin'::public.app_role, 'super_admin'::public.app_role)
  )
);

-- RLS policy for DELETE - Teachers and above can delete proctoring screenshots
CREATE POLICY "Authorized users can delete proctoring screenshots"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'proctoring-screenshots' AND
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('teacher'::public.app_role, 'coordinator'::public.app_role, 'school_admin'::public.app_role, 'super_admin'::public.app_role)
  )
);