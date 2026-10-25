-- Fix: Change subject_class_mappings FK to reference universal_subjects instead of subjects
-- This allows the Institution Wizard to correctly create subject-class mappings

-- Step 1: Drop the old foreign key constraint
ALTER TABLE public.subject_class_mappings 
DROP CONSTRAINT IF EXISTS subject_class_mappings_subject_id_fkey;

-- Step 2: Add new foreign key referencing universal_subjects
ALTER TABLE public.subject_class_mappings 
ADD CONSTRAINT subject_class_mappings_subject_id_fkey 
FOREIGN KEY (subject_id) REFERENCES public.universal_subjects(id) ON DELETE CASCADE;