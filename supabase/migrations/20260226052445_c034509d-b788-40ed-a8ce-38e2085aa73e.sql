
-- Table: passport_academic_records
CREATE TABLE public.passport_academic_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  academic_year TEXT NOT NULL,
  class_name TEXT NOT NULL,
  section_name TEXT,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  total_exams INTEGER NOT NULL DEFAULT 0,
  exams_passed INTEGER NOT NULL DEFAULT 0,
  average_percentage DECIMAL NOT NULL DEFAULT 0,
  highest_percentage DECIMAL NOT NULL DEFAULT 0,
  total_points_earned INTEGER NOT NULL DEFAULT 0,
  badges_earned INTEGER NOT NULL DEFAULT 0,
  rank_in_class INTEGER,
  rank_in_institution INTEGER,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, academic_year)
);

-- Table: passport_subject_capabilities
CREATE TABLE public.passport_subject_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  subject_id UUID NOT NULL REFERENCES public.subjects(id),
  subject_name TEXT NOT NULL,
  total_exams INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  accuracy_percent DECIMAL NOT NULL DEFAULT 0,
  mastery_level INTEGER NOT NULL DEFAULT 0,
  capability_tier TEXT NOT NULL DEFAULT 'developing',
  strongest_topics TEXT[] DEFAULT '{}',
  weakest_topics TEXT[] DEFAULT '{}',
  year_wise_data JSONB NOT NULL DEFAULT '[]',
  last_exam_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, subject_id)
);

-- Enable RLS
ALTER TABLE public.passport_academic_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_subject_capabilities ENABLE ROW LEVEL SECURITY;

-- RLS: passport_academic_records
CREATE POLICY "Students can view own academic records"
  ON public.passport_academic_records FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "Staff can view academic records in their institution"
  ON public.passport_academic_records FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'teacher')
  );

CREATE POLICY "Authenticated users can insert academic records"
  ON public.passport_academic_records FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update academic records"
  ON public.passport_academic_records FOR UPDATE
  TO authenticated
  USING (true);

-- RLS: passport_subject_capabilities
CREATE POLICY "Students can view own subject capabilities"
  ON public.passport_subject_capabilities FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "Staff can view subject capabilities in their institution"
  ON public.passport_subject_capabilities FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'teacher')
  );

CREATE POLICY "Authenticated users can insert subject capabilities"
  ON public.passport_subject_capabilities FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update subject capabilities"
  ON public.passport_subject_capabilities FOR UPDATE
  TO authenticated
  USING (true);

-- Triggers for updated_at
CREATE TRIGGER update_passport_academic_records_updated_at
  BEFORE UPDATE ON public.passport_academic_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_passport_subject_capabilities_updated_at
  BEFORE UPDATE ON public.passport_subject_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_passport_academic_records_student ON public.passport_academic_records(student_id);
CREATE INDEX idx_passport_academic_records_institution ON public.passport_academic_records(institution_id);
CREATE INDEX idx_passport_subject_capabilities_student ON public.passport_subject_capabilities(student_id);
CREATE INDEX idx_passport_subject_capabilities_institution ON public.passport_subject_capabilities(institution_id);
