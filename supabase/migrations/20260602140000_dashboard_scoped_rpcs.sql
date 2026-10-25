-- Coordinator/Teacher scoped dashboard — parallel dash_scoped_* RPCs that mirror the
-- admin dash_* RPCs but limit every aggregation to the caller's visible class-set:
--   coordinator -> classes in their assigned wings (wing_assignments -> wing_class_mappings)
--   teacher     -> classes they teach (class_assignments role='teacher')
--   admin       -> all active institution classes (so the scoped page also works for admins)
-- The live admin RPCs are untouched. All functions are SECURITY DEFINER (bypass RLS), so no
-- dashboard_flags RLS change is needed; coordinator/teacher flags are filtered in dash_scoped_get_flags.

-- ============ resolve the caller's visible class_ids (authorizes + returns the set) ============
CREATE OR REPLACE FUNCTION public.dash_resolve_scoped_classes()
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid := public.get_user_institution(auth.uid()); v_ids uuid[];
BEGIN
  IF v_inst IS NULL THEN RAISE EXCEPTION 'dashboard: no institution context'; END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid()
             AND role IN ('school_admin','super_school_admin','super_admin')) THEN
    SELECT array_agg(id) INTO v_ids FROM classes WHERE institution_id=v_inst AND coalesce(is_active,true);
  ELSIF EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='coordinator') THEN
    SELECT array_agg(DISTINCT m.class_id) INTO v_ids
    FROM wing_assignments wa
    JOIN wing_class_mappings m ON m.wing_id = wa.wing_id
    JOIN classes c ON c.id = m.class_id AND c.institution_id = v_inst AND coalesce(c.is_active,true)
    WHERE wa.user_id = auth.uid();
  ELSIF EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='teacher') THEN
    SELECT array_agg(DISTINCT ca.class_id) INTO v_ids
    FROM class_assignments ca
    JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND coalesce(c.is_active,true)
    WHERE ca.user_id = auth.uid() AND ca.role = 'teacher';
  ELSE
    RAISE EXCEPTION 'dashboard: not authorized for the scoped dashboard';
  END IF;
  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END $$;

-- ============ weighted scoring, scoped to a class-set ============
CREATE OR REPLACE FUNCTION public.dash_score_students_scoped(p_institution_id uuid, p_class_ids uuid[], p_weights jsonb DEFAULT NULL)
RETURNS TABLE(student_id uuid, class_id uuid, score int, band text, reason text,
              attendance numeric, recent_pct numeric, trend text, active_flags int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tz text; v_today date;
  w_att int := coalesce((p_weights->>'attendance_gap')::int,30);
  w_quart int := coalesce((p_weights->>'bottom_quartile')::int,30);
  w_drop int := coalesce((p_weights->>'dropped_half')::int,25);
  w_flags int := coalesce((p_weights->>'flag_count')::int,15);
  v_min int := coalesce((p_weights->>'min_score')::int,20);
  b_red int := coalesce((p_weights->>'band_red')::int,55);
  b_amber int := coalesce((p_weights->>'band_amber')::int,35);
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_institution_id;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  RETURN QUERY
  WITH roster AS (
    SELECT ca.user_id AS sid, ca.class_id AS cid
    FROM class_assignments ca WHERE ca.role='student' AND ca.class_id = ANY(p_class_ids)
  ),
  stu_att AS (
    SELECT ar.student_id AS sid,
           round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1) AS pct,
           count(*) AS days
    FROM attendance_records ar
    WHERE ar.institution_id=p_institution_id AND ar.class_id = ANY(p_class_ids)
      AND ar.date > v_today-30 AND ar.date <= v_today GROUP BY ar.student_id
  ),
  cls_att AS (
    SELECT ar.class_id AS cid,
           round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1) AS pct
    FROM attendance_records ar
    WHERE ar.institution_id=p_institution_id AND ar.class_id = ANY(p_class_ids)
      AND ar.date > v_today-30 AND ar.date <= v_today GROUP BY ar.class_id
  ),
  results AS (
    SELECT a.student_id AS sid, a.class_id AS cid, a.exam_id, fr.percentage, coalesce(fr.finalized_at,fr.created_at) AS at
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(p_class_ids)
    JOIN exams e ON e.id=a.exam_id AND e.institution_id=p_institution_id AND e.status IN ('published','active','completed')
  ),
  exam_counts AS (SELECT sid, count(*) AS n FROM results GROUP BY sid),
  ranked AS (SELECT r.*, row_number() OVER (PARTITION BY sid ORDER BY at DESC) AS rn FROM results r),
  recent AS (SELECT rk.sid, rk.cid, rk.exam_id, rk.percentage,
             percent_rank() OVER (PARTITION BY rk.exam_id, rk.cid ORDER BY rk.percentage) AS pr
             FROM ranked rk WHERE rk.rn=1),
  halves AS (SELECT sid, cid, avg(percentage) FILTER (WHERE rn<=3) AS recent_avg,
             avg(percentage) FILTER (WHERE rn>3) AS older_avg FROM ranked GROUP BY sid, cid),
  cls_halves AS (SELECT cid, avg(percentage) FILTER (WHERE rn<=3) AS cls_recent_avg,
             avg(percentage) FILTER (WHERE rn>3) AS cls_older_avg FROM ranked GROUP BY cid),
  flagn AS (SELECT subject_key AS sid_text, count(*) AS n FROM dashboard_flags
            WHERE institution_id=p_institution_id AND resolved_at IS NULL AND subject_type='student' GROUP BY subject_key),
  scored AS (
    SELECT ro.sid, ro.cid, sa.pct AS att_pct, re.percentage AS rec_pct, sa.days AS att_days, ec.n AS exam_n,
      (sa.pct IS NOT NULL AND ca2.pct IS NOT NULL AND (ca2.pct-sa.pct)>15) AS f_att,
      (re.pr IS NOT NULL AND re.pr<=0.25) AS f_quart,
      (h.older_avg IS NOT NULL AND ch.cls_older_avg IS NOT NULL AND ch.cls_recent_avg IS NOT NULL
        AND h.older_avg>=ch.cls_older_avg AND h.recent_avg<ch.cls_recent_avg) AS f_drop,
      (coalesce(fn.n,0)>=3) AS f_flags, coalesce(fn.n,0) AS flag_n
    FROM roster ro
    LEFT JOIN stu_att sa ON sa.sid=ro.sid
    LEFT JOIN cls_att ca2 ON ca2.cid=ro.cid
    LEFT JOIN recent re ON re.sid=ro.sid
    LEFT JOIN halves h ON h.sid=ro.sid
    LEFT JOIN cls_halves ch ON ch.cid=ro.cid
    LEFT JOIN exam_counts ec ON ec.sid=ro.sid
    LEFT JOIN flagn fn ON fn.sid_text=ro.sid::text
  ),
  final AS (
    SELECT sid, cid, att_pct, rec_pct,
      (CASE WHEN f_att THEN w_att ELSE 0 END + CASE WHEN f_quart THEN w_quart ELSE 0 END
       + CASE WHEN f_drop THEN w_drop ELSE 0 END + CASE WHEN f_flags THEN w_flags ELSE 0 END) AS sc,
      f_att, f_quart, f_drop, flag_n, att_days, exam_n
    FROM scored WHERE coalesce(att_days,0)>=10 AND coalesce(exam_n,0)>=2
  )
  SELECT f.sid, f.cid, f.sc::int,
    CASE WHEN f.sc>=b_red THEN 'red' WHEN f.sc>=b_amber THEN 'amber' ELSE 'yellow' END,
    trim(BOTH ', ' FROM concat_ws(', ',
      CASE WHEN f.f_quart THEN 'recent marks among the lowest in class' END,
      CASE WHEN f.f_att THEN 'attendance well below class' END,
      CASE WHEN f.f_drop THEN 'was above average, now below' END,
      CASE WHEN f.flag_n>=3 THEN f.flag_n||' active flags' END)),
    f.att_pct, f.rec_pct, CASE WHEN f.f_drop THEN 'down' ELSE 'flat' END, f.flag_n::int
  FROM final f WHERE f.sc>=v_min;
END $$;

-- ============ KPI summary (scoped) ============
CREATE OR REPLACE FUNCTION public.dash_scoped_kpi_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_ctext text[]; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_present int; v_total int; v_wk_present int; v_wk_total int; v_pwk_present int; v_pwk_total int;
  v_avg numeric; v_prev_avg numeric; v_exams int; v_need int; v_flags int;
BEGIN
  v_inst := public.get_user_institution(auth.uid());
  v_classes := public.dash_resolve_scoped_classes();
  v_ctext := ARRAY(SELECT x::text FROM unnest(v_classes) AS x);
  SELECT timezone INTO v_tz FROM institutions WHERE id=v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today-INTERVAL '12 months')::date;
  v_ay_end := COALESCE(v_ay_end, v_today)::date;

  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*) INTO v_present, v_total
  FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes) AND date=v_today;
  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*) INTO v_wk_present, v_wk_total
  FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes) AND date>v_today-7 AND date<=v_today;
  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*) INTO v_pwk_present, v_pwk_total
  FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes) AND date>v_today-14 AND date<=v_today-7;

  SELECT round(avg(fr.percentage),1), count(DISTINCT e.id) INTO v_avg, v_exams
  FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(v_classes)
  JOIN exams e ON e.id=a.exam_id WHERE e.institution_id=v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) BETWEEN v_ay_start AND v_ay_end;
  SELECT round(avg(fr.percentage),1) INTO v_prev_avg
  FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(v_classes)
  JOIN exams e ON e.id=a.exam_id WHERE e.institution_id=v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date)
        BETWEEN (v_ay_start-INTERVAL '1 year')::date AND (v_ay_start-INTERVAL '1 day')::date;

  SELECT count(*) INTO v_need FROM public.dash_score_students_scoped(v_inst, v_classes, NULL) WHERE score>=20;

  SELECT count(*) INTO v_flags FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
    AND ( (df.subject_type='class' AND df.subject_key = ANY(v_ctext))
       OR (df.subject_type='exam' AND EXISTS(SELECT 1 FROM exam_classes ec WHERE ec.exam_id::text=df.subject_key AND ec.class_id = ANY(v_classes)))
       OR (df.subject_type='student' AND EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=df.subject_key AND ca.role='student' AND ca.class_id = ANY(v_classes)))
       OR (df.subject_type='teacher' AND EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=df.subject_key AND ca.role='teacher' AND ca.class_id = ANY(v_classes))) );

  RETURN jsonb_build_object(
    'attendance_today', jsonb_build_object('present',v_present,'total',v_total,'marked',v_total>0,
       'pct', CASE WHEN v_total>0 THEN round(v_present*100.0/v_total,1) END,
       'week_pct', CASE WHEN v_wk_total>0 THEN round(v_wk_present*100.0/v_wk_total,1) END,
       'prev_week_pct', CASE WHEN v_pwk_total>0 THEN round(v_pwk_present*100.0/v_pwk_total,1) END),
    'school_avg', jsonb_build_object('pct',v_avg,'prev_pct',v_prev_avg,'exams_count',v_exams),
    'students_need_help', jsonb_build_object('count',v_need,'prev_count',NULL),
    'decisions_waiting', jsonb_build_object('count',v_flags));
END $$;

-- ============ widgets (scoped) ============
CREATE OR REPLACE FUNCTION public.dash_scoped_attendance_trend(p_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  SELECT timezone INTO v_tz FROM institutions WHERE id=v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',d.date,'present',d.present,'total',d.total,
           'pct', CASE WHEN d.total>0 THEN round(d.present*100.0/d.total,1) END) ORDER BY d.date),'[]'::jsonb)
    INTO v_points FROM (
      SELECT date, count(*) FILTER (WHERE status IN ('present','late')) AS present, count(*) AS total
      FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes)
        AND date>v_today-p_days AND date<=v_today GROUP BY date) d;
  SELECT round((count(*) FILTER (WHERE status IN ('present','late')))*100.0/NULLIF(count(*),0),1) INTO v_all
  FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes);
  RETURN jsonb_build_object('points',v_points,'all_time_avg',v_all);
END $$;

CREATE OR REPLACE FUNCTION public.dash_scoped_subject_performance(p_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_rows jsonb;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  IF NOT (p_class_id = ANY(v_classes)) THEN RAISE EXCEPTION 'dashboard: class not in scope'; END IF;
  WITH res AS (
    SELECT a.class_id, es.subject_id, us.name AS subject_name, fr.percentage
    FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(v_classes)
    JOIN exams e ON e.id=a.exam_id AND e.institution_id=v_inst AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id=e.id JOIN universal_subjects us ON us.id=es.subject_id
  ),
  class_avg AS (SELECT subject_id, subject_name, round(avg(percentage),1) AS class_avg FROM res WHERE class_id=p_class_id GROUP BY subject_id, subject_name),
  school_avg AS (SELECT subject_id, round(avg(percentage),1) AS school_avg FROM res GROUP BY subject_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('subject_id',c.subject_id,'subject_name',c.subject_name,
           'class_avg',c.class_avg,'school_avg',s.school_avg) ORDER BY c.class_avg ASC),'[]'::jsonb)
    INTO v_rows FROM class_avg c LEFT JOIN school_avg s USING (subject_id);
  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows)>0, 'subjects', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.dash_scoped_student_distribution()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_dw int; v_cu int; v_nh int; v_total int; v_eval int;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  WITH latest AS (
    SELECT DISTINCT ON (a.student_id) a.student_id, fr.percentage
    FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(v_classes)
    JOIN exams e ON e.id=a.exam_id AND e.institution_id=v_inst AND e.status IN ('published','active','completed')
    ORDER BY a.student_id, coalesce(fr.finalized_at,fr.created_at) DESC)
  SELECT count(*) FILTER (WHERE percentage>70), count(*) FILTER (WHERE percentage BETWEEN 50 AND 70),
         count(*) FILTER (WHERE percentage<50), count(*) INTO v_dw, v_cu, v_nh, v_eval FROM latest;
  SELECT count(*) INTO v_total FROM class_assignments WHERE role='student' AND class_id = ANY(v_classes);
  RETURN jsonb_build_object('doing_well',v_dw,'catching_up',v_cu,'needs_help',v_nh,'total',v_total,'evaluated',v_eval);
END $$;

CREATE OR REPLACE FUNCTION public.dash_scoped_exam_trend(p_limit int DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_rows jsonb;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  WITH recent AS (
    SELECT e.id, e.title, e.exam_type, COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) AS exam_date
    FROM exams e WHERE e.institution_id=v_inst AND e.status IN ('published','active','completed')
      AND EXISTS(SELECT 1 FROM exam_classes ec WHERE ec.exam_id=e.id AND ec.class_id = ANY(v_classes))
    ORDER BY exam_date DESC NULLS LAST LIMIT p_limit),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date, round(avg(fr.percentage),1) AS avg_pct, count(fr.id) AS participation
    FROM recent r LEFT JOIN student_exam_attempts a ON a.exam_id=r.id AND a.class_id = ANY(v_classes)
    LEFT JOIN final_results fr ON fr.attempt_id=a.id GROUP BY r.id, r.title, r.exam_type, r.exam_date)
  SELECT coalesce(jsonb_agg(jsonb_build_object('exam_id',id,'title',title,'exam_type',exam_type,
           'avg_pct',avg_pct,'participation',participation,'exam_date',exam_date) ORDER BY exam_date ASC),'[]'::jsonb)
    INTO v_rows FROM agg;
  RETURN v_rows;
END $$;

-- scoped heatmap: always group by grade band (wings collapse for a single-wing coordinator)
CREATE OR REPLACE FUNCTION public.dash_scoped_subject_heatmap()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_rows jsonb;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  WITH res AS (
    SELECT a.class_id, us.name AS subject_name, fr.percentage
    FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(v_classes)
    JOIN exams e ON e.id=a.exam_id AND e.institution_id=v_inst AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id=e.id JOIN universal_subjects us ON us.id=es.subject_id),
  banded AS (
    SELECT r.*,
      (SELECT CASE
         WHEN gl.grade_number BETWEEN 1 AND 5 THEN 'Primary'
         WHEN gl.grade_number BETWEEN 6 AND 8 THEN 'Middle'
         WHEN gl.grade_number BETWEEN 9 AND 10 THEN 'Secondary'
         WHEN gl.grade_number BETWEEN 11 AND 12 THEN 'Senior Secondary'
         WHEN gl.grade_number < 1 THEN 'Pre-Primary' ELSE 'Other' END
       FROM classes c JOIN class_groups cg ON cg.id=c.class_group_id LEFT JOIN grade_levels gl ON gl.id=cg.grade_level_id
       WHERE c.id=r.class_id) AS band_label,
      (SELECT gl.grade_number FROM classes c JOIN class_groups cg ON cg.id=c.class_group_id
       LEFT JOIN grade_levels gl ON gl.id=cg.grade_level_id WHERE c.id=r.class_id) AS band_order
    FROM res r),
  cells AS (SELECT coalesce(band_label,'Other') AS band_label, min(band_order) AS band_order,
            initcap(lower(btrim(subject_name))) AS subject_name, round(avg(percentage),1) AS avg_pct
            FROM banded GROUP BY coalesce(band_label,'Other'), initcap(lower(btrim(subject_name))))
  SELECT coalesce(jsonb_agg(row_to_json(g)),'[]'::jsonb) INTO v_rows FROM (
    SELECT band_label, jsonb_agg(jsonb_build_object('subject_name',subject_name,'avg_pct',avg_pct,
      'band', CASE WHEN avg_pct<50 THEN 'red' WHEN avg_pct<=70 THEN 'amber' ELSE 'green' END) ORDER BY subject_name) AS cells
    FROM cells GROUP BY band_label ORDER BY min(band_order) NULLS LAST) g;
  RETURN jsonb_build_object('grouping','grade','rows',v_rows);
END $$;

-- ============ tables (scoped) ============
CREATE OR REPLACE FUNCTION public.dash_scoped_classes_table(p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 10, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_tz text; v_today date; v_rows jsonb; v_total int;
        v_only_flagged boolean := coalesce((p_filters->>'only_flagged')::boolean,false);
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  SELECT timezone INTO v_tz FROM institutions WHERE id=v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  WITH joined AS (
    SELECT c.id, c.name, c.section,
      (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
      (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1)
         FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
      (SELECT round(avg(fr.percentage),1) FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
         JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
           AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date)>v_today-60 WHERE a.class_id=c.id) AS recent_avg,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c WHERE c.id = ANY(v_classes))
  SELECT count(*) INTO v_total FROM joined WHERE (NOT v_only_flagged OR active_flags>0);
  WITH joined AS (
    SELECT c.id, c.name, c.section,
      (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
      (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1)
         FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
      (SELECT round(avg(fr.percentage),1) FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
         JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
           AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date)>v_today-60 WHERE a.class_id=c.id) AS recent_avg,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c WHERE c.id = ANY(v_classes))
  SELECT coalesce(jsonb_agg(jsonb_build_object('class_id',j.id,'name',j.name||coalesce(' '||j.section,''),
           'students',j.students,'attendance_30d',j.attendance_30d,'recent_avg',j.recent_avg,'active_flags',j.active_flags)
           ORDER BY j.recent_avg ASC NULLS LAST),'[]'::jsonb) INTO v_rows
  FROM (SELECT * FROM joined WHERE (NOT v_only_flagged OR active_flags>0) ORDER BY recent_avg ASC NULLS LAST LIMIT p_limit OFFSET p_offset) j;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END $$;

CREATE OR REPLACE FUNCTION public.dash_scoped_students_attention(p_weights jsonb DEFAULT NULL, p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 10, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_rows jsonb; v_total int;
        v_class uuid := nullif(p_filters->>'class_id','')::uuid; v_band text := nullif(p_filters->>'band','');
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  WITH s AS (SELECT * FROM public.dash_score_students_scoped(v_inst, v_classes, p_weights)
    WHERE (v_class IS NULL OR class_id=v_class)
      AND (v_band IS NULL OR (v_band='red' AND band='red') OR (v_band='amber' AND band IN ('red','amber'))))
  SELECT count(*) INTO v_total FROM s;
  WITH s AS (SELECT * FROM public.dash_score_students_scoped(v_inst, v_classes, p_weights)
    WHERE (v_class IS NULL OR class_id=v_class)
      AND (v_band IS NULL OR (v_band='red' AND band='red') OR (v_band='amber' AND band IN ('red','amber')))),
  page AS (SELECT * FROM s ORDER BY CASE band WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END, recent_pct ASC NULLS FIRST LIMIT p_limit OFFSET p_offset)
  SELECT coalesce(jsonb_agg(jsonb_build_object('student_id',page.student_id,'name',p.full_name,'roll',p.roll_number,
           'class',c.name||coalesce(' '||c.section,''),'band',page.band,'reason',page.reason,
           'attendance',page.attendance,'recent_pct',page.recent_pct,'trend',page.trend,'active_flags',page.active_flags)
           ORDER BY CASE page.band WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END, page.recent_pct ASC NULLS FIRST),'[]'::jsonb)
    INTO v_rows FROM page JOIN profiles p ON p.id=page.student_id JOIN classes c ON c.id=page.class_id;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END $$;

-- scoped teachers: teachers who teach the caller's classes
CREATE OR REPLACE FUNCTION public.dash_scoped_teachers_table(p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 10, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_tz text; v_today date; v_rows jsonb; v_total int;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  SELECT timezone INTO v_tz FROM institutions WHERE id=v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT count(DISTINCT ca.user_id) INTO v_total FROM class_assignments ca
    WHERE ca.role='teacher' AND ca.class_id = ANY(v_classes);
  WITH staff AS (SELECT DISTINCT ca.user_id FROM class_assignments ca WHERE ca.role='teacher' AND ca.class_id = ANY(v_classes)),
  enriched AS (
    SELECT st.user_id, p.full_name, 'teacher'::text AS role, p.created_at AS profile_created,
      (SELECT w.name FROM wing_assignments wa JOIN wings w ON w.id=wa.wing_id WHERE wa.user_id=st.user_id LIMIT 1) AS wing,
      (SELECT count(DISTINCT ca.class_id) FROM class_assignments ca WHERE ca.user_id=st.user_id AND ca.role='teacher' AND ca.class_id = ANY(v_classes)) AS classes,
      (SELECT round((count(*) FILTER (WHERE sar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1)
         FROM staff_attendance_records sar WHERE sar.staff_id=st.user_id AND sar.date>v_today-30 AND sar.date<=v_today) AS attendance_30d,
      (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id=st.user_id) AS last_login,
      (SELECT count(*) FROM exams e WHERE e.created_by=st.user_id AND e.institution_id=v_inst AND e.created_at>now()-INTERVAL '30 days') AS exams_30d,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL AND df.subject_type='teacher' AND df.subject_key=st.user_id::text) AS active_flags
    FROM staff st JOIN profiles p ON p.id=st.user_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'name',full_name,'role',role,'wing',wing,
           'classes',classes,'attendance_30d',attendance_30d,'last_login',last_login,'exams_30d',exams_30d,'active_flags',active_flags,
           'is_new', profile_created>now()-INTERVAL '7 days')
           ORDER BY (profile_created>now()-INTERVAL '7 days'), (last_login IS NULL OR last_login<now()-INTERVAL '7 days') DESC, coalesce(attendance_30d,0) ASC),'[]'::jsonb)
    INTO v_rows FROM (SELECT * FROM enriched ORDER BY (profile_created>now()-INTERVAL '7 days'),
      (last_login IS NULL OR last_login<now()-INTERVAL '7 days') DESC, coalesce(attendance_30d,0) ASC LIMIT p_limit OFFSET p_offset) enriched;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END $$;

-- scoped recent exams: exams linked to the caller's classes; stats scoped to those classes
CREATE OR REPLACE FUNCTION public.dash_scoped_recent_exams(p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 20, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_rows jsonb; v_total int;
        v_status text := nullif(p_filters->>'status','');
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  SELECT count(*) INTO v_total FROM exams e WHERE e.institution_id=v_inst AND (v_status IS NULL OR e.status::text=v_status)
    AND EXISTS(SELECT 1 FROM exam_classes ec WHERE ec.exam_id=e.id AND ec.class_id = ANY(v_classes));
  WITH ex AS (
    SELECT e.id, e.title, e.status::text AS status, e.exam_type,
      COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) AS exam_date,
      (SELECT string_agg(DISTINCT us.name, ', ') FROM exam_subjects es JOIN universal_subjects us ON us.id=es.subject_id WHERE es.exam_id=e.id) AS subjects,
      (SELECT string_agg(DISTINCT c.name, ', ') FROM exam_classes ec JOIN classes c ON c.id=ec.class_id WHERE ec.exam_id=e.id AND ec.class_id = ANY(v_classes)) AS classes,
      (SELECT count(*) FROM student_exam_attempts a WHERE a.exam_id=e.id AND a.is_submitted AND a.class_id = ANY(v_classes)) AS attempted,
      (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id IN (SELECT class_id FROM exam_classes WHERE exam_id=e.id AND class_id = ANY(v_classes))) AS assigned,
      (SELECT round(avg(fr.percentage),1) FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id WHERE a.exam_id=e.id AND a.class_id = ANY(v_classes)) AS avg_pct,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL AND df.subject_type='exam' AND df.subject_key=e.id::text) AS active_flags
    FROM exams e WHERE e.institution_id=v_inst AND (v_status IS NULL OR e.status::text=v_status)
      AND EXISTS(SELECT 1 FROM exam_classes ec WHERE ec.exam_id=e.id AND ec.class_id = ANY(v_classes))
    ORDER BY exam_date DESC NULLS LAST LIMIT p_limit OFFSET p_offset)
  SELECT coalesce(jsonb_agg(jsonb_build_object('exam_id',id,'title',title,'status',status,'exam_type',exam_type,
           'exam_date',exam_date,'subjects',subjects,'classes',classes,'attempted',attempted,'assigned',assigned,'avg_pct',avg_pct,'active_flags',active_flags)
           ORDER BY exam_date DESC NULLS LAST),'[]'::jsonb) INTO v_rows FROM ex;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END $$;

-- ============ flags (scoped) ============
CREATE OR REPLACE FUNCTION public.dash_scoped_get_flags()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_ctext text[]; v_rows jsonb;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  v_ctext := ARRAY(SELECT x::text FROM unnest(v_classes) AS x);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'flag_code',flag_code,'category',category,'severity',severity,
           'status',status,'subject_type',subject_type,'subject_key',subject_key,'title',title,'description',description,
           'metric_value',metric_value,'context',context,'link_url',link_url,'assignee_id',assignee_id,'task_id',task_id,
           'auto_created',auto_created,'first_detected_at',first_detected_at)
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, first_detected_at DESC),'[]'::jsonb)
    INTO v_rows FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
    AND ( (df.subject_type='class' AND df.subject_key = ANY(v_ctext))
       OR (df.subject_type='exam' AND EXISTS(SELECT 1 FROM exam_classes ec WHERE ec.exam_id::text=df.subject_key AND ec.class_id = ANY(v_classes)))
       OR (df.subject_type='student' AND EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=df.subject_key AND ca.role='student' AND ca.class_id = ANY(v_classes)))
       OR (df.subject_type='teacher' AND EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=df.subject_key AND ca.role='teacher' AND ca.class_id = ANY(v_classes))) );
  RETURN v_rows;
END $$;

-- ============ flag -> task actions (scoped): verify the flag is in the caller's scope ============
CREATE OR REPLACE FUNCTION public.dash_scoped_flag_in_scope(p_flag dashboard_flags, p_classes uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_flag.subject_type
    WHEN 'class' THEN p_flag.subject_key = ANY(ARRAY(SELECT x::text FROM unnest(p_classes) AS x))
    WHEN 'exam' THEN EXISTS(SELECT 1 FROM exam_classes ec WHERE ec.exam_id::text=p_flag.subject_key AND ec.class_id = ANY(p_classes))
    WHEN 'student' THEN EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=p_flag.subject_key AND ca.role='student' AND ca.class_id = ANY(p_classes))
    WHEN 'teacher' THEN EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=p_flag.subject_key AND ca.role='teacher' AND ca.class_id = ANY(p_classes))
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.dash_scoped_create_task_from_flag(p_flag_id uuid, p_assignee_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flag dashboard_flags; v_inst uuid; v_classes uuid[]; v_assignee uuid; v_assigner uuid; v_task uuid; v_ttype task_type; v_prio int;
BEGIN
  SELECT * INTO v_flag FROM dashboard_flags WHERE id=p_flag_id;
  IF v_flag.id IS NULL THEN RAISE EXCEPTION 'dashboard: flag not found'; END IF;
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  IF v_flag.institution_id <> v_inst OR NOT public.dash_scoped_flag_in_scope(v_flag, v_classes) THEN
    RAISE EXCEPTION 'dashboard: flag not in scope'; END IF;
  IF v_flag.task_id IS NOT NULL THEN RETURN v_flag.task_id; END IF;
  v_assignee := COALESCE(p_assignee_id, public.resolve_flag_assignee(v_inst, v_flag.subject_type, v_flag.subject_key));
  v_assigner := auth.uid(); IF v_assigner=v_assignee THEN v_assigner := NULL; END IF;
  v_ttype := CASE WHEN v_flag.category='exams' THEN 'exam_related'::task_type
                  WHEN v_flag.category='attendance' THEN 'student_support'::task_type ELSE 'administrative'::task_type END;
  v_prio := CASE v_flag.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END;
  INSERT INTO tasks (institution_id,title,description,task_type,priority,status,due_date)
    VALUES (v_inst, v_flag.title, v_flag.description, v_ttype, v_prio, 'open', (CURRENT_DATE+3)::timestamptz) RETURNING id INTO v_task;
  IF v_assignee IS NOT NULL THEN
    INSERT INTO task_assignments (task_id,assignee_id,assigner_id) VALUES (v_task, v_assignee, v_assigner);
    INSERT INTO notifications (user_id,title,message,type,link,metadata)
      VALUES (v_assignee,'New task from dashboard', v_flag.title,'task_assigned','/tasks', jsonb_build_object('task_id',v_task,'flag_id',v_flag.id));
  END IF;
  UPDATE dashboard_flags SET status='amber', task_id=v_task, assignee_id=v_assignee, auto_created=false WHERE id=p_flag_id;
  RETURN v_task;
END $$;

CREATE OR REPLACE FUNCTION public.dash_scoped_reassign_flag_task(p_flag_id uuid, p_assignee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flag dashboard_flags; v_inst uuid; v_classes uuid[]; v_assigner uuid;
BEGIN
  SELECT * INTO v_flag FROM dashboard_flags WHERE id=p_flag_id;
  IF v_flag.id IS NULL OR v_flag.task_id IS NULL THEN RAISE EXCEPTION 'dashboard: flag has no task'; END IF;
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  IF v_flag.institution_id <> v_inst OR NOT public.dash_scoped_flag_in_scope(v_flag, v_classes) THEN RAISE EXCEPTION 'dashboard: flag not in scope'; END IF;
  v_assigner := auth.uid(); IF v_assigner=p_assignee_id THEN v_assigner := NULL; END IF;
  UPDATE task_assignments SET assignee_id=p_assignee_id, assigner_id=v_assigner WHERE task_id=v_flag.task_id;
  UPDATE dashboard_flags SET assignee_id=p_assignee_id WHERE id=p_flag_id;
  INSERT INTO notifications (user_id,title,message,type,link,metadata)
    VALUES (p_assignee_id,'Task reassigned to you', v_flag.title,'task_assigned','/tasks', jsonb_build_object('task_id',v_flag.task_id,'flag_id',v_flag.id));
END $$;

CREATE OR REPLACE FUNCTION public.dash_scoped_cancel_flag_task(p_flag_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flag dashboard_flags; v_inst uuid; v_classes uuid[];
BEGIN
  SELECT * INTO v_flag FROM dashboard_flags WHERE id=p_flag_id;
  IF v_flag.id IS NULL THEN RAISE EXCEPTION 'dashboard: flag not found'; END IF;
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  IF v_flag.institution_id <> v_inst OR NOT public.dash_scoped_flag_in_scope(v_flag, v_classes) THEN RAISE EXCEPTION 'dashboard: flag not in scope'; END IF;
  IF v_flag.task_id IS NOT NULL THEN DELETE FROM tasks WHERE id=v_flag.task_id; END IF;
  UPDATE dashboard_flags SET status='red', task_id=NULL, auto_created=false, assignee_id=NULL WHERE id=p_flag_id;
END $$;

-- lightweight class list for scope-aware pickers/filters (id, name, section)
CREATE OR REPLACE FUNCTION public.dash_scoped_class_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_classes uuid[]; v_rows jsonb;
BEGIN
  v_classes := public.dash_resolve_scoped_classes();
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'section',c.section)
           ORDER BY c.name, c.section),'[]'::jsonb)
    INTO v_rows FROM classes c WHERE c.id = ANY(v_classes);
  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.dash_resolve_scoped_classes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_class_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_score_students_scoped(uuid,uuid[],jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_kpi_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_attendance_trend(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_subject_performance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_student_distribution() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_exam_trend(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_subject_heatmap() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_classes_table(jsonb,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_students_attention(jsonb,jsonb,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_teachers_table(jsonb,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_recent_exams(jsonb,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_get_flags() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_flag_in_scope(dashboard_flags,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_create_task_from_flag(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_reassign_flag_task(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_cancel_flag_task(uuid) TO authenticated;
