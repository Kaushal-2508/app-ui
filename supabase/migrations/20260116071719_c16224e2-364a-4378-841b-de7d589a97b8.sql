-- First, set orphaned subject_id values to NULL (where subject_id doesn't exist in universal_subjects)
UPDATE public.class_assignments
SET subject_id = NULL
WHERE subject_id IS NOT NULL 
  AND subject_id NOT IN (SELECT id FROM public.universal_subjects);

-- Drop old foreign key that references deprecated 'subjects' table
ALTER TABLE public.class_assignments 
DROP CONSTRAINT IF EXISTS class_assignments_subject_id_fkey;

-- Add new foreign key referencing 'universal_subjects' table
ALTER TABLE public.class_assignments
ADD CONSTRAINT class_assignments_subject_id_fkey 
FOREIGN KEY (subject_id) REFERENCES public.universal_subjects(id) ON DELETE SET NULL;

-- Add index for query performance
CREATE INDEX IF NOT EXISTS idx_class_assignments_subject_id 
ON public.class_assignments(subject_id);