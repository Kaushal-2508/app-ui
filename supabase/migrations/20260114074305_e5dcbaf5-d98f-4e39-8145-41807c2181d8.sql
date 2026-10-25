-- Modify the trigger function to allow full exam deletion by authorized users
-- while still blocking individual structure changes to published exams

CREATE OR REPLACE FUNCTION public.prevent_exam_structure_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_id UUID;
  v_exam_status public.exam_status;
  v_exam_created_by UUID;
  v_user_institution UUID;
  v_exam_institution UUID;
  v_is_super_admin BOOLEAN;
  v_is_school_admin_of_institution BOOLEAN;
  v_is_creator BOOLEAN;
BEGIN
  -- Get the exam_id based on the table
  IF TG_TABLE_NAME = 'exam_sections' THEN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  ELSIF TG_TABLE_NAME = 'exam_questions' THEN
    v_exam_id := public.get_section_exam_id(COALESCE(NEW.section_id, OLD.section_id));
  ELSIF TG_TABLE_NAME = 'exam_classes' OR TG_TABLE_NAME = 'exam_subjects' THEN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  END IF;
  
  -- Get exam details
  SELECT status, created_by, institution_id 
  INTO v_exam_status, v_exam_created_by, v_exam_institution 
  FROM public.exams 
  WHERE id = v_exam_id;
  
  -- If exam is draft, allow all operations
  IF v_exam_status IS NULL OR v_exam_status = 'draft' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  
  -- For non-draft exams, check if this is a DELETE operation
  -- DELETE is allowed for authorized users (super admin, school admin, or creator)
  IF TG_OP = 'DELETE' THEN
    -- Check if user is super admin
    v_is_super_admin := public.is_super_admin(auth.uid());
    
    -- Check if user is the creator
    v_is_creator := (auth.uid() = v_exam_created_by);
    
    -- Check if user is school admin of the exam's institution
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'school_admin'
      AND institution_id = v_exam_institution
    ) INTO v_is_school_admin_of_institution;
    
    -- Allow DELETE if user is authorized
    IF v_is_super_admin OR v_is_creator OR v_is_school_admin_of_institution THEN
      RETURN OLD;
    END IF;
  END IF;
  
  -- Block all other changes (INSERT, UPDATE for non-draft, or unauthorized DELETE)
  RAISE EXCEPTION 'Cannot modify exam structure after publishing. Exam status: %', v_exam_status;
END;
$$;