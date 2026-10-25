
-- Remove the incorrect mappings I just created for the orphaned subjects
-- We'll need to re-add them to only the correct classes

DELETE FROM subject_class_mappings 
WHERE subject_id IN (
  '39b23094-e2bd-4f3d-ad7c-fc38fcd3ad95',  -- Social science (Political Science)
  '50a02a08-8fac-45be-b59a-9b0aadb32f90'   -- Social Science (Economics)
);
