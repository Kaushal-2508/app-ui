-- Say WHY a teacher is flagged, and stop calling untracked teachers "OK"
-- ============================================================================
-- The row still could not be read: "1 FLAGGED" never said what for, and two
-- teachers with identical chips ("4 classes", "Nothing logged in 30 days")
-- showed "1 FLAGGED" and "OK" respectively.
--
-- Ground truth, dug out of prod: the ONLY live teacher flag is SY1 "Syllabus
-- logging is behind" (64 unresolved). It fires from dash_evaluate_syllabus_flags
-- when a teacher has MORE THAN 3 school days with unlogged syllabus progress,
-- where school days come from their timetable slots - but ONLY for slots whose
-- subject has at least one active chapter (the deliberate "trap-freedom"
-- clause: you cannot demand progress on a subject that has no syllabus loaded).
--
-- That is the whole explanation for the OK rows:
--   Anita Sharma   36 teaching slots, 36 with chapters  -> flagged
--   Bharat Verma   35 teaching slots, 35 with chapters  -> flagged
--   Bikash Das     28 teaching slots,  0 with chapters  -> exempt, showed "OK"
--   Anjali Roy      7 teaching slots,  0 with chapters  -> exempt, showed "OK"
--   Chaitra Reddy  22 teaching slots,  0 with chapters  -> exempt, showed "OK"
--
-- So "OK" did not mean the teacher was fine. It meant the school has not
-- loaded a syllabus for their subjects, so nothing can be measured. Presenting
-- that as a green tick next to "Nothing logged in 30 days" is the opposite of
-- the truth.
--
-- This adds the flag's own title and description to the payload so the row can
-- name the reason instead of counting it. The badge logic moves to the client:
-- flag title if flagged, "Active" if they did something, "No activity"
-- otherwise - never "OK" for someone who did nothing.

CREATE OR REPLACE FUNCTION public.dash_teachers_table(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_tz text; v_today date; v_rows jsonb; v_total int;
        v_roles text[] := CASE WHEN p_filters ? 'roles'
                               THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'roles'))
                               ELSE ARRAY['teacher','coordinator','employee'] END;
        v_wing uuid := nullif(p_filters->>'wing_id','')::uuid;
        v_class uuid := nullif(p_filters->>'class_id','')::uuid;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  IF v_class IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = v_class AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  SELECT count(DISTINCT ur.user_id) INTO v_total
  FROM user_roles ur WHERE ur.institution_id = v_inst AND ur.role::text = ANY(v_roles)
    AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_assignments wa WHERE wa.user_id = ur.user_id AND wa.wing_id = v_wing))
    AND (v_class IS NULL OR EXISTS (SELECT 1 FROM class_assignments ca
                                     WHERE ca.user_id = ur.user_id AND ca.role = 'teacher'
                                       AND ca.class_id = v_class));

  WITH staff AS (
    SELECT DISTINCT ON (ur.user_id) ur.user_id, ur.role::text AS role
    FROM user_roles ur WHERE ur.institution_id = v_inst AND ur.role::text = ANY(v_roles)
      AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_assignments wa WHERE wa.user_id = ur.user_id AND wa.wing_id = v_wing))
      AND (v_class IS NULL OR EXISTS (SELECT 1 FROM class_assignments ca
                                       WHERE ca.user_id = ur.user_id AND ca.role = 'teacher'
                                         AND ca.class_id = v_class))
  ),
  enriched AS (
    SELECT st.user_id, p.full_name, st.role, p.created_at AS profile_created,
      (SELECT w.name FROM wing_assignments wa JOIN wings w ON w.id = wa.wing_id WHERE wa.user_id = st.user_id LIMIT 1) AS wing,
      (SELECT count(DISTINCT ca.class_id) FROM class_assignments ca WHERE ca.user_id = st.user_id AND ca.role='teacher') AS classes,
      (SELECT count(*) FROM tt_lesson_plans lp
        WHERE lp.owner_teacher_id = st.user_id AND lp.status = 'done'
          AND lp.date > v_today - 30 AND lp.date <= v_today) AS lessons_30d,
      (SELECT count(DISTINCT ar.date) FROM attendance_records ar
        WHERE ar.marked_by = st.user_id
          AND ar.date > v_today - 30 AND ar.date <= v_today) AS attendance_days_30d,
      (SELECT count(*) FROM homework_assignments h
        WHERE h.created_by = st.user_id AND h.institution_id = v_inst
          AND h.created_at > now() - INTERVAL '30 days') AS homework_30d,
      (SELECT count(*) FROM exams e WHERE e.created_by = st.user_id AND e.institution_id = v_inst
         AND e.created_at > now() - INTERVAL '30 days') AS exams_30d,
      (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = st.user_id) AS last_login,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='teacher' AND df.subject_key = st.user_id::text) AS active_flags,
      -- The reason, not just the count. Most severe first so a single badge
      -- names the worst thing rather than an arbitrary one.
      (SELECT df.title FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='teacher' AND df.subject_key = st.user_id::text
         ORDER BY CASE df.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                  df.first_detected_at
         LIMIT 1) AS flag_title,
      (SELECT df.description FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='teacher' AND df.subject_key = st.user_id::text
         ORDER BY CASE df.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                  df.first_detected_at
         LIMIT 1) AS flag_detail
    FROM staff st JOIN profiles p ON p.id = st.user_id
  ),
  scored AS (
    SELECT e.*, (e.lessons_30d + e.attendance_days_30d + e.homework_30d + e.exams_30d) AS activity_score,
           (e.profile_created > now() - INTERVAL '7 days') AS is_new
    FROM enriched e
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', user_id, 'name', full_name, 'role', role, 'wing', wing,
           'classes', classes,
           'lessons_30d', lessons_30d,
           'attendance_days_30d', attendance_days_30d,
           'homework_30d', homework_30d,
           'exams_30d', exams_30d,
           'activity_score', activity_score,
           'last_login', last_login, 'active_flags', active_flags,
           'flag_title', flag_title, 'flag_detail', flag_detail,
           'is_new', is_new)
           ORDER BY is_new ASC, activity_score ASC, full_name ASC), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT * FROM scored
        ORDER BY is_new ASC, activity_score ASC, full_name ASC
        LIMIT p_limit OFFSET p_offset) scored;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $function$;

CREATE OR REPLACE FUNCTION public.dash_scoped_teachers_table(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      (SELECT count(*) FROM tt_lesson_plans lp
        WHERE lp.owner_teacher_id = st.user_id AND lp.status='done'
          AND lp.class_id = ANY(v_classes)
          AND lp.date > v_today-30 AND lp.date <= v_today) AS lessons_30d,
      (SELECT count(DISTINCT ar.date) FROM attendance_records ar
        WHERE ar.marked_by = st.user_id AND ar.class_id = ANY(v_classes)
          AND ar.date > v_today-30 AND ar.date <= v_today) AS attendance_days_30d,
      (SELECT count(*) FROM homework_assignments h
        WHERE h.created_by=st.user_id AND h.institution_id=v_inst
          AND h.created_at>now()-INTERVAL '30 days') AS homework_30d,
      (SELECT count(*) FROM exams e WHERE e.created_by=st.user_id AND e.institution_id=v_inst AND e.created_at>now()-INTERVAL '30 days') AS exams_30d,
      (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id=st.user_id) AS last_login,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL AND df.subject_type='teacher' AND df.subject_key=st.user_id::text) AS active_flags,
      (SELECT df.title FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='teacher' AND df.subject_key=st.user_id::text
         ORDER BY CASE df.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, df.first_detected_at
         LIMIT 1) AS flag_title,
      (SELECT df.description FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='teacher' AND df.subject_key=st.user_id::text
         ORDER BY CASE df.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, df.first_detected_at
         LIMIT 1) AS flag_detail
    FROM staff st JOIN profiles p ON p.id=st.user_id),
  scored AS (
    SELECT e.*, (e.lessons_30d + e.attendance_days_30d + e.homework_30d + e.exams_30d) AS activity_score,
           (e.profile_created > now() - INTERVAL '7 days') AS is_new
    FROM enriched e)
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'name',full_name,'role',role,'wing',wing,
           'classes',classes,
           'lessons_30d',lessons_30d,'attendance_days_30d',attendance_days_30d,
           'homework_30d',homework_30d,'exams_30d',exams_30d,'activity_score',activity_score,
           'last_login',last_login,'active_flags',active_flags,
           'flag_title',flag_title,'flag_detail',flag_detail,'is_new',is_new)
           ORDER BY is_new ASC, activity_score ASC, full_name ASC),'[]'::jsonb)
    INTO v_rows FROM (SELECT * FROM scored
      ORDER BY is_new ASC, activity_score ASC, full_name ASC LIMIT p_limit OFFSET p_offset) scored;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END $function$;
