-- Dashboard rebuild Phase 1 — Task 1
-- exams.exam_type: term | unit | weekly | unspecified (default). Additive, backfills existing rows.

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS exam_type text NOT NULL DEFAULT 'unspecified';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exams_exam_type_check') THEN
    ALTER TABLE public.exams
      ADD CONSTRAINT exams_exam_type_check CHECK (exam_type IN ('term','unit','weekly','unspecified'));
  END IF;
END $$;

UPDATE public.exams SET exam_type = 'unspecified' WHERE exam_type IS NULL;
