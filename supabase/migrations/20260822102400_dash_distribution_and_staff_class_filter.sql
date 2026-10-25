-- Class filters for "Where your students stand" and "Teachers by activity".
--
-- Both cards answer a school-wide question well and a per-class question not at
-- all. "15 need help" is a number nobody owns; "3 of 28 in Class 8-A need help"
-- is a conversation with one class teacher. Same for staff: the useful cut of
-- the activity list is "who teaches this class", not "everyone employed here".
--
-- Two different mechanisms, deliberately:
--
--  * dash_teachers_table already takes a p_filters jsonb and reads wing_id out
--    of it. class_id joins it there, so the signature does not change and no
--    overload can appear.
--  * dash_student_distribution takes no filter bag, so it gains a real
--    parameter -- and therefore the old signature must be DROPped first.
--    CREATE OR REPLACE does not replace across a different argument count, it
--    adds an overload, and PostgREST cannot then resolve a call matching both.
--    That failure shipped in 20260822101900 and read on screen as an empty card.
--
-- Also corrects the donut's denominator. `total` counted ROWS in
-- class_assignments, which holds one row per (student, class, subject) in
-- schools that map subjects per student, so a student taking eight subjects
-- counted eight times. It happens to match on Salci National (252 rows, 252
-- students), which is exactly why it went unnoticed. The centre of the donut
-- reads "N STUDENTS", so DISTINCT is what it always meant.
BEGIN;

DROP FUNCTION IF EXISTS public.dash_student_distribution(uuid);

CREATE OR REPLACE FUNCTION public.dash_student_distribution(
  p_institution_id uuid DEFAULT NULL::uuid,
  p_class_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_dw int; v_cu int; v_nh int; v_total int; v_eval int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  -- A class from another institution must not return an all-zero donut and
  -- read as "this school has no students".
  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (a.student_id) a.student_id, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
    WHERE (p_class_id IS NULL OR a.class_id = p_class_id)
    ORDER BY a.student_id, coalesce(fr.finalized_at, fr.created_at) DESC
  )
  SELECT count(*) FILTER (WHERE percentage > 70),
         count(*) FILTER (WHERE percentage BETWEEN 50 AND 70),
         count(*) FILTER (WHERE percentage < 50),
         count(*)
    INTO v_dw, v_cu, v_nh, v_eval
  FROM latest;

  -- DISTINCT: the donut's centre counts students, not assignment rows.
  SELECT count(DISTINCT user_id) INTO v_total
  FROM class_assignments WHERE role = 'student'
    AND (p_class_id IS NULL OR class_id = p_class_id)
    AND class_id IN (SELECT id FROM classes WHERE institution_id = v_inst);

  RETURN jsonb_build_object('doing_well', v_dw, 'catching_up', v_cu, 'needs_help', v_nh,
                            'total', v_total, 'evaluated', v_eval);
END $function$;

CREATE OR REPLACE FUNCTION public.dash_teachers_table(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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

  -- Narrowing by a class from another institution would return an empty staff
  -- list, which reads as "nobody teaches here" rather than as a mistake.
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
END $function$;

REVOKE EXECUTE ON FUNCTION public.dash_student_distribution(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_student_distribution(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_student_distribution(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.dash_teachers_table(jsonb, integer, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_teachers_table(jsonb, integer, integer, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_teachers_table(jsonb, integer, integer, uuid) TO authenticated;

COMMIT;
