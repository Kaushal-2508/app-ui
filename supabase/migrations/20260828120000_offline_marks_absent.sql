-- Explicit "Absent" for offline / results-upload marks entry.
--
-- Until now a student who did not sit the exam was left BLANK, which is
-- indistinguishable from "the teacher has not entered this mark yet". That
-- ambiguity reaches the academic record: the results-only pipeline simply never
-- published the student, and the section pipeline (which already had an Absent
-- toggle) published absence as a plain 0, indistinguishable from a genuine zero.
--
-- After this migration both offline pipelines record absence explicitly, and
-- final_results carries the flag so the published record is unambiguous.

-- 1. Results-only pipeline: offline_student_marks / src/hooks/useOfflineMarks.ts
ALTER TABLE public.offline_student_marks
  ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT FALSE;

-- An absent student has no mark at all. Storing 0 here would recreate exactly
-- the ambiguity this migration removes, so the two states are mutually
-- exclusive at the database level rather than by client convention.
ALTER TABLE public.offline_student_marks
  DROP CONSTRAINT IF EXISTS offline_student_marks_absent_has_no_mark;
ALTER TABLE public.offline_student_marks
  ADD CONSTRAINT offline_student_marks_absent_has_no_mark
  CHECK (NOT is_absent OR marks_obtained IS NULL);

COMMENT ON COLUMN public.offline_student_marks.is_absent IS
  'Teacher explicitly marked the student absent. Mutually exclusive with marks_obtained; a NULL mark with is_absent = false still means "not entered yet".';

-- 2. The published academic record. Both offline pipelines publish through
--    final_results, and neither could express absence before this.
ALTER TABLE public.final_results
  ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.final_results.is_absent IS
  'Student did not sit the exam. total_marks_obtained is 0 and percentage (a GENERATED column) therefore computes to 0 - read this flag before presenting either as a score.';

-- No new foreign keys, so no accompanying index is required (CLAUDE.md 23).
-- is_absent is deliberately not indexed: it is a low-cardinality display flag
-- read alongside rows already selected by exam/attempt, never a filter driver.
