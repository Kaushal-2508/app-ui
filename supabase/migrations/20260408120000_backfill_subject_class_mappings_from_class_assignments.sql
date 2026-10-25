-- Backfill subject_class_mappings from class_assignments.
--
-- Background: AssignTeacherClassSubjectDialog used to insert teacher (class, subject)
-- pairs ONLY into class_assignments. The canonical (class_id, subject_id) mapping
-- table subject_class_mappings was never written, which broke any reader that pivots
-- through it (useClassSubjects, syllabus, study materials, admin exam creation, etc.).
--
-- The dialog now mirrors writes into subject_class_mappings going forward; this
-- migration patches up any historical rows so existing teacher assignments become
-- visible to those readers without requiring a manual re-save.

INSERT INTO public.subject_class_mappings (institution_id, class_id, subject_id)
SELECT DISTINCT
  c.institution_id,
  ca.class_id,
  ca.subject_id
FROM public.class_assignments ca
JOIN public.classes c ON c.id = ca.class_id
WHERE ca.role = 'teacher'
  AND ca.subject_id IS NOT NULL
  AND c.institution_id IS NOT NULL
ON CONFLICT (class_id, subject_id) DO NOTHING;
