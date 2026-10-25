
-- =============================================
-- FIX: Cast action strings to attempt_action enum in trigger functions
-- =============================================

-- Fix log_answer_change function
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
    (CASE WHEN TG_OP = 'INSERT' THEN 'answer_saved' ELSE 'answer_changed' END)::attempt_action,
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

-- Fix log_attempt_submission function
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
      (CASE WHEN NEW.auto_submitted THEN 'auto_submitted' ELSE 'submitted' END)::attempt_action,
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

-- Fix start_exam_attempt function (resumed action)
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
      -- Log resume with proper enum cast
      INSERT INTO public.exam_attempt_logs (attempt_id, action)
      VALUES (v_existing_attempt, 'resumed'::attempt_action);
      
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
  
  -- Log started with proper enum cast
  INSERT INTO public.exam_attempt_logs (attempt_id, action)
  VALUES (v_attempt_id, 'started'::attempt_action);
  
  RETURN v_attempt_id;
END;
$$;

-- =============================================
-- FIX: Ensure students are visible in students list (profile RLS)
-- =============================================

-- Drop any existing conflicting policies  
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in same institution" ON public.profiles;

-- Recreate policies to ensure proper visibility
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Users can view profiles in same institution"
ON public.profiles FOR SELECT
TO authenticated
USING (
  institution_id IS NOT NULL
  AND (
    institution_id = public.get_user_institution(auth.uid())
    OR public.has_super_admin_access(auth.uid())
  )
);
