-- =============================================
-- EVALUATION ENGINE SCHEMA
-- =============================================

-- Enum for evaluation status
CREATE TYPE public.evaluation_status AS ENUM (
  'pending',           -- Not yet evaluated
  'ai_evaluated',      -- AI has suggested marks
  'teacher_reviewed',  -- Teacher has reviewed/overridden
  'finalized',         -- Result locked and published
  'disputed'           -- Under dispute/recheck
);

-- Enum for answer source
CREATE TYPE public.answer_source AS ENUM (
  'online',     -- Submitted via online interface
  'offline_ocr', -- Scanned and OCR processed
  'offline_manual' -- Manually entered by teacher
);

-- =============================================
-- CORE TABLES
-- =============================================

-- Evaluation blueprints (marking schemes)
CREATE TABLE public.evaluation_blueprints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  section_id UUID REFERENCES public.exam_sections(id) ON DELETE CASCADE,
  
  -- Marking criteria
  max_marks NUMERIC(10,2) NOT NULL,
  marking_scheme TEXT, -- Detailed rubric or marking guide
  keywords TEXT[], -- Key points for auto-evaluation
  partial_marking_allowed BOOLEAN NOT NULL DEFAULT true,
  negative_marking NUMERIC(10,2) DEFAULT 0,
  
  -- AI evaluation settings
  ai_evaluation_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_confidence_threshold NUMERIC(3,2) DEFAULT 0.75, -- 0-1 scale
  
  -- Metadata
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Either question-level or section-level blueprint
  CONSTRAINT valid_blueprint_target CHECK (
    (question_id IS NOT NULL AND section_id IS NULL) OR
    (question_id IS NULL AND section_id IS NOT NULL)
  )
);

-- Student exam attempts
CREATE TABLE public.student_exam_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id),
  class_id UUID NOT NULL REFERENCES public.classes(id),
  
  -- Attempt details
  started_at TIMESTAMP WITH TIME ZONE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  is_submitted BOOLEAN NOT NULL DEFAULT false,
  time_spent_seconds INTEGER,
  
  -- For offline exams
  answer_sheet_url TEXT, -- Scanned answer sheet
  ocr_processed BOOLEAN DEFAULT false,
  ocr_confidence_overall NUMERIC(3,2), -- 0-1 scale
  
  -- Status
  evaluation_status public.evaluation_status NOT NULL DEFAULT 'pending',
  is_finalized BOOLEAN NOT NULL DEFAULT false,
  finalized_at TIMESTAMP WITH TIME ZONE,
  finalized_by UUID REFERENCES public.profiles(id),
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(exam_id, student_id)
);

-- Student answers (per question)
CREATE TABLE public.student_answers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  
  -- Answer content
  answer_source public.answer_source NOT NULL DEFAULT 'online',
  answer_text TEXT,
  answer_options JSONB, -- For MCQ: selected option IDs
  answer_file_url TEXT, -- For file uploads or OCR images
  
  -- OCR details (for offline)
  ocr_extracted_text TEXT,
  ocr_confidence NUMERIC(3,2), -- 0-1 scale
  ocr_needs_review BOOLEAN DEFAULT false,
  
  -- Timestamps
  answered_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  UNIQUE(attempt_id, question_id)
);

-- AI evaluations (suggestions only)
CREATE TABLE public.ai_evaluations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  answer_id UUID NOT NULL REFERENCES public.student_answers(id) ON DELETE CASCADE,
  
  -- AI scoring
  suggested_marks NUMERIC(10,2) NOT NULL,
  max_marks NUMERIC(10,2) NOT NULL,
  confidence_score NUMERIC(3,2) NOT NULL, -- 0-1 scale
  
  -- AI reasoning
  evaluation_reasoning TEXT,
  matched_keywords TEXT[],
  feedback_suggestion TEXT,
  
  -- Model info
  model_used TEXT,
  evaluation_metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Status
  requires_teacher_review BOOLEAN NOT NULL DEFAULT true,
  is_accepted BOOLEAN, -- null = pending, true = accepted, false = rejected
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Only one AI evaluation per answer
  UNIQUE(answer_id)
);

-- Teacher overrides (final authority)
CREATE TABLE public.teacher_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  answer_id UUID NOT NULL REFERENCES public.student_answers(id) ON DELETE CASCADE,
  ai_evaluation_id UUID REFERENCES public.ai_evaluations(id),
  
  -- Teacher scoring
  final_marks NUMERIC(10,2) NOT NULL,
  max_marks NUMERIC(10,2) NOT NULL,
  
  -- Teacher feedback
  teacher_feedback TEXT,
  internal_notes TEXT, -- Not visible to students
  
  -- Override details
  override_reason TEXT, -- Why different from AI suggestion
  accepted_ai_suggestion BOOLEAN DEFAULT false,
  
  -- Teacher info
  evaluated_by UUID NOT NULL REFERENCES public.profiles(id),
  evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Verification
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified_by UUID REFERENCES public.profiles(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Only one override per answer
  UNIQUE(answer_id)
);

-- Final results (per attempt, after all evaluations complete)
CREATE TABLE public.final_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE,
  
  -- Scores
  total_marks_obtained NUMERIC(10,2) NOT NULL,
  total_max_marks NUMERIC(10,2) NOT NULL,
  percentage NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN total_max_marks > 0 
      THEN ROUND((total_marks_obtained / total_max_marks) * 100, 2)
      ELSE 0 
    END
  ) STORED,
  
  -- Result status
  is_pass BOOLEAN,
  grade TEXT,
  rank_in_class INTEGER,
  
  -- Section-wise breakdown
  section_scores JSONB DEFAULT '{}'::jsonb,
  
  -- Publication
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMP WITH TIME ZONE,
  published_by UUID REFERENCES public.profiles(id),
  
  -- Finalization
  finalized_by UUID NOT NULL REFERENCES public.profiles(id),
  finalized_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finalization_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Only one final result per attempt
  UNIQUE(attempt_id)
);

-- Recheck requests
CREATE TABLE public.recheck_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  result_id UUID NOT NULL REFERENCES public.final_results(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.exam_questions(id),
  
  -- Request details
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  request_reason TEXT NOT NULL,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Resolution
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'resolved', 'rejected')),
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,
  marks_changed BOOLEAN DEFAULT false,
  previous_marks NUMERIC(10,2),
  new_marks NUMERIC(10,2)
);

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_eval_blueprints_exam ON public.evaluation_blueprints(exam_id);
CREATE INDEX idx_eval_blueprints_question ON public.evaluation_blueprints(question_id);
CREATE INDEX idx_student_attempts_exam ON public.student_exam_attempts(exam_id);
CREATE INDEX idx_student_attempts_student ON public.student_exam_attempts(student_id);
CREATE INDEX idx_student_attempts_status ON public.student_exam_attempts(evaluation_status);
CREATE INDEX idx_student_answers_attempt ON public.student_answers(attempt_id);
CREATE INDEX idx_student_answers_question ON public.student_answers(question_id);
CREATE INDEX idx_ai_evaluations_answer ON public.ai_evaluations(answer_id);
CREATE INDEX idx_teacher_overrides_answer ON public.teacher_overrides(answer_id);
CREATE INDEX idx_teacher_overrides_evaluator ON public.teacher_overrides(evaluated_by);
CREATE INDEX idx_final_results_attempt ON public.final_results(attempt_id);
CREATE INDEX idx_recheck_requests_result ON public.recheck_requests(result_id);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Get attempt's exam ID
CREATE OR REPLACE FUNCTION public.get_attempt_exam_id(_attempt_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT exam_id FROM public.student_exam_attempts WHERE id = _attempt_id
$$;

-- Get attempt's student ID
CREATE OR REPLACE FUNCTION public.get_attempt_student_id(_attempt_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT student_id FROM public.student_exam_attempts WHERE id = _attempt_id
$$;

-- Get attempt's class ID
CREATE OR REPLACE FUNCTION public.get_attempt_class_id(_attempt_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT class_id FROM public.student_exam_attempts WHERE id = _attempt_id
$$;

-- Check if user can evaluate this attempt (assigned to the class)
CREATE OR REPLACE FUNCTION public.can_evaluate_attempt(_user_id UUID, _attempt_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.student_exam_attempts sa
    JOIN public.class_assignments ca ON ca.class_id = sa.class_id
    WHERE sa.id = _attempt_id 
      AND ca.user_id = _user_id
      AND ca.role IN ('teacher', 'coordinator')
  )
$$;

-- Check if attempt is finalized
CREATE OR REPLACE FUNCTION public.is_attempt_finalized(_attempt_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_finalized FROM public.student_exam_attempts WHERE id = _attempt_id),
    false
  )
$$;

-- Get answer's attempt ID
CREATE OR REPLACE FUNCTION public.get_answer_attempt_id(_answer_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT attempt_id FROM public.student_answers WHERE id = _answer_id
$$;

-- Check if exam has complete blueprint
CREATE OR REPLACE FUNCTION public.exam_has_complete_blueprint(_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.exam_questions eq
    WHERE eq.section_id IN (
      SELECT id FROM public.exam_sections WHERE exam_id = _exam_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.evaluation_blueprints eb
      WHERE eb.question_id = eq.id
    )
  )
$$;

-- =============================================
-- TRIGGERS
-- =============================================

-- Auto-update updated_at
CREATE TRIGGER update_eval_blueprints_updated_at
  BEFORE UPDATE ON public.evaluation_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_student_attempts_updated_at
  BEFORE UPDATE ON public.student_exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_student_answers_updated_at
  BEFORE UPDATE ON public.student_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Update exam blueprint status when blueprints are added
CREATE OR REPLACE FUNCTION public.update_exam_blueprint_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if all questions have blueprints
  IF public.exam_has_complete_blueprint(NEW.exam_id) THEN
    UPDATE public.exams 
    SET is_blueprint_ready = true 
    WHERE id = NEW.exam_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_blueprint_completeness
  AFTER INSERT OR UPDATE ON public.evaluation_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION public.update_exam_blueprint_status();

-- Prevent finalization without teacher review for all answers
CREATE OR REPLACE FUNCTION public.validate_attempt_finalization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unreviewed_count INTEGER;
BEGIN
  -- Only check when finalizing
  IF NEW.is_finalized = true AND OLD.is_finalized = false THEN
    -- Count answers without teacher override
    SELECT COUNT(*) INTO v_unreviewed_count
    FROM public.student_answers sa
    WHERE sa.attempt_id = NEW.id
    AND NOT EXISTS (
      SELECT 1 FROM public.teacher_overrides to_
      WHERE to_.answer_id = sa.id
    );
    
    IF v_unreviewed_count > 0 THEN
      RAISE EXCEPTION 'Cannot finalize: % answers still need teacher review', v_unreviewed_count;
    END IF;
    
    -- Set finalization timestamp
    NEW.finalized_at := now();
    NEW.finalized_by := auth.uid();
    NEW.evaluation_status := 'finalized';
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_finalization
  BEFORE UPDATE ON public.student_exam_attempts
  FOR EACH ROW
  WHEN (NEW.is_finalized IS DISTINCT FROM OLD.is_finalized)
  EXECUTE FUNCTION public.validate_attempt_finalization();

-- Prevent changes to finalized attempts
CREATE OR REPLACE FUNCTION public.prevent_finalized_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
  v_is_finalized BOOLEAN;
BEGIN
  -- Get attempt_id based on table
  IF TG_TABLE_NAME = 'student_answers' THEN
    v_attempt_id := COALESCE(NEW.attempt_id, OLD.attempt_id);
  ELSIF TG_TABLE_NAME = 'teacher_overrides' THEN
    v_attempt_id := public.get_answer_attempt_id(COALESCE(NEW.answer_id, OLD.answer_id));
  ELSIF TG_TABLE_NAME = 'ai_evaluations' THEN
    v_attempt_id := public.get_answer_attempt_id(COALESCE(NEW.answer_id, OLD.answer_id));
  END IF;
  
  -- Check if finalized
  SELECT is_finalized INTO v_is_finalized
  FROM public.student_exam_attempts WHERE id = v_attempt_id;
  
  IF v_is_finalized = true THEN
    RAISE EXCEPTION 'Cannot modify data for finalized exam attempt';
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_answer_changes_after_finalize
  BEFORE UPDATE OR DELETE ON public.student_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_changes();

CREATE TRIGGER prevent_override_changes_after_finalize
  BEFORE UPDATE OR DELETE ON public.teacher_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_changes();

CREATE TRIGGER prevent_ai_eval_changes_after_finalize
  BEFORE UPDATE OR DELETE ON public.ai_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_changes();

-- Flag low OCR confidence for review
CREATE OR REPLACE FUNCTION public.flag_low_ocr_confidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.answer_source = 'offline_ocr' AND NEW.ocr_confidence IS NOT NULL THEN
    IF NEW.ocr_confidence < 0.7 THEN
      NEW.ocr_needs_review := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_flag_low_ocr
  BEFORE INSERT OR UPDATE ON public.student_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_low_ocr_confidence();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE public.evaluation_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recheck_requests ENABLE ROW LEVEL SECURITY;

-- =============================================
-- EVALUATION_BLUEPRINTS POLICIES
-- =============================================

CREATE POLICY "Super admins can view all blueprints"
  ON public.evaluation_blueprints FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage blueprints"
  ON public.evaluation_blueprints FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(exam_id)
    )
  );

CREATE POLICY "Exam creators can manage blueprints"
  ON public.evaluation_blueprints FOR ALL
  USING (public.is_exam_creator(exam_id, auth.uid()));

CREATE POLICY "Teachers can view blueprints for assigned exams"
  ON public.evaluation_blueprints FOR SELECT
  USING (
    public.is_assigned_to_exam_class(auth.uid(), exam_id)
  );

-- =============================================
-- STUDENT_EXAM_ATTEMPTS POLICIES
-- =============================================

CREATE POLICY "Super admins can view all attempts"
  ON public.student_exam_attempts FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage attempts in their institution"
  ON public.student_exam_attempts FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(exam_id)
    )
  );

CREATE POLICY "Teachers can view attempts for assigned classes"
  ON public.student_exam_attempts FOR SELECT
  USING (public.is_assigned_to_class(auth.uid(), class_id));

CREATE POLICY "Teachers can update attempts for assigned classes"
  ON public.student_exam_attempts FOR UPDATE
  USING (
    public.is_assigned_to_class(auth.uid(), class_id) AND
    (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'coordinator'))
  );

CREATE POLICY "Students can view own attempts"
  ON public.student_exam_attempts FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Students can create own attempts"
  ON public.student_exam_attempts FOR INSERT
  WITH CHECK (
    student_id = auth.uid() AND
    public.has_role(auth.uid(), 'student')
  );

CREATE POLICY "Students can update own non-finalized attempts"
  ON public.student_exam_attempts FOR UPDATE
  USING (
    student_id = auth.uid() AND
    is_finalized = false
  );

-- =============================================
-- STUDENT_ANSWERS POLICIES
-- =============================================

CREATE POLICY "Super admins can view all answers"
  ON public.student_answers FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage answers"
  ON public.student_answers FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(public.get_attempt_exam_id(attempt_id))
    )
  );

CREATE POLICY "Teachers can view answers for assigned classes"
  ON public.student_answers FOR SELECT
  USING (
    public.is_assigned_to_class(auth.uid(), public.get_attempt_class_id(attempt_id))
  );

CREATE POLICY "Teachers can update answers for evaluation"
  ON public.student_answers FOR UPDATE
  USING (
    public.can_evaluate_attempt(auth.uid(), attempt_id) AND
    NOT public.is_attempt_finalized(attempt_id)
  );

CREATE POLICY "Students can view own answers"
  ON public.student_answers FOR SELECT
  USING (
    public.get_attempt_student_id(attempt_id) = auth.uid()
  );

CREATE POLICY "Students can submit own answers"
  ON public.student_answers FOR INSERT
  WITH CHECK (
    public.get_attempt_student_id(attempt_id) = auth.uid() AND
    NOT public.is_attempt_finalized(attempt_id)
  );

CREATE POLICY "Students can update own answers before submission"
  ON public.student_answers FOR UPDATE
  USING (
    public.get_attempt_student_id(attempt_id) = auth.uid() AND
    NOT public.is_attempt_finalized(attempt_id)
  );

-- =============================================
-- AI_EVALUATIONS POLICIES
-- =============================================

CREATE POLICY "Super admins can view all AI evaluations"
  ON public.ai_evaluations FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage AI evaluations"
  ON public.ai_evaluations FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(
        public.get_attempt_exam_id(public.get_answer_attempt_id(answer_id))
      )
    )
  );

CREATE POLICY "Teachers can view AI evaluations for assigned classes"
  ON public.ai_evaluations FOR SELECT
  USING (
    public.can_evaluate_attempt(auth.uid(), public.get_answer_attempt_id(answer_id))
  );

-- AI evaluations are created by the system, not directly by users
-- Teachers accept/reject through teacher_overrides

-- =============================================
-- TEACHER_OVERRIDES POLICIES
-- =============================================

CREATE POLICY "Super admins can view all overrides"
  ON public.teacher_overrides FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage overrides"
  ON public.teacher_overrides FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(
        public.get_attempt_exam_id(public.get_answer_attempt_id(answer_id))
      )
    )
  );

CREATE POLICY "Teachers can create overrides for assigned classes"
  ON public.teacher_overrides FOR INSERT
  WITH CHECK (
    public.can_evaluate_attempt(auth.uid(), public.get_answer_attempt_id(answer_id)) AND
    evaluated_by = auth.uid()
  );

CREATE POLICY "Teachers can view overrides for assigned classes"
  ON public.teacher_overrides FOR SELECT
  USING (
    public.can_evaluate_attempt(auth.uid(), public.get_answer_attempt_id(answer_id))
  );

CREATE POLICY "Teachers can update own overrides"
  ON public.teacher_overrides FOR UPDATE
  USING (
    evaluated_by = auth.uid() AND
    NOT public.is_attempt_finalized(public.get_answer_attempt_id(answer_id))
  );

-- Students cannot see teacher internal notes
-- They see feedback through final_results only

-- =============================================
-- FINAL_RESULTS POLICIES
-- =============================================

CREATE POLICY "Super admins can view all results"
  ON public.final_results FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage results"
  ON public.final_results FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(public.get_attempt_exam_id(attempt_id))
    )
  );

CREATE POLICY "Teachers can create results for assigned classes"
  ON public.final_results FOR INSERT
  WITH CHECK (
    public.can_evaluate_attempt(auth.uid(), attempt_id) AND
    finalized_by = auth.uid()
  );

CREATE POLICY "Teachers can view results for assigned classes"
  ON public.final_results FOR SELECT
  USING (
    public.can_evaluate_attempt(auth.uid(), attempt_id)
  );

CREATE POLICY "Teachers can update unpublished results"
  ON public.final_results FOR UPDATE
  USING (
    public.can_evaluate_attempt(auth.uid(), attempt_id) AND
    is_published = false
  );

CREATE POLICY "Students can view own published results"
  ON public.final_results FOR SELECT
  USING (
    public.get_attempt_student_id(attempt_id) = auth.uid() AND
    is_published = true
  );

-- =============================================
-- RECHECK_REQUESTS POLICIES
-- =============================================

CREATE POLICY "Super admins can view all recheck requests"
  ON public.recheck_requests FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage recheck requests"
  ON public.recheck_requests FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(
        public.get_attempt_exam_id(
          (SELECT attempt_id FROM public.final_results WHERE id = result_id)
        )
      )
    )
  );

CREATE POLICY "Teachers can view and resolve recheck requests"
  ON public.recheck_requests FOR SELECT
  USING (
    public.can_evaluate_attempt(
      auth.uid(),
      (SELECT attempt_id FROM public.final_results WHERE id = result_id)
    )
  );

CREATE POLICY "Teachers can update recheck requests"
  ON public.recheck_requests FOR UPDATE
  USING (
    public.can_evaluate_attempt(
      auth.uid(),
      (SELECT attempt_id FROM public.final_results WHERE id = result_id)
    )
  );

CREATE POLICY "Students can view own recheck requests"
  ON public.recheck_requests FOR SELECT
  USING (requested_by = auth.uid());

CREATE POLICY "Students can create recheck requests"
  ON public.recheck_requests FOR INSERT
  WITH CHECK (
    requested_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.final_results fr
      WHERE fr.id = result_id
      AND public.get_attempt_student_id(fr.attempt_id) = auth.uid()
      AND fr.is_published = true
    )
  );