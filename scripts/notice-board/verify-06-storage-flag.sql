SELECT
  EXISTS (SELECT 1 FROM storage.buckets WHERE id='notice-attachments')          AS ok_bucket_exists,
  (SELECT NOT public FROM storage.buckets WHERE id='notice-attachments')        AS ok_bucket_private,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname LIKE 'notice_attachments_%') = 3                          AS ok_three_storage_policies,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notices'
       AND column_name='attachment_urls') = 0                                   AS ok_legacy_col_dropped,
  (SELECT count(*) FROM public.notices n
     WHERE jsonb_typeof(n.attachments) <> 'array') = 0                          AS ok_attachments_all_arrays,
  (SELECT count(*) FROM public.notices n, jsonb_array_elements(n.attachments) e
    WHERE e ? 'legacy_url') = 1                                                 AS ok_one_legacy_attachment,
  (SELECT count(*) FROM public.institution_features
     WHERE feature_id='notice_board') = 12                                      AS ok_flag_renamed,
  (SELECT count(*) FROM public.institution_features
     WHERE feature_id='circulars') = 0                                          AS ok_old_flag_gone,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id='circular-attachments')        AS ok_old_bucket_kept;
