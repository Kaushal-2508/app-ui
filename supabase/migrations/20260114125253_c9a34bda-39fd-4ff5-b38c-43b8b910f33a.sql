-- Make institution_id nullable to allow global study materials
ALTER TABLE study_materials 
ALTER COLUMN institution_id DROP NOT NULL;

-- Add a comment to clarify the meaning
COMMENT ON COLUMN study_materials.institution_id IS 'NULL means global material accessible to all institutions';