-- 20260525130000_fix_passport_subject_capabilities_fk.sql
--
-- passport_subject_capabilities.subject_id was wired to the legacy `subjects`
-- table. The codebase has long since standardized on `universal_subjects` (see
-- CLAUDE.md §1 Command Center notes, and the analogous fix for exam_templates
-- in 20260410120000_fix_exam_templates_subject_fk.sql). The FK mismatch caused
-- snapshot-student-passport to fail with 23503 for any student whose attempts
-- referenced a universal-subject id (= every student that has taken an exam in
-- the new flow). Verified 0 stale rows in production before swapping.
--
-- Idempotent: DROP IF EXISTS the old constraint, recreate against
-- universal_subjects with ON DELETE SET NULL (subjects can be re-created so
-- losing the FK target shouldn't blow away a student's historical capability
-- row).

BEGIN;

ALTER TABLE public.passport_subject_capabilities
  DROP CONSTRAINT IF EXISTS passport_subject_capabilities_subject_id_fkey;

ALTER TABLE public.passport_subject_capabilities
  ADD CONSTRAINT passport_subject_capabilities_subject_id_fkey
  FOREIGN KEY (subject_id)
  REFERENCES public.universal_subjects(id)
  ON DELETE SET NULL;

COMMIT;
