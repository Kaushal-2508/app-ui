-- Student dashboard: overall class standing tile (replaces the fees tile).
-- Read-only SECURITY DEFINER. Returns ONLY the calling student's de-identified
-- percentile (cume_dist) among classmates by OVERALL average across published
-- results — no classmate identity/marks leave. Same cohort + pattern as the
-- other student_* comparison RPCs (20260622120000).
CREATE OR REPLACE FUNCTION public.student_overall_class_standing()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_classes uuid[];
  v_cd numeric; v_n int; v_my_avg numeric; v_class_avg numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_classes := public.student_resolve_classes();

  WITH per_student AS (
    SELECT a.student_id, avg(fr.percentage) AS avg_pct
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE fr.is_published = true AND a.class_id = ANY(v_classes)
    GROUP BY a.student_id
  ),
  ranked AS (
    SELECT student_id, avg_pct, cume_dist() OVER (ORDER BY avg_pct) AS cd
    FROM per_student
  )
  SELECT (SELECT cd FROM ranked WHERE student_id = v_uid LIMIT 1),
         count(*),
         (SELECT avg_pct FROM per_student WHERE student_id = v_uid LIMIT 1),
         round(avg(avg_pct), 1)
    INTO v_cd, v_n, v_my_avg, v_class_avg
  FROM per_student;

  IF v_my_avg IS NULL THEN
    RETURN jsonb_build_object('has_data', false);
  END IF;

  RETURN jsonb_build_object(
    'has_data', true,
    'student_percentile', CASE WHEN v_cd IS NULL THEN NULL ELSE round(v_cd * 100)::int END,
    'cohort_size', v_n,
    'student_avg', round(v_my_avg, 1),
    'class_avg', v_class_avg
  );
END $$;

GRANT EXECUTE ON FUNCTION public.student_overall_class_standing() TO authenticated;
