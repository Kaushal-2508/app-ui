-- Step 1: Add grade_level_id column to universal_subjects (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'universal_subjects' 
                   AND column_name = 'grade_level_id') THEN
        ALTER TABLE public.universal_subjects 
        ADD COLUMN grade_level_id UUID REFERENCES public.grade_levels(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Step 2: Drop the old unique constraint on name (as constraint, not index)
ALTER TABLE public.universal_subjects DROP CONSTRAINT IF EXISTS universal_subjects_name_key;

-- Step 3: Create new composite unique constraint (grade + lowercase name)
DROP INDEX IF EXISTS universal_subjects_grade_name_unique;
CREATE UNIQUE INDEX universal_subjects_grade_name_unique 
ON public.universal_subjects(grade_level_id, LOWER(name));

-- Step 4: Create index for faster lookups by grade
DROP INDEX IF EXISTS idx_universal_subjects_grade_level;
CREATE INDEX idx_universal_subjects_grade_level 
ON public.universal_subjects(grade_level_id);

-- Step 5: Add index for faster grade-based topic lookups
DROP INDEX IF EXISTS idx_syllabus_topics_grade_subject;
CREATE INDEX idx_syllabus_topics_grade_subject 
ON public.syllabus_topics(grade_level_id, subject_id);