-- Step 1: Create mappings for all unmapped institute subjects to all classes in their respective institutions
-- This one-time migration restores visibility of legacy subjects that were created before class-scoping was implemented

INSERT INTO subject_class_mappings (class_id, subject_id, institution_id)
SELECT DISTINCT 
  c.id as class_id,
  us.id as subject_id,
  us.institution_id
FROM universal_subjects us
CROSS JOIN classes c
WHERE us.institution_id IS NOT NULL
  AND us.is_active = true
  AND c.institution_id = us.institution_id
  AND c.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM subject_class_mappings scm 
    WHERE scm.subject_id = us.id
  )
ON CONFLICT DO NOTHING;