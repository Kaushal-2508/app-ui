-- Allow answer updates for offline OCR/evaluation scenarios
-- This modifies the existing trigger to permit updates for offline exams until finalized

CREATE OR REPLACE FUNCTION public.validate_answer_submission()
RETURNS TRIGGER AS $$
DECLARE
  v_is_submitted BOOLEAN;
  v_is_locked BOOLEAN;
  v_is_finalized BOOLEAN;
  v_exam_mode TEXT;
BEGIN
  SELECT 
    sea.is_submitted, 
    sea.is_locked,
    sea.is_finalized,
    e.exam_mode
  INTO v_is_submitted, v_is_locked, v_is_finalized, v_exam_mode
  FROM public.student_exam_attempts sea
  JOIN public.exams e ON e.id = sea.exam_id
  WHERE sea.id = NEW.attempt_id;
  
  -- Allow updates for offline exams (OCR/evaluation workflow)
  IF v_exam_mode = 'offline' THEN
    -- For offline: only block if fully finalized
    IF v_is_finalized = true THEN
      RAISE EXCEPTION 'Cannot modify answers for finalized attempt';
    END IF;
    RETURN NEW;
  END IF;
  
  -- Original logic for online exams - block after submission
  IF v_is_submitted = true THEN
    RAISE EXCEPTION 'Cannot modify answers for submitted attempt';
  END IF;
  
  IF v_is_locked = true THEN
    RAISE EXCEPTION 'Cannot modify answers for locked attempt';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;