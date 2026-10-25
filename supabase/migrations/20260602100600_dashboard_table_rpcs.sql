-- Dashboard rebuild Phase 1 — Tasks 11-14
-- Table RPCs: classes, students-needing-attention, teachers, recent exams.
-- (dash_score_students lives in 20260602100300_dashboard_helpers.sql.)

-- 11) Classes table — worst recent exam average first.
CREATE OR REPLACE FUNCTION public.dash_classes_table(
  p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 10, p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_tz text; v_today date; v_rows jsonb; v_total int;
        v_only_flagged boolean := coalesce((p_filters->>'only_flagged')::boolean, false);
        v_wing uuid := nullif(p_filters->>'wing_id','')::uuid;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  WITH joined AS (
    SELECT c.id, c.name, c.section,
           (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
           (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1)
              FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
           (SELECT round(avg(fr.percentage),1)
              FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
              JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
                AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-60
              WHERE a.class_id=c.id) AS recent_avg,
           (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
              AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c
    WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
      AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.class_id=c.id AND m.wing_id=v_wing))
  ),
  filtered AS (SELECT * FROM joined WHERE (NOT v_only_flagged OR active_flags > 0))
  SELECT count(*) INTO v_total FROM filtered;

  WITH joined AS (
    SELECT c.id, c.name, c.section,
           (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
           (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1)
              FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
           (SELECT round(avg(fr.percentage),1)
              FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
              JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
                AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-60
              WHERE a.class_id=c.id) AS recent_avg,
           (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
              AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c
    WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
      AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.class_id=c.id AND m.wing_id=v_wing))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'class_id', j.id, 'name', j.name || coalesce(' '||j.section,''),
           'students', j.students, 'attendance_30d', j.attendance_30d,
           'recent_avg', j.recent_avg, 'active_flags', j.active_flags)
           ORDER BY j.recent_avg ASC NULLS LAST), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT * FROM joined WHERE (NOT v_only_flagged OR active_flags > 0)
    ORDER BY recent_avg ASC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ) j;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

-- 12) Students-needing-attention table (paginates dash_score_students + joins display fields).
CREATE OR REPLACE FUNCTION public.dash_students_attention(
  p_weights jsonb DEFAULT NULL, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 10, p_offset int DEFAULT 0, p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb; v_total int;
        v_class uuid := nullif(p_filters->>'class_id','')::uuid;
        v_band  text := nullif(p_filters->>'band','');
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH s AS (
    SELECT * FROM public.dash_score_students(v_inst, p_weights)
    WHERE (v_class IS NULL OR class_id = v_class)
      AND (v_band IS NULL OR (v_band='red' AND band='red') OR (v_band='amber' AND band IN ('red','amber')))
  )
  SELECT count(*) INTO v_total FROM s;

  WITH s AS (
    SELECT * FROM public.dash_score_students(v_inst, p_weights)
    WHERE (v_class IS NULL OR class_id = v_class)
      AND (v_band IS NULL OR (v_band='red' AND band='red') OR (v_band='amber' AND band IN ('red','amber')))
  ),
  page AS (
    SELECT * FROM s
    ORDER BY CASE band WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END, recent_pct ASC NULLS FIRST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'student_id', page.student_id, 'name', p.full_name, 'roll', p.roll_number,
           'class', c.name || coalesce(' '||c.section,''),
           'band', page.band, 'reason', page.reason,
           'attendance', page.attendance, 'recent_pct', page.recent_pct, 'trend', page.trend,
           'active_flags', page.active_flags)
           ORDER BY CASE page.band WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END, page.recent_pct ASC NULLS FIRST), '[]'::jsonb)
    INTO v_rows
  FROM page
  JOIN profiles p ON p.id = page.student_id
  JOIN classes c ON c.id = page.class_id;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

-- 13) Teachers table — reads auth.users.last_sign_in_at (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.dash_teachers_table(
  p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 10, p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_tz text; v_today date; v_rows jsonb; v_total int;
        v_roles text[] := CASE WHEN p_filters ? 'roles'
                               THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'roles'))
                               ELSE ARRAY['teacher','coordinator','employee'] END;
        v_wing uuid := nullif(p_filters->>'wing_id','')::uuid;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  SELECT count(DISTINCT ur.user_id) INTO v_total
  FROM user_roles ur WHERE ur.institution_id = v_inst AND ur.role::text = ANY(v_roles)
    AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_assignments wa WHERE wa.user_id = ur.user_id AND wa.wing_id = v_wing));

  WITH staff AS (
    SELECT DISTINCT ON (ur.user_id) ur.user_id, ur.role::text AS role
    FROM user_roles ur WHERE ur.institution_id = v_inst AND ur.role::text = ANY(v_roles)
      AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_assignments wa WHERE wa.user_id = ur.user_id AND wa.wing_id = v_wing))
  ),
  enriched AS (
    SELECT st.user_id, p.full_name, st.role, p.created_at AS profile_created,
      (SELECT w.name FROM wing_assignments wa JOIN wings w ON w.id = wa.wing_id WHERE wa.user_id = st.user_id LIMIT 1) AS wing,
      (SELECT count(DISTINCT ca.class_id) FROM class_assignments ca WHERE ca.user_id = st.user_id AND ca.role='teacher') AS classes,
      (SELECT round((count(*) FILTER (WHERE sar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1)
         FROM staff_attendance_records sar
         WHERE sar.staff_id = st.user_id AND sar.date > v_today - 30 AND sar.date <= v_today) AS attendance_30d,
      (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = st.user_id) AS last_login,
      (SELECT count(*) FROM exams e WHERE e.created_by = st.user_id AND e.institution_id = v_inst
         AND e.created_at > now() - INTERVAL '30 days') AS exams_30d,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='teacher' AND df.subject_key = st.user_id::text) AS active_flags
    FROM staff st JOIN profiles p ON p.id = st.user_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', user_id, 'name', full_name, 'role', role, 'wing', wing,
           'classes', classes, 'attendance_30d', attendance_30d,
           'last_login', last_login, 'exams_30d', exams_30d, 'active_flags', active_flags,
           'is_new', profile_created > now() - INTERVAL '7 days')
           ORDER BY (profile_created > now() - INTERVAL '7 days'),
                    (last_login IS NULL OR last_login < now() - INTERVAL '7 days') DESC,
                    coalesce(attendance_30d, 0) ASC), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT * FROM enriched
        ORDER BY (profile_created > now() - INTERVAL '7 days'),
                 (last_login IS NULL OR last_login < now() - INTERVAL '7 days') DESC,
                 coalesce(attendance_30d,0) ASC
        LIMIT p_limit OFFSET p_offset) enriched;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

-- 14) Recent exams table.
CREATE OR REPLACE FUNCTION public.dash_recent_exams(
  p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 20, p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb; v_total int;
        v_status text := nullif(p_filters->>'status','');
        v_class uuid := nullif(p_filters->>'class_id','')::uuid;
        v_subject uuid := nullif(p_filters->>'subject_id','')::uuid;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  SELECT count(*) INTO v_total FROM exams e
  WHERE e.institution_id = v_inst AND (v_status IS NULL OR e.status::text = v_status)
    AND (v_class IS NULL OR EXISTS (SELECT 1 FROM exam_classes ec WHERE ec.exam_id=e.id AND ec.class_id=v_class))
    AND (v_subject IS NULL OR EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id=e.id AND es.subject_id=v_subject));

  WITH ex AS (
    SELECT e.id, e.title, e.status::text AS status, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date,
           (SELECT string_agg(DISTINCT us.name, ', ') FROM exam_subjects es JOIN universal_subjects us ON us.id=es.subject_id WHERE es.exam_id=e.id) AS subjects,
           (SELECT string_agg(DISTINCT c.name, ', ') FROM exam_classes ec JOIN classes c ON c.id=ec.class_id WHERE ec.exam_id=e.id) AS classes,
           (SELECT count(*) FROM student_exam_attempts a WHERE a.exam_id=e.id AND a.is_submitted) AS attempted,
           (SELECT count(*) FROM class_assignments ca WHERE ca.role='student'
              AND ca.class_id IN (SELECT class_id FROM exam_classes WHERE exam_id=e.id)) AS assigned,
           (SELECT round(avg(fr.percentage),1) FROM final_results fr
              JOIN student_exam_attempts a ON a.id=fr.attempt_id WHERE a.exam_id=e.id) AS avg_pct,
           (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
              AND df.subject_type='exam' AND df.subject_key=e.id::text) AS active_flags
    FROM exams e
    WHERE e.institution_id = v_inst AND (v_status IS NULL OR e.status::text = v_status)
      AND (v_class IS NULL OR EXISTS (SELECT 1 FROM exam_classes ec WHERE ec.exam_id=e.id AND ec.class_id=v_class))
      AND (v_subject IS NULL OR EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id=e.id AND es.subject_id=v_subject))
    ORDER BY exam_date DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'exam_id', id, 'title', title, 'status', status, 'exam_type', exam_type,
           'exam_date', exam_date, 'subjects', subjects, 'classes', classes,
           'attempted', attempted, 'assigned', assigned, 'avg_pct', avg_pct, 'active_flags', active_flags)
           ORDER BY exam_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_rows FROM ex;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.dash_classes_table(jsonb,int,int,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_students_attention(jsonb,jsonb,int,int,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teachers_table(jsonb,int,int,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_recent_exams(jsonb,int,int,uuid) TO authenticated;
