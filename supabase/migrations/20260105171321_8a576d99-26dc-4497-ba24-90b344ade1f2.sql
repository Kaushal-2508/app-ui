-- Change 12: Add 'general' to task_type enum
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'general';

-- Change 11: Create user_question_limits table for per-user AI generation limits
CREATE TABLE IF NOT EXISTS user_question_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  daily_limit INTEGER DEFAULT 50,
  questions_used_today INTEGER DEFAULT 0,
  last_reset_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS on user_question_limits
ALTER TABLE user_question_limits ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_question_limits
CREATE POLICY "Super admins can manage all user limits"
ON user_question_limits
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'super_admin'
  )
);

CREATE POLICY "School admins can view their institution limits"
ON user_question_limits
FOR SELECT
USING (
  institution_id IN (
    SELECT institution_id FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can view their own limits"
ON user_question_limits
FOR SELECT
USING (user_id = auth.uid());

-- Change 13: Create question_bank table
CREATE TABLE IF NOT EXISTS question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES universal_subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES syllabus_topics(id) ON DELETE SET NULL,
  grade_level_id UUID REFERENCES grade_levels(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  question_type question_type NOT NULL DEFAULT 'mcq',
  options JSONB,
  correct_answer TEXT,
  explanation TEXT,
  marks INTEGER DEFAULT 1,
  difficulty_level INTEGER DEFAULT 3 CHECK (difficulty_level BETWEEN 1 AND 5),
  tags TEXT[] DEFAULT '{}',
  is_approved BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on question_bank
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

-- RLS policies for question_bank
CREATE POLICY "Super admins can manage all questions"
ON question_bank
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'super_admin'
  )
);

CREATE POLICY "Teachers can view approved questions in their institution"
ON question_bank
FOR SELECT
USING (
  is_approved = TRUE
  AND institution_id IN (
    SELECT institution_id FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Teachers can manage their own questions"
ON question_bank
FOR ALL
USING (created_by = auth.uid());

-- Create indexes for question_bank
CREATE INDEX IF NOT EXISTS idx_question_bank_institution ON question_bank(institution_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_subject ON question_bank(subject_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_topic ON question_bank(topic_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_type ON question_bank(question_type);
CREATE INDEX IF NOT EXISTS idx_question_bank_grade ON question_bank(grade_level_id);

-- Change 10: Create storage bucket for exam sheets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exam-sheets', 
  'exam-sheets', 
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for exam-sheets bucket (using valid roles only)
CREATE POLICY "Staff can upload exam sheets"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'exam-sheets'
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role IN ('teacher', 'school_admin', 'coordinator', 'super_admin')
  )
);

CREATE POLICY "Staff can view exam sheets"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'exam-sheets'
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role IN ('teacher', 'school_admin', 'coordinator', 'super_admin')
  )
);

CREATE POLICY "Staff can update exam sheets"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'exam-sheets'
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role IN ('teacher', 'school_admin', 'coordinator', 'super_admin')
  )
);

CREATE POLICY "Staff can delete exam sheets"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'exam-sheets'
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role IN ('teacher', 'school_admin', 'coordinator', 'super_admin')
  )
);

-- Trigger to update updated_at on user_question_limits
CREATE OR REPLACE TRIGGER update_user_question_limits_updated_at
BEFORE UPDATE ON user_question_limits
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to update updated_at on question_bank
CREATE OR REPLACE TRIGGER update_question_bank_updated_at
BEFORE UPDATE ON question_bank
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();