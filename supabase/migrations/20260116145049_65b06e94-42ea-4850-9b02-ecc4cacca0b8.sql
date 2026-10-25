-- Add mascot and onboarding preferences to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS mascot_name text,
ADD COLUMN IF NOT EXISTS mascot_gender text CHECK (mascot_gender IN ('buddy', 'spark')),
ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS tour_steps_completed jsonb DEFAULT '[]';

-- Create exam_insights table for AI-generated per-exam insights
CREATE TABLE IF NOT EXISTS public.exam_insights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id uuid REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  exam_id uuid REFERENCES public.exams(id) ON DELETE CASCADE,
  overall_performance text,
  performance_level text CHECK (performance_level IN ('excellent', 'very_good', 'good', 'needs_improvement', 'critical')),
  strengths jsonb NOT NULL DEFAULT '[]',
  focus_areas jsonb NOT NULL DEFAULT '[]',
  study_tips jsonb NOT NULL DEFAULT '[]',
  action_plan jsonb NOT NULL DEFAULT '{}',
  subject_breakdown jsonb NOT NULL DEFAULT '[]',
  motivational_message text,
  generated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.exam_insights ENABLE ROW LEVEL SECURITY;

-- Students can view their own insights
CREATE POLICY "Students can view their own insights" 
ON public.exam_insights 
FOR SELECT 
USING (auth.uid() = student_id);

-- Teachers can view insights for students in their classes
CREATE POLICY "Teachers can view student insights" 
ON public.exam_insights 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM class_assignments ca
    JOIN student_exam_attempts sea ON sea.id = exam_insights.attempt_id
    JOIN exams e ON e.id = sea.exam_id
    JOIN exam_classes ec ON ec.exam_id = e.id
    WHERE ca.user_id = auth.uid()
    AND ca.class_id = ec.class_id
    AND ca.role = 'teacher'
  )
);

-- System can insert insights
CREATE POLICY "Service can insert insights"
ON public.exam_insights
FOR INSERT
WITH CHECK (true);

-- Create teacher_effectiveness table for tracking teacher performance
CREATE TABLE IF NOT EXISTS public.teacher_effectiveness (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_students integer DEFAULT 0,
  avg_student_improvement decimal,
  pass_rate decimal,
  class_avg_vs_school decimal,
  exams_conducted integer DEFAULT 0,
  evaluations_completed integer DEFAULT 0,
  avg_evaluation_time_hours decimal,
  effectiveness_score decimal,
  calculated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.teacher_effectiveness ENABLE ROW LEVEL SECURITY;

-- Teachers can view their own effectiveness
CREATE POLICY "Teachers view own effectiveness"
ON public.teacher_effectiveness
FOR SELECT
USING (auth.uid() = teacher_id);

-- School admins and coordinators can view all teacher effectiveness in their institution
CREATE POLICY "Admins view institution effectiveness"
ON public.teacher_effectiveness
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.institution_id = teacher_effectiveness.institution_id
    AND ur.role IN ('school_admin', 'coordinator')
  )
);

-- Super admins can view all
CREATE POLICY "Super admins view all effectiveness"
ON public.teacher_effectiveness
FOR SELECT
USING (public.has_super_admin_access(auth.uid()));

-- Service can manage
CREATE POLICY "Service can manage effectiveness"
ON public.teacher_effectiveness
FOR ALL
USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_exam_insights_student ON public.exam_insights(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_insights_attempt ON public.exam_insights(attempt_id);
CREATE INDEX IF NOT EXISTS idx_teacher_effectiveness_teacher ON public.teacher_effectiveness(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_effectiveness_institution ON public.teacher_effectiveness(institution_id);