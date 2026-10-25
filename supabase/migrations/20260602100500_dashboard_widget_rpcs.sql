-- Dashboard rebuild Phase 1 — Tasks 6-10
-- Widget RPCs: attendance trend, subjects-by-performance, student distribution, exam trend, heatmap.

-- 6) Attendance trend: daily school-wide % over p_days, plus all-time average.
CREATE OR REPLACE FUNCTION public.dash_attendance_trend(p_days int DEFAULT 30, p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.date, 'present', d.present, 'total', d.total,
           'pct', CASE WHEN d.total>0 THEN round(d.present*100.0/d.total,1) END) ORDER BY d.date), '[]'::jsonb)
    INTO v_points
  FROM (
    SELECT date,
           count(*) FILTER (WHERE status IN ('present','late')) AS present,
           count(*) AS total
    FROM attendance_records
    WHERE institution_id = v_inst AND date > v_today - p_days AND date <= v_today
    GROUP BY date
  ) d;

  SELECT round((count(*) FILTER (WHERE status IN ('present','late')))*100.0 / NULLIF(count(*),0), 1)
    INTO v_all
  FROM attendance_records WHERE institution_id = v_inst;

  RETURN jsonb_build_object('points', v_points, 'all_time_avg', v_all);
END $$;

-- 7) Subjects-by-performance for one class + the school reference per subject.
CREATE OR REPLACE FUNCTION public.dash_subject_performance(p_class_id uuid, p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  WITH res AS (
    SELECT a.class_id, es.subject_id, us.name AS subject_name, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
  ),
  class_avg AS (
    SELECT subject_id, subject_name, round(avg(percentage),1) AS class_avg
    FROM res WHERE class_id = p_class_id GROUP BY subject_id, subject_name
  ),
  school_avg AS (
    SELECT subject_id, round(avg(percentage),1) AS school_avg FROM res GROUP BY subject_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'subject_id', c.subject_id, 'subject_name', c.subject_name,
           'class_avg', c.class_avg, 'school_avg', s.school_avg) ORDER BY c.class_avg ASC), '[]'::jsonb)
    INTO v_rows
  FROM class_avg c LEFT JOIN school_avg s USING (subject_id);

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $$;

-- 8) Student distribution (school-wide), using each student's latest finalized result.
CREATE OR REPLACE FUNCTION public.dash_student_distribution(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_dw int; v_cu int; v_nh int; v_total int; v_eval int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  WITH latest AS (
    SELECT DISTINCT ON (a.student_id) a.student_id, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
    ORDER BY a.student_id, coalesce(fr.finalized_at, fr.created_at) DESC
  )
  SELECT count(*) FILTER (WHERE percentage > 70),
         count(*) FILTER (WHERE percentage BETWEEN 50 AND 70),
         count(*) FILTER (WHERE percentage < 50),
         count(*)
    INTO v_dw, v_cu, v_nh, v_eval
  FROM latest;

  SELECT count(*) INTO v_total
  FROM class_assignments WHERE role = 'student'
    AND class_id IN (SELECT id FROM classes WHERE institution_id = v_inst);

  RETURN jsonb_build_object('doing_well', v_dw, 'catching_up', v_cu, 'needs_help', v_nh,
                            'total', v_total, 'evaluated', v_eval);
END $$;

-- 9) Exam performance trend: last p_limit published exams, chronological.
CREATE OR REPLACE FUNCTION public.dash_exam_trend(p_limit int DEFAULT 8, p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  WITH recent AS (
    SELECT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
    FROM exams e
    WHERE e.institution_id = v_inst AND e.status IN ('published','active','completed')
    ORDER BY exam_date DESC NULLS LAST
    LIMIT p_limit
  ),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date,
           round(avg(fr.percentage),1) AS avg_pct,
           count(fr.id) AS participation
    FROM recent r
    LEFT JOIN student_exam_attempts a ON a.exam_id = r.id
    LEFT JOIN final_results fr ON fr.attempt_id = a.id
    GROUP BY r.id, r.title, r.exam_type, r.exam_date
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'exam_id', id, 'title', title, 'exam_type', exam_type,
           'avg_pct', avg_pct, 'participation', participation, 'exam_date', exam_date)
           ORDER BY exam_date ASC), '[]'::jsonb)
    INTO v_rows FROM agg;
  RETURN v_rows;
END $$;

-- 10) Class x Subject heatmap. Rows = wings (if configured), else CBSE grade-number bands.
CREATE OR REPLACE FUNCTION public.dash_subject_heatmap(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_use_wings boolean; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT EXISTS (SELECT 1 FROM wings w WHERE w.institution_id = v_inst AND coalesce(w.is_active,true)
                 AND EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.wing_id = w.id))
    INTO v_use_wings;

  WITH res AS (
    SELECT a.class_id, es.subject_id, us.name AS subject_name, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
  ),
  banded AS (
    SELECT r.*,
      CASE
        WHEN v_use_wings THEN (SELECT w.name FROM wing_class_mappings m JOIN wings w ON w.id = m.wing_id
                               WHERE m.class_id = r.class_id LIMIT 1)
        ELSE (
          SELECT CASE
                   WHEN gl.grade_number BETWEEN 1 AND 5  THEN 'Primary'
                   WHEN gl.grade_number BETWEEN 6 AND 8  THEN 'Middle'
                   WHEN gl.grade_number BETWEEN 9 AND 10 THEN 'Secondary'
                   WHEN gl.grade_number BETWEEN 11 AND 12 THEN 'Senior Secondary'
                   WHEN gl.grade_number < 1 THEN 'Pre-Primary'
                   ELSE 'Other'
                 END
          FROM classes c JOIN class_groups cg ON cg.id = c.class_group_id
                         LEFT JOIN grade_levels gl ON gl.id = cg.grade_level_id
          WHERE c.id = r.class_id
        )
      END AS band_label,
      CASE
        WHEN v_use_wings THEN (SELECT w.display_order FROM wing_class_mappings m JOIN wings w ON w.id = m.wing_id
                               WHERE m.class_id = r.class_id LIMIT 1)
        ELSE (SELECT gl.grade_number FROM classes c JOIN class_groups cg ON cg.id = c.class_group_id
              LEFT JOIN grade_levels gl ON gl.id = cg.grade_level_id WHERE c.id = r.class_id)
      END AS band_order
    FROM res r
  ),
  cells AS (
    -- group columns by NORMALISED subject name (universal_subjects has per-grade duplicate rows)
    SELECT coalesce(band_label,'Other') AS band_label, min(band_order) AS band_order,
           initcap(lower(btrim(subject_name))) AS subject_name,
           round(avg(percentage),1) AS avg_pct
    FROM banded
    GROUP BY coalesce(band_label,'Other'), initcap(lower(btrim(subject_name)))
  )
  SELECT coalesce(jsonb_agg(row_to_json(g)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT band_label,
      jsonb_agg(jsonb_build_object(
        'subject_name', subject_name, 'avg_pct', avg_pct,
        'band', CASE WHEN avg_pct < 50 THEN 'red' WHEN avg_pct <= 70 THEN 'amber' ELSE 'green' END)
        ORDER BY subject_name) AS cells
    FROM cells
    GROUP BY band_label
    ORDER BY min(band_order) NULLS LAST
  ) g;

  RETURN jsonb_build_object('grouping', CASE WHEN v_use_wings THEN 'wings' ELSE 'grade' END, 'rows', v_rows);
END $$;

GRANT EXECUTE ON FUNCTION public.dash_attendance_trend(int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_subject_performance(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_student_distribution(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_exam_trend(int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_subject_heatmap(uuid) TO authenticated;
