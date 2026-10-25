-- Phase 1: Institution logo management.
-- Adds a nullable logo_url column on institutions and provisions a storage
-- bucket for the uploaded files. Public read so any frontend surface can
-- render the logo without auth headers; super_admin only on writes.

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('institution-logos', 'institution-logos', true, 2097152) -- 2 MB
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "view_institution_logos" ON storage.objects;
CREATE POLICY "view_institution_logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'institution-logos');

DROP POLICY IF EXISTS "upload_institution_logos" ON storage.objects;
CREATE POLICY "upload_institution_logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'institution-logos'
    AND has_role(auth.uid(), 'super_admin'::app_role)
  );

DROP POLICY IF EXISTS "update_institution_logos" ON storage.objects;
CREATE POLICY "update_institution_logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'institution-logos'
    AND has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    bucket_id = 'institution-logos'
    AND has_role(auth.uid(), 'super_admin'::app_role)
  );

DROP POLICY IF EXISTS "delete_institution_logos" ON storage.objects;
CREATE POLICY "delete_institution_logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'institution-logos'
    AND has_role(auth.uid(), 'super_admin'::app_role)
  );
