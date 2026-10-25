-- question-images bucket: size and type limits.
--
-- APPLIED TO PROD 2026-09-07 via scripts/run-sql.ps1; verified file_size_limit = 2097152,
-- allowed_mime_types = {image/jpeg,image/png,image/webp}. Do not edit; write a new file.
--
-- The bucket has been public with NO file_size_limit and NO allowed_mime_types
-- since 20260226051248. Since 2026-09-04 the teacher client stores question and
-- option diagrams at up to 2000px / JPEG q0.9, and the only thing bounding what
-- 5,000 students then download per option is compressorjs running in that
-- teacher's browser. Any client that skips it (an old cached build, a browser
-- where canvas encoding fails, a script) can store a multi-megabyte object that
-- the exam grid fans out to every student.
--
-- 2 MB is above anything the current pipeline emits (a 2000px q0.9 JPEG is
-- ~0.3-1.1 MB) and below anything a phone should be asked to load mid-exam.
-- Existing objects are untouched; the limit applies to new uploads only.
UPDATE storage.buckets
SET file_size_limit   = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'question-images';

-- Verify:
--   SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'question-images';
--   -- 2097152, {image/jpeg,image/png,image/webp}
