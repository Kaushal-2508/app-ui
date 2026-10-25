
-- Add RLS policy for teachers and coordinators to insert into subjects table
CREATE POLICY "Teachers and coordinators can create local subjects"
ON public.subjects FOR INSERT
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND (
    public.has_role(auth.uid(), 'teacher') 
    OR public.has_role(auth.uid(), 'coordinator')
  )
  AND is_universal = false
);

-- Add universal_subject_id column to link local subjects to universal ones
ALTER TABLE public.subjects
ADD COLUMN IF NOT EXISTS universal_subject_id UUID REFERENCES public.universal_subjects(id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_subjects_universal_id 
ON public.subjects(universal_subject_id);

-- Add unique constraint to prevent duplicate universal subject links per institution
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_institution_universal_unique
ON public.subjects(institution_id, universal_subject_id) 
WHERE universal_subject_id IS NOT NULL;
