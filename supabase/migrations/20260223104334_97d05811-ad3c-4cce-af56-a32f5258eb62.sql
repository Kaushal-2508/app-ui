
-- Create helper function for institution-level admin checks
CREATE OR REPLACE FUNCTION public.is_institution_admin(_user_id uuid, _institution_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user_id
    AND ur.role IN ('super_school_admin', 'school_admin')
    AND p.institution_id = _institution_id
  )
$$;

-- Update can_manage_subjects to include super_school_admin
CREATE OR REPLACE FUNCTION public.can_manage_subjects(_user_id uuid, _inst_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN profiles p ON p.id = _user_id
    WHERE ur.user_id = _user_id
    AND (
      ur.role = 'super_admin'
      OR (ur.role IN ('school_admin', 'super_school_admin') AND p.institution_id = _inst_id)
    )
  )
$$;

-- Update can_create_tasks to include super_school_admin
CREATE OR REPLACE FUNCTION public.can_create_tasks(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
    AND role IN ('super_school_admin'::public.app_role, 'school_admin'::public.app_role, 'coordinator'::public.app_role, 'teacher'::public.app_role)
  )
$$;

-- Update can_add_topics_to_class to include super_school_admin
CREATE OR REPLACE FUNCTION public.can_add_topics_to_class(_user_id uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN profiles p ON p.id = _user_id
    JOIN classes c ON c.id = _class_id
    WHERE ur.user_id = _user_id
    AND (
      ur.role = 'super_admin'
      OR (ur.role IN ('school_admin', 'super_school_admin') AND p.institution_id = c.institution_id)
      OR (ur.role = 'coordinator' AND public.is_coordinator_for_class(_user_id, _class_id))
      OR (ur.role = 'teacher' AND EXISTS (
        SELECT 1 FROM class_assignments ca 
        WHERE ca.user_id = _user_id AND ca.class_id = _class_id AND ca.role = 'teacher'
      ))
    )
  )
$$;

-- Update prevent_exam_structure_change to include super_school_admin
CREATE OR REPLACE FUNCTION public.prevent_exam_structure_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
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
  IF TG_TABLE_NAME = 'exam_sections' THEN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  ELSIF TG_TABLE_NAME = 'exam_questions' THEN
    v_exam_id := public.get_section_exam_id(COALESCE(NEW.section_id, OLD.section_id));
  ELSIF TG_TABLE_NAME = 'exam_classes' OR TG_TABLE_NAME = 'exam_subjects' THEN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  END IF;
  
  SELECT status, created_by, institution_id 
  INTO v_exam_status, v_exam_created_by, v_exam_institution 
  FROM public.exams WHERE id = v_exam_id;
  
  IF v_exam_status IS NULL OR v_exam_status = 'draft' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    v_is_super_admin := public.is_super_admin(auth.uid());
    v_is_creator := (auth.uid() = v_exam_created_by);
    
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('school_admin', 'super_school_admin')
      AND institution_id = v_exam_institution
    ) INTO v_is_school_admin_of_institution;
    
    IF v_is_super_admin OR v_is_creator OR v_is_school_admin_of_institution THEN
      RETURN OLD;
    END IF;
  END IF;
  
  RAISE EXCEPTION 'Cannot modify exam structure after publishing. Exam status: %', v_exam_status;
END;
$function$;
