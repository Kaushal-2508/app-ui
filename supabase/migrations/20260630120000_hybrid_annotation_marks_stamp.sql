-- Allow the teacher "Marks stamp" annotation type: a badge stamped on the
-- answer sheet showing "Q1 · 0.5/1" (question number + awarded/max), placed
-- from the marking toolbar. Rendered on both the teacher evaluation view and
-- the student's marked-sheet result view.
ALTER TABLE public.hybrid_sheet_annotations
  DROP CONSTRAINT IF EXISTS hybrid_sheet_annotations_annotation_type_check;

ALTER TABLE public.hybrid_sheet_annotations
  ADD CONSTRAINT hybrid_sheet_annotations_annotation_type_check
  CHECK (annotation_type IN (
    'highlight', 'tick', 'cross', 'comment', 'freehand', 'marks_stamp'
  ));
