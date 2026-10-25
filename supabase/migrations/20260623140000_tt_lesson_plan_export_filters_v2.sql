-- Cascading filter options for the lesson-plan export dialog.
-- Adds `combos` (the distinct teacher x class x section x subject tuples that
-- actually exist in tt_slots within scope) so the dialog can constrain each
-- dropdown by the others (faceted filtering) — e.g. choosing a class narrows
-- the teacher/subject lists to only that class's teachers/subjects.
-- Read-only; same scope resolution as before (tt_user_can_edit_class_slots).
CREATE OR REPLACE FUNCTION public.tt_lesson_plan_export_filters(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_super boolean;
  v_is_admin boolean;
  v_inst uuid;
  v_ay_code text;
  v_class_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_is_super := has_role(v_uid, 'super_admin');
  v_is_admin := v_is_super OR has_role(v_uid, 'school_admin') OR has_role(v_uid, 'super_school_admin');
  v_inst := CASE WHEN v_is_super THEN COALESCE(p_institution_id, get_user_institution(v_uid))
                 ELSE get_user_institution(v_uid) END;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'no institution context'; END IF;
  IF NOT (v_is_admin OR has_role(v_uid, 'coordinator')) THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT code INTO v_ay_code FROM cal_academic_years
  WHERE institution_id = v_inst
  ORDER BY ((now()::date) BETWEEN starts_on AND ends_on) DESC, is_active DESC, starts_on DESC LIMIT 1;

  SELECT array_agg(c.id) INTO v_class_ids
  FROM classes c
  WHERE c.institution_id = v_inst AND COALESCE(c.is_active, true)
    AND public.tt_user_can_edit_class_slots(v_uid, c.id);

  RETURN jsonb_build_object(
    'academic_year', v_ay_code,
    'class_groups', (
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', cg.id, 'name', cg.name)), '[]'::jsonb)
      FROM classes c JOIN class_groups cg ON cg.id = c.class_group_id
      WHERE c.id = ANY(v_class_ids)),
    'sections', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'class', COALESCE(cg.name, c.name), 'section', c.section,
                'class_group_id', c.class_group_id) ORDER BY COALESCE(cg.name, c.name), c.section), '[]'::jsonb)
      FROM classes c LEFT JOIN class_groups cg ON cg.id = c.class_group_id
      WHERE c.id = ANY(v_class_ids)),
    'teachers', (
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'name', p.full_name)), '[]'::jsonb)
      FROM tt_slots s JOIN profiles p ON p.id = s.teacher_id
      WHERE s.class_id = ANY(v_class_ids) AND s.teacher_id IS NOT NULL AND s.academic_year = v_ay_code),
    'subjects', (
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', us.id, 'name', us.name)), '[]'::jsonb)
      FROM tt_slots s JOIN universal_subjects us ON us.id = s.subject_id
      WHERE s.class_id = ANY(v_class_ids) AND s.subject_id IS NOT NULL AND s.academic_year = v_ay_code),
    -- The actual tuples that exist — drives cascading/faceted dropdowns on the client.
    'combos', (
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
                'class_group_id', c.class_group_id, 'section_id', s.class_id,
                'teacher_id', s.teacher_id, 'subject_id', s.subject_id)), '[]'::jsonb)
      FROM tt_slots s JOIN classes c ON c.id = s.class_id
      WHERE s.class_id = ANY(v_class_ids) AND s.teacher_id IS NOT NULL AND s.subject_id IS NOT NULL
        AND s.academic_year = v_ay_code)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.tt_lesson_plan_export_filters(uuid) TO authenticated;
