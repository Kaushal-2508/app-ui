-- Storage bucket for task evidence file uploads (TMS).
-- Public so that anyone with the URL can view the file (EvidenceSection renders <a href>).
-- Authenticated users can upload, owners can update/delete their own files.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('task-evidence', 'task-evidence', true, 26214400) -- 25 MB
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "upload_task_evidence" ON storage.objects;
CREATE POLICY "upload_task_evidence"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'task-evidence' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "view_task_evidence" ON storage.objects;
CREATE POLICY "view_task_evidence"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'task-evidence');

DROP POLICY IF EXISTS "update_own_task_evidence" ON storage.objects;
CREATE POLICY "update_own_task_evidence"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'task-evidence' AND auth.uid() = owner)
  WITH CHECK (bucket_id = 'task-evidence' AND auth.uid() = owner);

DROP POLICY IF EXISTS "delete_own_task_evidence" ON storage.objects;
CREATE POLICY "delete_own_task_evidence"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'task-evidence' AND auth.uid() = owner);
