
-- Fix orphaned institute subjects by mapping them to all classes in their institution
-- This ensures subjects created in the institute repository are visible

-- First, insert mappings for "Social science (Political Science)" to all Alliance classes
INSERT INTO subject_class_mappings (institution_id, class_id, subject_id)
SELECT 
  '8af718c6-ca11-482b-9d6b-832f2b767928' as institution_id,
  c.id as class_id,
  '39b23094-e2bd-4f3d-ad7c-fc38fcd3ad95' as subject_id
FROM classes c
WHERE c.institution_id = '8af718c6-ca11-482b-9d6b-832f2b767928'
  AND c.is_active = true
ON CONFLICT (class_id, subject_id) DO NOTHING;

-- Insert mappings for "Social Science (Economics)" to all Alliance classes
INSERT INTO subject_class_mappings (institution_id, class_id, subject_id)
SELECT 
  '8af718c6-ca11-482b-9d6b-832f2b767928' as institution_id,
  c.id as class_id,
  '50a02a08-8fac-45be-b59a-9b0aadb32f90' as subject_id
FROM classes c
WHERE c.institution_id = '8af718c6-ca11-482b-9d6b-832f2b767928'
  AND c.is_active = true
ON CONFLICT (class_id, subject_id) DO NOTHING;
