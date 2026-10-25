-- Universal Syllabus Directory (Super Admin managed, separate from institution subjects)

-- Grade/Standard levels
CREATE TABLE public.grade_levels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  grade_number INTEGER NOT NULL,
  grade_name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(grade_number)
);

-- Universal Subjects (master list)
CREATE TABLE public.universal_subjects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_hindi TEXT,
  code TEXT,
  category TEXT CHECK (category IN ('core', 'elective', 'language', 'vocational')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(name)
);

-- Universal Topics Directory
CREATE TABLE public.syllabus_topics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  grade_level_id UUID NOT NULL REFERENCES public.grade_levels(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_name TEXT NOT NULL,
  topic_name_hindi TEXT,
  sub_topics JSONB DEFAULT '[]',
  learning_outcomes JSONB DEFAULT '[]',
  difficulty_level TEXT CHECK (difficulty_level IN ('easy', 'medium', 'hard', 'mixed')),
  expected_hours DECIMAL(4,1),
  chapter_number INTEGER,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  nep_aligned BOOLEAN DEFAULT false,
  cbse_aligned BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(grade_level_id, subject_id, topic_name)
);

-- Enable RLS
ALTER TABLE public.universal_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_topics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Super admins can manage universal subjects"
  ON public.universal_subjects FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "Everyone can view universal subjects"
  ON public.universal_subjects FOR SELECT
  USING (is_active = true);

CREATE POLICY "Super admins can manage grade levels"
  ON public.grade_levels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "Everyone can view grade levels"
  ON public.grade_levels FOR SELECT
  USING (is_active = true);

CREATE POLICY "Super admins can manage syllabus topics"
  ON public.syllabus_topics FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "Everyone can view syllabus topics"
  ON public.syllabus_topics FOR SELECT
  USING (is_active = true);

-- Insert grade levels (3-12)
INSERT INTO public.grade_levels (grade_number, grade_name, display_order) VALUES
  (3, 'Class 3', 3),
  (4, 'Class 4', 4),
  (5, 'Class 5', 5),
  (6, 'Class 6', 6),
  (7, 'Class 7', 7),
  (8, 'Class 8', 8),
  (9, 'Class 9', 9),
  (10, 'Class 10', 10),
  (11, 'Class 11', 11),
  (12, 'Class 12', 12);

-- Insert all subjects from syllabus
INSERT INTO public.universal_subjects (name, category, display_order) VALUES
  ('English – Literature', 'language', 1),
  ('English – Grammar & Writing Skills', 'language', 2),
  ('English Core', 'language', 3),
  ('English – Grammar', 'language', 4),
  ('English – Grammar & Composition', 'language', 5),
  ('Hindi – साहित्य', 'language', 6),
  ('Hindi – व्याकरण', 'language', 7),
  ('Mathematics', 'core', 8),
  ('Applied Mathematics', 'elective', 9),
  ('Science', 'core', 10),
  ('Environmental Studies', 'core', 11),
  ('EVS', 'core', 12),
  ('History', 'core', 13),
  ('Geography', 'core', 14),
  ('Civics', 'core', 15),
  ('Political Science', 'core', 16),
  ('Political Science / Civics', 'core', 17),
  ('Economics', 'core', 18),
  ('Computer Science', 'elective', 19),
  ('Informatics Practices', 'elective', 20),
  ('General Knowledge', 'elective', 21),
  ('Social Science – History', 'core', 22),
  ('Social Science – Geography', 'core', 23),
  ('Social Science – Civics', 'core', 24),
  ('Physics', 'core', 25),
  ('Chemistry', 'core', 26),
  ('Biology', 'core', 27),
  ('Accountancy', 'elective', 28),
  ('Business Studies', 'elective', 29),
  ('Entrepreneurship', 'elective', 30),
  ('Legal Studies', 'elective', 31),
  ('Physical Education', 'elective', 32),
  ('Psychology', 'elective', 33),
  ('Biotechnology', 'elective', 34),
  ('Economics (Statistics + Micro)', 'elective', 35),
  ('Economics (Micro + Macro)', 'elective', 36);

-- Indexes
CREATE INDEX idx_syllabus_topics_grade ON public.syllabus_topics(grade_level_id);
CREATE INDEX idx_syllabus_topics_subject ON public.syllabus_topics(subject_id);
CREATE INDEX idx_syllabus_topics_search ON public.syllabus_topics USING gin(to_tsvector('english', topic_name));

-- Triggers
CREATE TRIGGER update_universal_subjects_updated_at
  BEFORE UPDATE ON public.universal_subjects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_syllabus_topics_updated_at
  BEFORE UPDATE ON public.syllabus_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();