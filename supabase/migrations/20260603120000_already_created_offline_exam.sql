-- Already-Created offline exam (results upload)
-- Adds a marker flag + uploaded-paper references to exams, and makes the
-- (currently unused) exam-sheets bucket public so staff and students can
-- view uploaded papers via public URL.

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS is_results_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS source_paper_files JSONB;

COMMENT ON COLUMN public.exams.is_results_only IS
  'True for an already-conducted offline exam created via the results-upload flow (no questions; marks entered directly).';
COMMENT ON COLUMN public.exams.source_paper_files IS
  'Array of uploaded paper files: [{path,name,mime,size}] stored in the exam-sheets bucket. NULL when none.';

-- exam-sheets already accepts image/* + application/pdf at 52 MB; flip it public
-- so the uploaded question paper is viewable by staff and enrolled students.
UPDATE storage.buckets SET public = true WHERE id = 'exam-sheets';
