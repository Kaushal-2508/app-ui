-- =====================================================================
-- Homework & Assignment — Phase 7: role-scoped marks analytics rollup.
-- SECURITY DEFINER; scope derived from caller role within _institution_id:
--   admin/super_admin -> all institution classes
--   coordinator       -> wing classes (wing_assignments/wing_class_mappings)
--   teacher           -> own class_assignments classes
-- Aggregates carries-marks, published/checked assignments. Separate from
-- exam metrics; never writes report cards.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.homework_analytics_rollup(_institution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_is_admin   boolean;
  v_is_coord   boolean;
  v_is_teacher boolean;
  v_result     jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF _institution_id IS NULL THEN RAISE EXCEPTION 'Institution is required.'; END IF;

  v_is_admin   := public.is_super_admin(v_uid) OR public.is_institution_admin(v_uid, _institution_id);
  v_is_coord   := (NOT v_is_admin)
                  AND public.has_role(v_uid, 'coordinator'::app_role)
                  AND public.get_user_institution(v_uid) = _institution_id;
  v_is_teacher := (NOT v_is_admin) AND (NOT v_is_coord)
                  AND public.has_role(v_uid, 'teacher'::app_role)
                  AND public.get_user_institution(v_uid) = _institution_id;

  IF NOT (v_is_admin OR v_is_coord OR v_is_teacher) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  WITH scoped_classes AS (
    SELECT c.id AS class_id
    FROM public.classes c
    WHERE c.institution_id = _institution_id
      AND (
        v_is_admin
        OR (v_is_coord AND public.is_coordinator_for_class(v_uid, c.id))
        OR (v_is_teacher AND EXISTS (
              SELECT 1 FROM public.class_assignments ca
              WHERE ca.user_id = v_uid AND ca.class_id = c.id AND ca.role = 'teacher'))
      )
  ),
  scoped_assignments AS (
    SELECT DISTINCT h.id, h.max_marks
    FROM public.homework_assignments h
    JOIN public.homework_assignment_classes hac ON hac.homework_assignment_id = h.id
    JOIN scoped_classes sc ON sc.class_id = hac.class_id
    WHERE h.institution_id = _institution_id
      AND h.carries_marks = true
      AND h.status IN ('published','checked')
  ),
  graded AS (
    SELECT r.marks_awarded, sa.max_marks
    FROM public.homework_results r
    JOIN scoped_assignments sa ON sa.id = r.homework_assignment_id
    WHERE r.status = 'graded' AND r.marks_awarded IS NOT NULL AND sa.max_marks > 0
  ),
  subs AS (
    SELECT s.is_late
    FROM public.homework_submissions s
    JOIN scoped_assignments sa ON sa.id = s.homework_assignment_id
  ),
  expected AS (
    SELECT count(*)::numeric AS slots
    FROM scoped_assignments sa
    JOIN public.homework_assignment_classes hac ON hac.homework_assignment_id = sa.id
    JOIN public.class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
  )
  SELECT jsonb_build_object(
    'total_assignments', (SELECT count(*) FROM scoped_assignments),
    'graded_count',      (SELECT count(*) FROM graded),
    'avg_percentage',    (SELECT round(avg(marks_awarded / max_marks * 100), 1) FROM graded),
    'submission_count',  (SELECT count(*) FROM subs),
    'expected_count',    (SELECT slots FROM expected),
    'submission_rate',   (SELECT CASE WHEN (SELECT slots FROM expected) > 0
                            THEN round(((SELECT count(*) FROM subs)::numeric / (SELECT slots FROM expected)) * 100, 1)
                            ELSE NULL END),
    'on_time_rate',      (SELECT CASE WHEN count(*) > 0
                            THEN round((count(*) FILTER (WHERE is_late = false))::numeric / count(*) * 100, 1)
                            ELSE NULL END FROM subs),
    'computed_at',       now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_analytics_rollup(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_analytics_rollup(uuid) TO authenticated;
