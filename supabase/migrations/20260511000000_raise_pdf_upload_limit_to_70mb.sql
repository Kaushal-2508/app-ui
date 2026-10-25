-- Raise the PDF / file upload cap from 50 MB → 70 MB on every bucket that
-- accepts PDFs. The frontend validators in AddStudyMaterialDialog,
-- AddSchoolStudyMaterialDialog, AddMaterialToTopicDialog, and
-- LessonPlanDialogV2 were all hard-coded to 50 MB and have been bumped to
-- match. Storage-bucket caps are the hard ceiling Postgres enforces, so
-- both layers must move together — bumping just the client lets uploads
-- pass UI validation but get rejected by Storage.
--
-- 70 MB = 70 * 1024 * 1024 = 73400320 bytes.
--
-- The `study-materials` bucket was originally created without an explicit
-- file_size_limit (so it inherited the project-wide default ~50 MB). We
-- now set it explicitly to 70 MB. The `answer-sheets` and `exam-sheets`
-- buckets were created with 52428800 bytes (50 MB) and are bumped to
-- 73400320 (70 MB) to match.

UPDATE storage.buckets
SET file_size_limit = 73400320
WHERE id IN ('study-materials', 'answer-sheets', 'exam-sheets');
