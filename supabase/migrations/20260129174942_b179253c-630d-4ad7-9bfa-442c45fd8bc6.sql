
-- Create missing subject_class_mappings from existing class_assignments
-- This ensures subjects assigned to teachers are properly mapped to their classes

INSERT INTO subject_class_mappings (institution_id, class_id, subject_id)
SELECT DISTINCT
  c.institution_id,
  ca.class_id,
  ca.subject_id
FROM class_assignments ca
JOIN classes c ON c.id = ca.class_id
WHERE ca.subject_id IS NOT NULL
  AND c.institution_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM subject_class_mappings scm
    WHERE scm.class_id = ca.class_id 
    AND scm.subject_id = ca.subject_id
  )
ON CONFLICT (class_id, subject_id) DO NOTHING;
