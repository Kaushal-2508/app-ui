-- Fix exam_templates.subject_id FK: was referencing `subjects` (unused table),
-- should reference `universal_subjects` which is where the app stores subjects.
ALTER TABLE public.exam_templates
  DROP CONSTRAINT IF EXISTS exam_templates_subject_id_fkey;

ALTER TABLE public.exam_templates
  ADD CONSTRAINT exam_templates_subject_id_fkey
  FOREIGN KEY (subject_id) REFERENCES public.universal_subjects(id) ON DELETE SET NULL;
