-- =====================================================================
-- Homework & Assignment — Phase 1: private storage bucket
-- Teacher attachments + student submission files. Cross-user reads are
-- served via service-role signed URLs in later phases; direct object
-- access is owner-only.
-- =====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'homework-files',
  'homework-files',
  false,
  10485760, -- 10 MB
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/rtf','text/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "homework_files_insert" ON storage.objects;
CREATE POLICY "homework_files_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'homework-files' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "homework_files_select_own" ON storage.objects;
CREATE POLICY "homework_files_select_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'homework-files' AND auth.uid() = owner);

DROP POLICY IF EXISTS "homework_files_update_own" ON storage.objects;
CREATE POLICY "homework_files_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'homework-files' AND auth.uid() = owner)
  WITH CHECK (bucket_id = 'homework-files' AND auth.uid() = owner);

DROP POLICY IF EXISTS "homework_files_delete_own" ON storage.objects;
CREATE POLICY "homework_files_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'homework-files' AND auth.uid() = owner);
