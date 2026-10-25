-- =============================================
-- ANALYTICS AGGREGATES TABLES
-- For derived metrics and dashboard performance
-- =============================================

-- Student Performance Snapshots (per exam attempt)
CREATE TABLE IF NOT EXISTS public.student_performance_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.profiles(id),
  attempt_id UUID NOT NULL REFERENCES public.student_exam_attempts(id),
  exam_id UUID NOT NULL REFERENCES public.exams(id),
  class_id UUID NOT NULL REFERENCES public.classes(id),
  
  -- Raw metrics
  total_questions INTEGER NOT NULL DEFAULT 0,
  questions_attempted INTEGER NOT NULL DEFAULT 0,
  questions_correct INTEGER NOT NULL DEFAULT 0,
  questions_skipped INTEGER NOT NULL DEFAULT 0,
  total_time_seconds INTEGER NOT NULL DEFAULT 0,
  
  -- Derived metrics (pre-calculated)
  accuracy_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  avg_time_per_question_seconds DECIMAL(8,2) NOT NULL DEFAULT 0,
  efficiency_score DECIMAL(8,4) NOT NULL DEFAULT 0,
  
  -- Subject breakdown (JSONB for flexibility)
  subject_breakdown JSONB DEFAULT '[]',
  
  -- Computed at
  snapshot_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(attempt_id)
);

-- Class Aggregates (per exam)
CREATE TABLE IF NOT EXISTS public.class_aggregates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES public.classes(id),
  exam_id UUID NOT NULL REFERENCES public.exams(id),
  
  -- Counts
  total_students INTEGER NOT NULL DEFAULT 0,
  students_attempted INTEGER NOT NULL DEFAULT 0,
  students_passed INTEGER NOT NULL DEFAULT 0,
  
  -- Averages
  avg_accuracy_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  avg_time_per_question_seconds DECIMAL(8,2) NOT NULL DEFAULT 0,
  avg_efficiency_score DECIMAL(8,4) NOT NULL DEFAULT 0,
  avg_score_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  
  -- Distribution
  score_distribution JSONB DEFAULT '{}',
  subject_averages JSONB DEFAULT '[]',
  
  -- Computed at
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(class_id, exam_id)
);

-- Teacher Aggregates (per teacher per time period)
CREATE TABLE IF NOT EXISTS public.teacher_aggregates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id),
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Exam metrics
  total_exams_created INTEGER NOT NULL DEFAULT 0,
  exams_published INTEGER NOT NULL DEFAULT 0,
  exams_completed INTEGER NOT NULL DEFAULT 0,
  
  -- Student metrics across all classes
  total_students_taught INTEGER NOT NULL DEFAULT 0,
  avg_class_accuracy DECIMAL(5,2) NOT NULL DEFAULT 0,
  avg_class_pass_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  
  -- Evaluation metrics
  evaluations_completed INTEGER NOT NULL DEFAULT 0,
  avg_evaluation_turnaround_hours DECIMAL(8,2) NOT NULL DEFAULT 0,
  
  -- Class breakdown
  class_performance JSONB DEFAULT '[]',
  
  -- Computed at
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(teacher_id, period_start, period_end)
);

-- School Aggregates (per institution per time period)
CREATE TABLE IF NOT EXISTS public.school_aggregates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Overall metrics
  total_exams INTEGER NOT NULL DEFAULT 0,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  total_students_active INTEGER NOT NULL DEFAULT 0,
  total_teachers_active INTEGER NOT NULL DEFAULT 0,
  
  -- Performance metrics
  avg_school_accuracy DECIMAL(5,2) NOT NULL DEFAULT 0,
  avg_school_pass_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  avg_school_efficiency DECIMAL(8,4) NOT NULL DEFAULT 0,
  
  -- Grade/Section breakdown
  grade_section_performance JSONB DEFAULT '[]',
  subject_performance JSONB DEFAULT '[]',
  teacher_effectiveness JSONB DEFAULT '[]',
  
  -- Comparison data
  underperforming_classes JSONB DEFAULT '[]',
  top_performing_classes JSONB DEFAULT '[]',
  
  -- Computed at
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(institution_id, period_start, period_end)
);

-- Enable RLS on all tables
ALTER TABLE public.student_performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_aggregates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for student_performance_snapshots
CREATE POLICY "Students can view own snapshots"
ON public.student_performance_snapshots FOR SELECT
USING (student_id = auth.uid());

CREATE POLICY "Teachers can view snapshots for their classes"
ON public.student_performance_snapshots FOR SELECT
USING (
  public.is_assigned_to_class(auth.uid(), class_id)
);

CREATE POLICY "School admins can view institution snapshots"
ON public.student_performance_snapshots FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.classes c
    JOIN public.user_roles ur ON ur.institution_id = c.institution_id
    WHERE c.id = class_id 
    AND ur.user_id = auth.uid() 
    AND ur.role = 'school_admin'
  )
);

CREATE POLICY "Super admins can view all snapshots"
ON public.student_performance_snapshots FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

-- RLS Policies for class_aggregates
CREATE POLICY "Teachers can view aggregates for their classes"
ON public.class_aggregates FOR SELECT
USING (public.is_assigned_to_class(auth.uid(), class_id));

CREATE POLICY "School admins can view institution class aggregates"
ON public.class_aggregates FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.classes c
    JOIN public.user_roles ur ON ur.institution_id = c.institution_id
    WHERE c.id = class_id 
    AND ur.user_id = auth.uid() 
    AND ur.role = 'school_admin'
  )
);

CREATE POLICY "Super admins can view all class aggregates"
ON public.class_aggregates FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

-- RLS Policies for teacher_aggregates
CREATE POLICY "Teachers can view own aggregates"
ON public.teacher_aggregates FOR SELECT
USING (teacher_id = auth.uid());

CREATE POLICY "School admins can view institution teacher aggregates"
ON public.teacher_aggregates FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.institution_id = institution_id
    AND ur.user_id = auth.uid()
    AND ur.role = 'school_admin'
  )
);

CREATE POLICY "Super admins can view all teacher aggregates"
ON public.teacher_aggregates FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

-- RLS Policies for school_aggregates
CREATE POLICY "School admins can view own institution aggregates"
ON public.school_aggregates FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.institution_id = institution_id
    AND ur.user_id = auth.uid()
    AND ur.role = 'school_admin'
  )
);

CREATE POLICY "Super admins can view all school aggregates"
ON public.school_aggregates FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

-- Indexes for performance
CREATE INDEX idx_student_snapshots_student ON public.student_performance_snapshots(student_id);
CREATE INDEX idx_student_snapshots_class ON public.student_performance_snapshots(class_id);
CREATE INDEX idx_student_snapshots_exam ON public.student_performance_snapshots(exam_id);
CREATE INDEX idx_class_aggregates_class ON public.class_aggregates(class_id);
CREATE INDEX idx_class_aggregates_exam ON public.class_aggregates(exam_id);
CREATE INDEX idx_teacher_aggregates_teacher ON public.teacher_aggregates(teacher_id);
CREATE INDEX idx_teacher_aggregates_period ON public.teacher_aggregates(period_start, period_end);
CREATE INDEX idx_school_aggregates_institution ON public.school_aggregates(institution_id);
CREATE INDEX idx_school_aggregates_period ON public.school_aggregates(period_start, period_end);

-- Function to compute student performance snapshot after evaluation finalization
CREATE OR REPLACE FUNCTION public.compute_student_performance_snapshot(_attempt_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snapshot_id UUID;
  v_student_id UUID;
  v_exam_id UUID;
  v_class_id UUID;
  v_total_questions INTEGER;
  v_attempted INTEGER;
  v_correct INTEGER;
  v_skipped INTEGER;
  v_total_time INTEGER;
  v_accuracy DECIMAL;
  v_avg_time DECIMAL;
  v_efficiency DECIMAL;
BEGIN
  -- Get attempt details
  SELECT student_id, exam_id, class_id, time_spent_seconds
  INTO v_student_id, v_exam_id, v_class_id, v_total_time
  FROM student_exam_attempts WHERE id = _attempt_id;
  
  -- Count questions from telemetry
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE is_answered = true),
    COUNT(*) FILTER (WHERE is_skipped = true)
  INTO v_total_questions, v_attempted, v_skipped
  FROM attempt_question_telemetry
  WHERE attempt_id = _attempt_id;
  
  -- Get correct answers from teacher overrides
  SELECT COUNT(*) INTO v_correct
  FROM teacher_overrides to_
  JOIN student_answers sa ON sa.id = to_.answer_id
  WHERE sa.attempt_id = _attempt_id
  AND to_.final_marks = to_.max_marks;
  
  -- Calculate derived metrics
  v_accuracy := CASE WHEN v_attempted > 0 THEN (v_correct::DECIMAL / v_attempted) * 100 ELSE 0 END;
  v_avg_time := CASE WHEN v_total_questions > 0 THEN v_total_time::DECIMAL / v_total_questions ELSE 0 END;
  v_efficiency := CASE WHEN v_avg_time > 0 THEN v_accuracy / v_avg_time ELSE 0 END;
  
  -- Upsert snapshot
  INSERT INTO student_performance_snapshots (
    student_id, attempt_id, exam_id, class_id,
    total_questions, questions_attempted, questions_correct, questions_skipped,
    total_time_seconds, accuracy_percent, avg_time_per_question_seconds, efficiency_score
  ) VALUES (
    v_student_id, _attempt_id, v_exam_id, v_class_id,
    COALESCE(v_total_questions, 0), COALESCE(v_attempted, 0), COALESCE(v_correct, 0), COALESCE(v_skipped, 0),
    COALESCE(v_total_time, 0), COALESCE(v_accuracy, 0), COALESCE(v_avg_time, 0), COALESCE(v_efficiency, 0)
  )
  ON CONFLICT (attempt_id) DO UPDATE SET
    questions_attempted = EXCLUDED.questions_attempted,
    questions_correct = EXCLUDED.questions_correct,
    questions_skipped = EXCLUDED.questions_skipped,
    total_time_seconds = EXCLUDED.total_time_seconds,
    accuracy_percent = EXCLUDED.accuracy_percent,
    avg_time_per_question_seconds = EXCLUDED.avg_time_per_question_seconds,
    efficiency_score = EXCLUDED.efficiency_score,
    snapshot_at = now()
  RETURNING id INTO v_snapshot_id;
  
  RETURN v_snapshot_id;
END;
$$;

-- Trigger to compute snapshot when attempt is finalized
CREATE OR REPLACE FUNCTION public.trigger_compute_snapshot_on_finalize()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_finalized = true AND OLD.is_finalized = false THEN
    PERFORM compute_student_performance_snapshot(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER compute_snapshot_on_finalize
AFTER UPDATE ON public.student_exam_attempts
FOR EACH ROW
EXECUTE FUNCTION public.trigger_compute_snapshot_on_finalize();