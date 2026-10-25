-- Teacher-scoped student distribution with an optional class filter.
--
-- dash_scoped_student_distribution() takes no arguments, so "Where your students
-- stand" could only ever pool every class the teacher touches. A teacher with
-- three classes had no way to ask "how is 11-B doing?".
--
-- This variant adds p_class_id and NOTHING ELSE. NULL means "all my classes",
-- so the widget's default is byte-identical to today.
--
-- The band logic is COPIED VERBATIM from the shared function, not reinvented:
--   * the metric is each pupil's LATEST result — DISTINCT ON (student_id)
--     ordered by coalesce(finalized_at, created_at) DESC — not an average;
--   * the bands are > 70 doing well, 50..70 catching up, < 50 needs help.
-- A first attempt here used an average and 75/50 thresholds and produced
-- 0/1/8 where the shared function gives 5/1/3 for the same class. If the shared
-- bands ever change, change them here in the same commit.
--
-- NOTE, inherited from the shared function and deliberately left alone: this
-- counts results across every subject examined in the class, not only the
-- caller's. Making it subject-specific would move every number on the card, so
-- it is flagged separately rather than changed under cover of adding a filter.
CREATE OR REPLACE FUNCTION public.dash_teacher_student_distribution(p_class_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_classes uuid[];
  v_dw int; v_cu int; v_nh int; v_total int; v_eval int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(auth.uid());

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('doing_well', 0, 'catching_up', 0, 'needs_help', 0,
                              'total', 0, 'evaluated', 0);
  END IF;

  -- A caller-supplied class must be one of mine; otherwise the parameter could
  -- widen scope, which is the one thing this family must never allow.
  IF p_class_id IS NOT NULL THEN
    IF NOT (p_class_id = ANY(v_classes)) THEN
      RAISE EXCEPTION 'dashboard: class not in scope';
    END IF;
    v_classes := ARRAY[p_class_id];
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (a.student_id) a.student_id, fr.percentage
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id AND a.class_id = ANY(v_classes)
      JOIN exams e ON e.id = a.exam_id
                  AND e.institution_id = v_inst
                  AND e.status IN ('published','active','completed')
     ORDER BY a.student_id, coalesce(fr.finalized_at, fr.created_at) DESC
  )
  SELECT count(*) FILTER (WHERE percentage > 70),
         count(*) FILTER (WHERE percentage BETWEEN 50 AND 70),
         count(*) FILTER (WHERE percentage < 50),
         count(*)
    INTO v_dw, v_cu, v_nh, v_eval
    FROM latest;

  SELECT count(*) INTO v_total
    FROM class_assignments
   WHERE role = 'student' AND class_id = ANY(v_classes);

  RETURN jsonb_build_object('doing_well', v_dw, 'catching_up', v_cu, 'needs_help', v_nh,
                            'total', v_total, 'evaluated', v_eval);
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_student_distribution(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_student_distribution(uuid) TO authenticated;
