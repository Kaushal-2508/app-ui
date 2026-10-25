-- Revert the bucket-level upload caps from 70 MB → 50 MB. This is the
-- counterpart to migration 20260511000000 which raised them to 70 MB. The
-- project-wide platform cap is being moved back to 50 MiB at the same
-- time via config.toml [storage] file_size_limit, so the effective cap
-- for these buckets returns to where it was before the 70 MB experiment.
--
-- 50 MB = 50 * 1024 * 1024 = 52428800 bytes.

UPDATE storage.buckets
SET file_size_limit = 52428800
WHERE id IN ('study-materials', 'answer-sheets', 'exam-sheets');
