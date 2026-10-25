-- "Teachers by activity" measures actual teaching activity (2026-09-05)
-- ============================================================================
-- The panel claimed to show "Classes held, exams set, and attendance over 30
-- days". It showed none of those things:
--
--   * `classes` was how many classes a teacher is ASSIGNED to, all-time. No
--     lesson was ever counted, and no 30-day window applied.
--   * `attendance_30d` was the teacher's OWN staff check-in rate, not whether
--     they mark their classes. Everyone reads "0% attendance" as "never marks
--     the register". At Salci National every teacher had 21 auto-marked-absent
--     records and 0 check-ins, because staff check-in is not used there, so
--     the headline metric painted the whole staff red for an unused feature.
--   * A teacher with NO staff-attendance rows got no chip at all, so having
--     less data looked better than having some.
--
-- Replaced with four things a teacher actually does, all over 30 days and all
-- index-backed:
--   lessons_30d          tt_lesson_plans marked done      (idx owner_teacher_id, date)
--   attendance_days_30d  distinct days they marked a register (idx marked_by, date)
--   homework_30d         homework_assignments they created (idx created_by)
--   exams_30d            exams they created               (idx created_by)
--
-- Verified alive before building: at Alliance 69 teachers have non-zero
-- activity and 21 have none at all, which is exactly the signal this panel
-- exists to surface.
--
-- Ordering is now least-active-first so the people who need a nudge are on the
-- first page, with brand-new profiles held back (they have not had time yet).
-- `attendance_30d` is dropped from the payload; staff check-in has its own
-- surface and does not belong in a teaching-activity list.

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
      -- Lessons they actually logged as taught.
      (SELECT count(*) FROM tt_lesson_plans lp
        WHERE lp.owner_teacher_id = st.user_id AND lp.status = 'done'
          AND lp.date > v_today - 30 AND lp.date <= v_today) AS lessons_30d,
      -- Days they marked a register. DISTINCT date, so marking six classes on
      -- one day is one day of the habit, not six.
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
         AND df.subject_type='teacher' AND df.subject_key = st.user_id::text) AS active_flags
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
           'is_new', is_new)
           ORDER BY is_new ASC, activity_score ASC, full_name ASC), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT * FROM scored
        ORDER BY is_new ASC, activity_score ASC, full_name ASC
        LIMIT p_limit OFFSET p_offset) scored;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $function$;

-- The coordinator twin MUST return the same shape or the shared TeachersTableRow
-- type renders undefined chips on /school/snapshot. Lessons and registers are
-- additionally narrowed to the coordinator's own classes; homework and exams are
-- authored by the teacher, so they are already teacher-scoped.
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
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL AND df.subject_type='teacher' AND df.subject_key=st.user_id::text) AS active_flags
    FROM staff st JOIN profiles p ON p.id=st.user_id),
  scored AS (
    SELECT e.*, (e.lessons_30d + e.attendance_days_30d + e.homework_30d + e.exams_30d) AS activity_score,
           (e.profile_created > now() - INTERVAL '7 days') AS is_new
    FROM enriched e)
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'name',full_name,'role',role,'wing',wing,
           'classes',classes,
           'lessons_30d',lessons_30d,'attendance_days_30d',attendance_days_30d,
           'homework_30d',homework_30d,'exams_30d',exams_30d,'activity_score',activity_score,
           'last_login',last_login,'active_flags',active_flags,'is_new',is_new)
           ORDER BY is_new ASC, activity_score ASC, full_name ASC),'[]'::jsonb)
    INTO v_rows FROM (SELECT * FROM scored
      ORDER BY is_new ASC, activity_score ASC, full_name ASC LIMIT p_limit OFFSET p_offset) scored;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END $function$;
