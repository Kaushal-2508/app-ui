-- Add topic_id column to study_materials table for hierarchical linking
ALTER TABLE public.study_materials 
ADD COLUMN topic_id UUID REFERENCES public.syllabus_topics(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_study_materials_topic_id ON public.study_materials(topic_id);

-- Add comment for documentation
COMMENT ON COLUMN public.study_materials.topic_id IS 'Optional link to specific topic within the subject';