-- Drop the old foreign key that references the empty 'subjects' table
ALTER TABLE public.exam_subjects 
DROP CONSTRAINT IF EXISTS exam_subjects_subject_id_fkey;

-- Add new foreign key referencing 'universal_subjects' table
ALTER TABLE public.exam_subjects 
ADD CONSTRAINT exam_subjects_subject_id_fkey 
FOREIGN KEY (subject_id) 
REFERENCES public.universal_subjects(id) 
ON DELETE CASCADE;