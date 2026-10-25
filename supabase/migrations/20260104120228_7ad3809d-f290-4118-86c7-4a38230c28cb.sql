-- =============================================
-- STUDENT EXAM ATTEMPT FLOW ENHANCEMENTS
-- =============================================

-- Enum for attempt actions (audit log)
CREATE TYPE public.attempt_action AS ENUM (
  'started',
  'resumed',
  'answer_saved',
  'answer_changed',
  'submitted',
  'auto_submitted',
  'timed_out',
  'abandoned'
);

-- =============================================
-- ADDITIONAL COLUMNS TO EXISTING TABLE
-- =============================================

-- Add columns to student_exam_attempts for better attempt tracking
ALTER TABLE public.student_exam_attempts 
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
ADD COLUMN IF NOT EXISTS auto_submitted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS submission_ip TEXT,
ADD COLUMN IF NOT EXISTS device_info JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS lock_reason TEXT;

-- =============================================
-- EXAM ATTEMPT LOGS (Audit Trail)
-- =============================================

CREATE TABLE public.exam_attempt_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE,
  
  -- Action details
  action public.attempt_action NOT NULL,
  question_id UUID REFERENCES public.exam_questions(id),
  
  -- Context
  action_data JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =============================================
-- STUDENT EXAM ELIGIBILITY VIEW
-- =============================================

-- View for students to see their eligible exams
CREATE OR REPLACE VIEW public.student_eligible_exams AS
SELECT 
  e.id AS exam_id,
  e.title,
  e.description,
  e.exam_mode,
  e.status,
  e.total_marks,
  e.duration_minutes,
  e.scheduled_date,
  e.start_time,
  e.end_time,
  e.instructions,
  ec.class_id,
  c.name AS class_name,
  ca.user_id AS student_id,
  sea.id AS attempt_id,
  sea.is_submitted,
  sea.is_locked,
  sea.started_at AS attempt_started_at,
  sea.submitted_at AS attempt_submitted_at,
  CASE 
    WHEN e.status != 'published' AND e.status != 'active' THEN 'not_available'
    WHEN sea.is_submitted = true THEN 'submitted'
    WHEN sea.is_locked = true THEN 'locked'
    WHEN sea.id IS NOT NULL THEN 'in_progress'
    WHEN e.start_time IS NOT NULL AND now() < e.start_time THEN 'not_started'
    WHEN e.end_time IS NOT NULL AND now() > e.end_time THEN 'expired'
    ELSE 'available'
  END AS attempt_status
FROM public.exams e
JOIN public.exam_classes ec ON ec.exam_id = e.id
JOIN public.classes c ON c.id = ec.class_id
JOIN public.class_assignments ca ON ca.class_id = ec.class_id AND ca.role = 'student'
LEFT JOIN public.student_exam_attempts sea ON sea.exam_id = e.id AND sea.student_id = ca.user_id
WHERE e.status IN ('published', 'active');

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_attempt_logs_attempt ON public.exam_attempt_logs(attempt_id);
CREATE INDEX idx_attempt_logs_action ON public.exam_attempt_logs(action);
CREATE INDEX idx_attempt_logs_created ON public.exam_attempt_logs(created_at);
CREATE INDEX idx_student_attempts_locked ON public.student_exam_attempts(is_locked);
CREATE INDEX idx_student_attempts_submitted ON public.student_exam_attempts(is_submitted);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Check if exam is within attempt window
CREATE OR REPLACE FUNCTION public.is_exam_attemptable(_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams
    WHERE id = _exam_id
      AND status IN ('published', 'active')
      AND (start_time IS NULL OR start_time <= now())
      AND (end_time IS NULL OR end_time > now())
  )
$$;

-- Check if student is assigned to exam's class
CREATE OR REPLACE FUNCTION public.is_student_assigned_to_exam(_student_id UUID, _exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.exam_classes ec
    JOIN public.class_assignments ca ON ca.class_id = ec.class_id
    WHERE ec.exam_id = _exam_id 
      AND ca.user_id = _student_id
      AND ca.role = 'student'
  )
$$;

-- Get remaining time for attempt (in seconds)
CREATE OR REPLACE FUNCTION public.get_attempt_remaining_time(_attempt_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0, 
    EXTRACT(EPOCH FROM (
      COALESCE(e.end_time, sa.started_at + (e.duration_minutes * INTERVAL '1 minute'))
      - now()
    ))::INTEGER
  )
  FROM public.student_exam_attempts sa
  JOIN public.exams e ON e.id = sa.exam_id
  WHERE sa.id = _attempt_id
$$;

-- Check if attempt should be auto-locked (timeout)
CREATE OR REPLACE FUNCTION public.should_auto_lock_attempt(_attempt_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_attempt_remaining_time(_attempt_id) <= 0
$$;

-- =============================================
-- TRIGGERS
-- =============================================

-- Validate attempt creation (time window check)
CREATE OR REPLACE FUNCTION public.validate_attempt_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_status public.exam_status;
  v_start_time TIMESTAMP WITH TIME ZONE;
  v_end_time TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Get exam details
  SELECT status, start_time, end_time 
  INTO v_exam_status, v_start_time, v_end_time
  FROM public.exams WHERE id = NEW.exam_id;
  
  -- Check exam is published/active
  IF v_exam_status NOT IN ('published', 'active') THEN
    RAISE EXCEPTION 'Exam is not available for attempts';
  END IF;
  
  -- Check time window
  IF v_start_time IS NOT NULL AND now() < v_start_time THEN
    RAISE EXCEPTION 'Exam has not started yet';
  END IF;
  
  IF v_end_time IS NOT NULL AND now() > v_end_time THEN
    RAISE EXCEPTION 'Exam time window has expired';
  END IF;
  
  -- Check student is assigned
  IF NOT public.is_student_assigned_to_exam(NEW.student_id, NEW.exam_id) THEN
    RAISE EXCEPTION 'Student is not assigned to this exam';
  END IF;
  
  -- Set started_at
  NEW.started_at := now();
  NEW.last_activity_at := now();
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_attempt_start
  BEFORE INSERT ON public.student_exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_attempt_creation();

-- Log attempt creation
CREATE OR REPLACE FUNCTION public.log_attempt_start()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.exam_attempt_logs (
    attempt_id,
    action,
    action_data
  ) VALUES (
    NEW.id,
    'started',
    jsonb_build_object(
      'exam_id', NEW.exam_id,
      'started_at', NEW.started_at
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_attempt_creation
  AFTER INSERT ON public.student_exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.log_attempt_start();

-- Validate and lock on submission
CREATE OR REPLACE FUNCTION public.handle_attempt_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- On submission
  IF NEW.is_submitted = true AND OLD.is_submitted = false THEN
    -- Lock the attempt
    NEW.is_locked := true;
    NEW.locked_at := now();
    NEW.submitted_at := now();
    NEW.lock_reason := CASE 
      WHEN NEW.auto_submitted THEN 'auto_submitted_timeout'
      ELSE 'student_submitted'
    END;
    
    -- Calculate time spent
    IF NEW.started_at IS NOT NULL THEN
      NEW.time_spent_seconds := EXTRACT(EPOCH FROM (now() - NEW.started_at))::INTEGER;
    END IF;
    
    -- Update evaluation status
    NEW.evaluation_status := 'pending';
  END IF;
  
  -- Prevent unsubmission
  IF OLD.is_submitted = true AND NEW.is_submitted = false THEN
    RAISE EXCEPTION 'Cannot unsubmit an exam attempt';
  END IF;
  
  -- Prevent unlock
  IF OLD.is_locked = true AND NEW.is_locked = false THEN
    RAISE EXCEPTION 'Cannot unlock a locked exam attempt';
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER handle_submission
  BEFORE UPDATE ON public.student_exam_attempts
  FOR EACH ROW
  WHEN (
    NEW.is_submitted IS DISTINCT FROM OLD.is_submitted OR
    NEW.is_locked IS DISTINCT FROM OLD.is_locked
  )
  EXECUTE FUNCTION public.handle_attempt_submission();

-- Log submission
CREATE OR REPLACE FUNCTION public.log_attempt_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_submitted = true AND OLD.is_submitted = false THEN
    INSERT INTO public.exam_attempt_logs (
      attempt_id,
      action,
      action_data
    ) VALUES (
      NEW.id,
      CASE WHEN NEW.auto_submitted THEN 'auto_submitted' ELSE 'submitted' END,
      jsonb_build_object(
        'submitted_at', NEW.submitted_at,
        'time_spent_seconds', NEW.time_spent_seconds,
        'auto_submitted', NEW.auto_submitted
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_submission
  AFTER UPDATE ON public.student_exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.log_attempt_submission();

-- Update last activity on answer save
CREATE OR REPLACE FUNCTION public.update_attempt_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update last activity timestamp
  UPDATE public.student_exam_attempts
  SET last_activity_at = now()
  WHERE id = NEW.attempt_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER track_answer_activity
  AFTER INSERT OR UPDATE ON public.student_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_attempt_activity();

-- Log answer changes
CREATE OR REPLACE FUNCTION public.log_answer_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.exam_attempt_logs (
    attempt_id,
    action,
    question_id,
    action_data
  ) VALUES (
    NEW.attempt_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'answer_saved' ELSE 'answer_changed' END,
    NEW.question_id,
    jsonb_build_object(
      'answer_source', NEW.answer_source,
      'has_text', NEW.answer_text IS NOT NULL,
      'has_options', NEW.answer_options IS NOT NULL
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_answer_changes
  AFTER INSERT OR UPDATE ON public.student_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.log_answer_change();

-- Prevent answer changes to locked/submitted attempts
CREATE OR REPLACE FUNCTION public.validate_answer_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_submitted BOOLEAN;
  v_is_locked BOOLEAN;
BEGIN
  SELECT is_submitted, is_locked 
  INTO v_is_submitted, v_is_locked
  FROM public.student_exam_attempts 
  WHERE id = NEW.attempt_id;
  
  IF v_is_submitted = true THEN
    RAISE EXCEPTION 'Cannot modify answers for submitted attempt';
  END IF;
  
  IF v_is_locked = true THEN
    RAISE EXCEPTION 'Cannot modify answers for locked attempt';
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_answer_before_save
  BEFORE INSERT OR UPDATE ON public.student_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_answer_submission();

-- Create placeholder answers for offline exams
CREATE OR REPLACE FUNCTION public.create_offline_placeholder_answers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_mode public.exam_mode;
  v_question RECORD;
BEGIN
  -- Check exam mode
  SELECT exam_mode INTO v_exam_mode
  FROM public.exams WHERE id = NEW.exam_id;
  
  -- For offline exams, create placeholder answers
  IF v_exam_mode IN ('offline', 'hybrid') AND NEW.is_submitted = true THEN
    FOR v_question IN 
      SELECT eq.id as question_id
      FROM public.exam_questions eq
      JOIN public.exam_sections es ON es.id = eq.section_id
      WHERE es.exam_id = NEW.exam_id
      AND NOT EXISTS (
        SELECT 1 FROM public.student_answers sa
        WHERE sa.attempt_id = NEW.id AND sa.question_id = eq.id
      )
    LOOP
      INSERT INTO public.student_answers (
        attempt_id,
        question_id,
        answer_source,
        ocr_needs_review
      ) VALUES (
        NEW.id,
        v_question.question_id,
        'offline_ocr',
        true -- All offline answers need OCR review
      );
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER create_offline_placeholders
  AFTER UPDATE ON public.student_exam_attempts
  FOR EACH ROW
  WHEN (NEW.is_submitted = true AND OLD.is_submitted = false)
  EXECUTE FUNCTION public.create_offline_placeholder_answers();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE public.exam_attempt_logs ENABLE ROW LEVEL SECURITY;

-- =============================================
-- EXAM_ATTEMPT_LOGS POLICIES
-- =============================================

CREATE POLICY "Super admins can view all attempt logs"
  ON public.exam_attempt_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can view attempt logs in their institution"
  ON public.exam_attempt_logs FOR SELECT
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(public.get_attempt_exam_id(attempt_id))
    )
  );

CREATE POLICY "Teachers can view attempt logs for assigned classes"
  ON public.exam_attempt_logs FOR SELECT
  USING (
    public.can_evaluate_attempt(auth.uid(), attempt_id)
  );

CREATE POLICY "Students can view own attempt logs"
  ON public.exam_attempt_logs FOR SELECT
  USING (
    public.get_attempt_student_id(attempt_id) = auth.uid()
  );

-- Logs are created by triggers, not directly by users

-- =============================================
-- GRANT VIEW ACCESS
-- =============================================

-- Grant access to the eligibility view
GRANT SELECT ON public.student_eligible_exams TO authenticated;

-- =============================================
-- FUNCTION FOR STUDENTS TO START ATTEMPT
-- =============================================

CREATE OR REPLACE FUNCTION public.start_exam_attempt(
  _exam_id UUID,
  _class_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
  v_student_id UUID;
  v_existing_attempt UUID;
BEGIN
  v_student_id := auth.uid();
  
  -- Check for existing attempt
  SELECT id INTO v_existing_attempt
  FROM public.student_exam_attempts
  WHERE exam_id = _exam_id AND student_id = v_student_id;
  
  IF v_existing_attempt IS NOT NULL THEN
    -- Return existing attempt if not submitted
    IF EXISTS (
      SELECT 1 FROM public.student_exam_attempts 
      WHERE id = v_existing_attempt AND is_submitted = false
    ) THEN
      -- Log resume
      INSERT INTO public.exam_attempt_logs (attempt_id, action)
      VALUES (v_existing_attempt, 'resumed');
      
      RETURN v_existing_attempt;
    ELSE
      RAISE EXCEPTION 'Exam already submitted';
    END IF;
  END IF;
  
  -- Create new attempt
  INSERT INTO public.student_exam_attempts (
    exam_id,
    student_id,
    class_id
  ) VALUES (
    _exam_id,
    v_student_id,
    _class_id
  ) RETURNING id INTO v_attempt_id;
  
  RETURN v_attempt_id;
END;
$$;

-- =============================================
-- FUNCTION TO SUBMIT ATTEMPT
-- =============================================

CREATE OR REPLACE FUNCTION public.submit_exam_attempt(
  _attempt_id UUID,
  _auto_submit BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id UUID;
BEGIN
  v_student_id := auth.uid();
  
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1 FROM public.student_exam_attempts
    WHERE id = _attempt_id AND student_id = v_student_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to submit this attempt';
  END IF;
  
  -- Submit
  UPDATE public.student_exam_attempts
  SET 
    is_submitted = true,
    auto_submitted = _auto_submit
  WHERE id = _attempt_id
    AND is_submitted = false;
  
  RETURN true;
END;
$$;

-- =============================================
-- FUNCTION TO SAVE ANSWER
-- =============================================

CREATE OR REPLACE FUNCTION public.save_exam_answer(
  _attempt_id UUID,
  _question_id UUID,
  _answer_text TEXT DEFAULT NULL,
  _answer_options JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_answer_id UUID;
  v_student_id UUID;
BEGIN
  v_student_id := auth.uid();
  
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1 FROM public.student_exam_attempts
    WHERE id = _attempt_id 
      AND student_id = v_student_id
      AND is_submitted = false
      AND is_locked = false
  ) THEN
    RAISE EXCEPTION 'Not authorized to save answers to this attempt';
  END IF;
  
  -- Upsert answer
  INSERT INTO public.student_answers (
    attempt_id,
    question_id,
    answer_source,
    answer_text,
    answer_options,
    answered_at
  ) VALUES (
    _attempt_id,
    _question_id,
    'online',
    _answer_text,
    _answer_options,
    now()
  )
  ON CONFLICT (attempt_id, question_id) 
  DO UPDATE SET
    answer_text = EXCLUDED.answer_text,
    answer_options = EXCLUDED.answer_options,
    answered_at = now(),
    updated_at = now()
  RETURNING id INTO v_answer_id;
  
  RETURN v_answer_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.start_exam_attempt TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_exam_answer TO authenticated;