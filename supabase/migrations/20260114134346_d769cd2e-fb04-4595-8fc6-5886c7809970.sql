-- Drop the old foreign key constraint that references the old subjects table
ALTER TABLE study_materials 
DROP CONSTRAINT IF EXISTS study_materials_subject_id_fkey;

-- Add new foreign key constraint referencing universal_subjects table
ALTER TABLE study_materials 
ADD CONSTRAINT study_materials_subject_id_fkey 
FOREIGN KEY (subject_id) REFERENCES universal_subjects(id) ON DELETE SET NULL;