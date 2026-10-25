-- Phase 1: Database Schema Changes for Enhanced Exam Flow

-- 1.1 Create section_type enum for structured exam sections
DO $$ BEGIN
  CREATE TYPE section_type AS ENUM (
    'mcq',
    'true_false',
    'fill_blank',
    'short_answer',
    'long_answer',
    'matching',
    'comprehension',
    'case_study'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1.2 Add section_type column to exam_sections table
ALTER TABLE exam_sections 
ADD COLUMN IF NOT EXISTS section_type section_type DEFAULT 'mcq';

-- 1.3 Add default_marks and negative_marking columns to exam_sections
ALTER TABLE exam_sections 
ADD COLUMN IF NOT EXISTS default_marks numeric DEFAULT 1,
ADD COLUMN IF NOT EXISTS negative_marking numeric DEFAULT 0;

-- 1.4 Create school_custom_topics table for institution-specific topics
CREATE TABLE IF NOT EXISTS school_custom_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES universal_subjects(id) ON DELETE CASCADE,
  grade_level_id UUID NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  topic_name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(institution_id, subject_id, grade_level_id, topic_name)
);

-- 1.5 Enable RLS on school_custom_topics
ALTER TABLE school_custom_topics ENABLE ROW LEVEL SECURITY;

-- 1.6 RLS Policies for school_custom_topics (using valid roles only)
CREATE POLICY "Users can view their institution's custom topics"
ON school_custom_topics FOR SELECT
USING (
  institution_id IN (
    SELECT institution_id FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Teachers and above can create custom topics"
ON school_custom_topics FOR INSERT
WITH CHECK (
  institution_id IN (
    SELECT institution_id FROM profiles WHERE id = auth.uid()
  )
  AND auth.uid() IN (
    SELECT user_id FROM user_roles 
    WHERE role IN ('teacher', 'coordinator', 'school_admin', 'super_admin')
  )
);

CREATE POLICY "Teachers and above can update their institution's custom topics"
ON school_custom_topics FOR UPDATE
USING (
  institution_id IN (
    SELECT institution_id FROM profiles WHERE id = auth.uid()
  )
  AND auth.uid() IN (
    SELECT user_id FROM user_roles 
    WHERE role IN ('teacher', 'coordinator', 'school_admin', 'super_admin')
  )
);

-- 1.7 Create exam_topics junction table to link exams with selected topics
CREATE TABLE IF NOT EXISTS exam_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES syllabus_topics(id) ON DELETE CASCADE,
  custom_topic_id UUID REFERENCES school_custom_topics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT topic_reference_check CHECK (
    (topic_id IS NOT NULL AND custom_topic_id IS NULL) OR
    (topic_id IS NULL AND custom_topic_id IS NOT NULL)
  )
);

-- 1.8 Enable RLS on exam_topics
ALTER TABLE exam_topics ENABLE ROW LEVEL SECURITY;

-- 1.9 RLS Policies for exam_topics
CREATE POLICY "Users can view exam topics for their institution's exams"
ON exam_topics FOR SELECT
USING (
  exam_id IN (
    SELECT id FROM exams WHERE institution_id IN (
      SELECT institution_id FROM profiles WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "Exam creators can manage exam topics"
ON exam_topics FOR ALL
USING (
  exam_id IN (
    SELECT id FROM exams WHERE created_by = auth.uid()
  )
);

-- 1.10 Create index for better performance
CREATE INDEX IF NOT EXISTS idx_school_custom_topics_institution ON school_custom_topics(institution_id);
CREATE INDEX IF NOT EXISTS idx_school_custom_topics_subject ON school_custom_topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_school_custom_topics_grade ON school_custom_topics(grade_level_id);
CREATE INDEX IF NOT EXISTS idx_exam_topics_exam ON exam_topics(exam_id);

-- 1.11 Add trigger for updated_at on school_custom_topics
CREATE TRIGGER update_school_custom_topics_updated_at
BEFORE UPDATE ON school_custom_topics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();