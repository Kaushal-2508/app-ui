-- Add is_universal flag to subjects table to distinguish global vs local subjects
ALTER TABLE public.subjects 
ADD COLUMN IF NOT EXISTS is_universal BOOLEAN NOT NULL DEFAULT false;

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_subjects_institution_universal 
ON public.subjects(institution_id, is_universal);

-- Comment for clarity
COMMENT ON COLUMN public.subjects.is_universal IS 'When false, this subject is school-specific and only visible to that institution. Universal subjects from universal_subjects table are separate.';