-- Dashboard rebuild Phase 3 — Task 1
-- Deterministic flag->assignee resolution (spec §8.4): class teacher -> wing coordinator -> principal.

CREATE OR REPLACE FUNCTION public.resolve_flag_assignee(
  p_institution_id uuid, p_subject_type text, p_subject_key text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_class uuid;
BEGIN
  IF p_subject_type = 'class' THEN
    BEGIN v_class := p_subject_key::uuid; EXCEPTION WHEN others THEN v_class := NULL; END;
  ELSIF p_subject_type = 'student' THEN
    SELECT ca.class_id INTO v_class FROM class_assignments ca
      WHERE ca.user_id = p_subject_key::uuid AND ca.role='student' LIMIT 1;
  ELSIF p_subject_type = 'exam' THEN
    SELECT ec.class_id INTO v_class FROM exam_classes ec WHERE ec.exam_id = p_subject_key::uuid LIMIT 1;
  END IF;

  IF v_class IS NOT NULL THEN
    SELECT ca.user_id INTO v_uid FROM class_assignments ca
      WHERE ca.class_id = v_class AND ca.role='teacher' AND ca.subject_id IS NULL LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
    SELECT wa.user_id INTO v_uid FROM wing_class_mappings m
      JOIN wing_assignments wa ON wa.wing_id = m.wing_id
      WHERE m.class_id = v_class LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  IF p_subject_type = 'subject' THEN
    SELECT ca.user_id INTO v_uid FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_institution_id
      WHERE ca.role='teacher' AND ca.subject_id = p_subject_key::uuid LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  -- fallback: a school_admin (the principal)
  SELECT ur.user_id INTO v_uid FROM user_roles ur
    WHERE ur.institution_id = p_institution_id AND ur.role = 'school_admin' LIMIT 1;
  RETURN v_uid;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_flag_assignee(uuid,text,text) TO authenticated;
