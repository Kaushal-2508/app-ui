-- =====================================================
-- PHASE 1: CONCEPT MASTERY AND LEARNING ACTIONS FOUNDATION
-- =====================================================

-- Concept Mastery: Tracks per-student mastery of each topic
CREATE TABLE public.concept_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  mastery_level INTEGER DEFAULT 0 CHECK (mastery_level BETWEEN 0 AND 100),
  total_questions_attempted INTEGER DEFAULT 0,
  total_questions_correct INTEGER DEFAULT 0,
  avg_time_per_question_seconds NUMERIC,
  trend VARCHAR(20) DEFAULT 'stable' CHECK (trend IN ('improving', 'declining', 'stable')),
  last_exam_id UUID REFERENCES public.exams(id) ON DELETE SET NULL,
  last_updated TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, topic_id)
);

-- Concept Mastery History: Snapshots for trend analysis
CREATE TABLE public.concept_mastery_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mastery_id UUID NOT NULL REFERENCES public.concept_mastery(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  mastery_level INTEGER NOT NULL CHECK (mastery_level BETWEEN 0 AND 100),
  questions_attempted INTEGER DEFAULT 0,
  questions_correct INTEGER DEFAULT 0,
  snapshot_at TIMESTAMPTZ DEFAULT now()
);

-- Learning Actions: Personalized recommendations for students
CREATE TABLE public.learning_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('revision', 'practice', 'retest', 'study_material')),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  topic_id UUID REFERENCES public.syllabus_topics(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  priority INTEGER DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  source VARCHAR(50) DEFAULT 'auto' CHECK (source IN ('auto', 'teacher')),
  source_exam_id UUID REFERENCES public.exams(id) ON DELETE SET NULL,
  status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'assigned', 'completed', 'declined')),
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.concept_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_mastery_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_actions ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES FOR CONCEPT_MASTERY
-- =====================================================

-- Students can view their own mastery
CREATE POLICY "Students can view own concept mastery"
ON public.concept_mastery FOR SELECT
USING (auth.uid() = student_id);

-- Teachers can view mastery for students in their classes
CREATE POLICY "Teachers can view student concept mastery"
ON public.concept_mastery FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = auth.uid()
    AND ca.role = 'teacher'
    AND ca.class_id IN (
      SELECT class_id FROM public.class_assignments
      WHERE user_id = concept_mastery.student_id AND role = 'student'
    )
  )
);

-- School admins and coordinators can view all mastery in their institution
CREATE POLICY "School staff can view institution concept mastery"
ON public.concept_mastery FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = auth.uid()
    AND p.institution_id = concept_mastery.institution_id
    AND ur.role IN ('school_admin', 'coordinator')
  )
);

-- Super admins can view all
CREATE POLICY "Super admins can view all concept mastery"
ON public.concept_mastery FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

-- System can insert/update mastery (via service role)
CREATE POLICY "Authenticated users can insert concept mastery"
ON public.concept_mastery FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update concept mastery"
ON public.concept_mastery FOR UPDATE
USING (true)
WITH CHECK (true);

-- =====================================================
-- RLS POLICIES FOR CONCEPT_MASTERY_HISTORY
-- =====================================================

-- Same visibility as concept_mastery via join
CREATE POLICY "Users can view history for accessible mastery records"
ON public.concept_mastery_history FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.concept_mastery cm
    WHERE cm.id = concept_mastery_history.mastery_id
  )
);

CREATE POLICY "Authenticated users can insert mastery history"
ON public.concept_mastery_history FOR INSERT
WITH CHECK (true);

-- =====================================================
-- RLS POLICIES FOR LEARNING_ACTIONS
-- =====================================================

-- Students can view their own learning actions
CREATE POLICY "Students can view own learning actions"
ON public.learning_actions FOR SELECT
USING (auth.uid() = student_id);

-- Students can update their own actions (mark complete)
CREATE POLICY "Students can update own learning actions"
ON public.learning_actions FOR UPDATE
USING (auth.uid() = student_id)
WITH CHECK (auth.uid() = student_id);

-- Teachers can view/manage actions for their students
CREATE POLICY "Teachers can view student learning actions"
ON public.learning_actions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = auth.uid()
    AND ca.role = 'teacher'
    AND ca.class_id = learning_actions.class_id
  )
);

CREATE POLICY "Teachers can create learning actions"
ON public.learning_actions FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = auth.uid()
    AND ca.role = 'teacher'
    AND ca.class_id = learning_actions.class_id
  )
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'school_admin')
);

CREATE POLICY "Teachers can update learning actions"
ON public.learning_actions FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = auth.uid()
    AND ca.role = 'teacher'
    AND ca.class_id = learning_actions.class_id
  )
);

-- School staff can view all actions in their institution
CREATE POLICY "School staff can view institution learning actions"
ON public.learning_actions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = auth.uid()
    AND p.institution_id = learning_actions.institution_id
    AND ur.role IN ('school_admin', 'coordinator')
  )
);

-- School admins can manage all actions
CREATE POLICY "School admins can manage learning actions"
ON public.learning_actions FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = auth.uid()
    AND p.institution_id = learning_actions.institution_id
    AND ur.role = 'school_admin'
  )
);

-- Super admins full access
CREATE POLICY "Super admins can manage all learning actions"
ON public.learning_actions FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'));

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX idx_concept_mastery_student ON public.concept_mastery(student_id);
CREATE INDEX idx_concept_mastery_topic ON public.concept_mastery(topic_id);
CREATE INDEX idx_concept_mastery_institution ON public.concept_mastery(institution_id);
CREATE INDEX idx_concept_mastery_level ON public.concept_mastery(mastery_level);

CREATE INDEX idx_mastery_history_mastery ON public.concept_mastery_history(mastery_id);
CREATE INDEX idx_mastery_history_exam ON public.concept_mastery_history(exam_id);

CREATE INDEX idx_learning_actions_student ON public.learning_actions(student_id);
CREATE INDEX idx_learning_actions_status ON public.learning_actions(status);
CREATE INDEX idx_learning_actions_class ON public.learning_actions(class_id);
CREATE INDEX idx_learning_actions_institution ON public.learning_actions(institution_id);

-- =====================================================
-- TRIGGER FOR UPDATED_AT
-- =====================================================

CREATE TRIGGER update_learning_actions_updated_at
BEFORE UPDATE ON public.learning_actions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();