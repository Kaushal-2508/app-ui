-- Create grade_subject_assignments junction table
CREATE TABLE public.grade_subject_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_level_id UUID NOT NULL REFERENCES public.grade_levels(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(grade_level_id, subject_id)
);

-- Enable RLS
ALTER TABLE public.grade_subject_assignments ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to read
CREATE POLICY "Allow authenticated read" ON public.grade_subject_assignments
  FOR SELECT TO authenticated USING (true);

-- Create policy for authenticated users to insert/update/delete
CREATE POLICY "Allow authenticated write" ON public.grade_subject_assignments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX idx_grade_subject_assignments_grade ON public.grade_subject_assignments(grade_level_id);
CREATE INDEX idx_grade_subject_assignments_subject ON public.grade_subject_assignments(subject_id);

-- Auto-populate based on existing topics
INSERT INTO public.grade_subject_assignments (grade_level_id, subject_id)
SELECT DISTINCT grade_level_id, subject_id 
FROM public.syllabus_topics 
WHERE is_active = true AND grade_level_id IS NOT NULL AND subject_id IS NOT NULL
ON CONFLICT DO NOTHING;