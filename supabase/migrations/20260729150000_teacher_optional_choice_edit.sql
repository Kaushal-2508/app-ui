-- =============================================================
-- Teachers can edit optional-group choices for THEIR students
-- -------------------------------------------------------------
-- "Their students" = students of any class the teacher teaches
-- (shared class via class_assignments). Scoped to a NEW helper so
-- teachers do NOT inherit the other powers gated by
-- can_manage_student_subjects (update_student_details /
-- can_edit_student_details also call it — widening it would leak
-- personal-details edit rights to teachers).
--
-- Surfaces switched to the new helper:
--   * get_student_optional_group_assignment.can_manage (UI enable)
--   * set_student_optional_group_choices gate (the Save RPC)
--   * soe_select_manage + soe_update_manage RLS (classification pill
--     does a direct PostgREST UPDATE on student_optional_enrollments)
-- Inserts/deletes on the table stay admin/coordinator-only — the
-- group Save RPC is SECURITY DEFINER and does its own writes.
-- =============================================================

CREATE OR REPLACE FUNCTION public.can_manage_student_optional_choices(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.can_manage_student_subjects(_actor, _student)
    OR (
      public.has_role(_actor, 'teacher')
      AND EXISTS (
        SELECT 1
        FROM public.class_assignments ca_t
        JOIN public.class_assignments ca_s
          ON ca_s.class_id = ca_t.class_id AND ca_s.role = 'student'
        WHERE ca_t.user_id = _actor
          AND ca_t.role = 'teacher'
          AND ca_s.user_id = _student
      )
    );
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_student_optional_choices(uuid, uuid) TO authenticated;

-- -------------------------------------------------------------
-- RLS: let class teachers read + update (classification) their
-- students' enrollment rows. Insert/delete policies untouched.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS soe_select_manage ON public.student_optional_enrollments;
CREATE POLICY soe_select_manage ON public.student_optional_enrollments
  FOR SELECT TO authenticated
  USING (public.can_manage_student_optional_choices((select auth.uid()), student_id));

DROP POLICY IF EXISTS soe_update_manage ON public.student_optional_enrollments;
CREATE POLICY soe_update_manage ON public.student_optional_enrollments
  FOR UPDATE TO authenticated
  USING (public.can_manage_student_optional_choices((select auth.uid()), student_id))
  WITH CHECK (public.can_manage_student_optional_choices((select auth.uid()), student_id));

-- -------------------------------------------------------------
-- Group-assignment read RPC — can_manage now reflects the widened
-- permission so the Subjects tab enables for class teachers.
-- Body otherwise identical to 20260729120000.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_optional_group_assignment(_student uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_view_student_subjects(auth.uid(), _student) THEN
    RAISE EXCEPTION 'Not authorized to view this student''s subjects' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'can_manage', public.can_manage_student_optional_choices(auth.uid(), _student),
    'groups', COALESCE((
      SELECT jsonb_agg(g ORDER BY (g->>'position')::int, g->>'name')
      FROM (
        SELECT DISTINCT ON (og.id) jsonb_build_object(
          'group_id', og.id,
          'name',     og.name,
          'position', og.position,
          'subjects', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('subject_id', us.id, 'name', us.name) ORDER BY us.name), '[]'::jsonb)
            FROM public.optional_group_subjects ogs
            JOIN public.universal_subjects us ON us.id = ogs.subject_id
            WHERE ogs.group_id = og.id
          ),
          'chosen_subject_id', (
            SELECT soe.subject_id
            FROM public.student_optional_enrollments soe
            JOIN public.optional_group_subjects ogs2
              ON ogs2.group_id = og.id AND ogs2.subject_id = soe.subject_id
            WHERE soe.student_id = _student AND soe.is_active = true
            ORDER BY soe.updated_at DESC
            LIMIT 1
          ),
          'chosen_classification', (
            SELECT COALESCE(soe.classification, 'optional')
            FROM public.student_optional_enrollments soe
            JOIN public.optional_group_subjects ogs3
              ON ogs3.group_id = og.id AND ogs3.subject_id = soe.subject_id
            WHERE soe.student_id = _student AND soe.is_active = true
            ORDER BY soe.updated_at DESC
            LIMIT 1
          )
        ) AS g
        FROM public.class_assignments ca
        JOIN public.classes c ON c.id = ca.class_id
        JOIN public.optional_groups og ON og.class_group_id = c.class_group_id
        WHERE ca.user_id = _student AND ca.role = 'student'
      ) grouped
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- -------------------------------------------------------------
-- Save RPC — gate widened to the new helper. Body otherwise
-- identical to 20260729120000.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_student_optional_group_choices(_student uuid, _choices jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst    uuid;
  v_choice  jsonb;
  v_group   uuid;
  v_subject uuid;
BEGIN
  IF NOT public.can_manage_student_optional_choices(auth.uid(), _student) THEN
    RAISE EXCEPTION 'Not authorized to change this student''s subjects' USING ERRCODE = '42501';
  END IF;
  IF _choices IS NULL OR jsonb_typeof(_choices) <> 'array' OR jsonb_array_length(_choices) > 20 THEN
    RAISE EXCEPTION 'Invalid choices payload.' USING ERRCODE = '22023';
  END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = _student;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Student has no institution.' USING ERRCODE = '22023';
  END IF;

  FOR v_choice IN SELECT * FROM jsonb_array_elements(_choices) LOOP
    v_group   := (v_choice->>'group_id')::uuid;
    v_subject := NULLIF(v_choice->>'subject_id', '')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM public.optional_groups og
      WHERE og.id = v_group AND og.institution_id = v_inst
    ) THEN
      RAISE EXCEPTION 'Optional group not found for this student.' USING ERRCODE = '22023';
    END IF;

    IF v_subject IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.optional_group_subjects ogs
      WHERE ogs.group_id = v_group AND ogs.subject_id = v_subject
    ) THEN
      RAISE EXCEPTION 'That subject is not part of this optional group.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.student_optional_enrollments soe
    SET is_active = false, assigned_by = auth.uid()
    WHERE soe.student_id = _student
      AND soe.is_active = true
      AND soe.subject_id IN (
        SELECT ogs.subject_id FROM public.optional_group_subjects ogs WHERE ogs.group_id = v_group
      )
      AND (v_subject IS NULL OR soe.subject_id <> v_subject);

    IF v_subject IS NOT NULL THEN
      INSERT INTO public.student_optional_enrollments (student_id, subject_id, institution_id, is_active, assigned_by)
      VALUES (_student, v_subject, v_inst, true, auth.uid())
      ON CONFLICT (student_id, subject_id)
      DO UPDATE SET is_active = true, assigned_by = EXCLUDED.assigned_by;
    END IF;
  END LOOP;
END;
$$;
