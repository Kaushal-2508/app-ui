-- Coordinator dashboard, phase 2: adoption + academics panels.
--
-- Every function here resolves its own scope from dash_resolve_scoped_classes()
-- (wing for a coordinator, taught classes for a teacher, whole institution for
-- an admin) so no wing/class parameter is ever accepted from the client.
--
-- All list payloads are {rows, total} with LIMIT/OFFSET; all counts and
-- averages are aggregated in SQL. Nothing here returns an unbounded set.

-- ---------------------------------------------------------------------------
-- 1. Student portal adoption, scoped. Mirrors dash_student_portal_adoption but
--    over the caller's own classes, and adds the per-class breakdown the
--    coordinator view needs ("which of my classes is worst?").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_student_portal_adoption(p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_total int; v_never int; v_1d int; v_7d int; v_30d int;
  v_never_list jsonb;
  v_by_class jsonb;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'never_signed_in', 0, 'active_1d', 0,
                              'active_7d', 0, 'active_30d', 0,
                              'never_list', '[]'::jsonb, 'by_class', '[]'::jsonb);
  END IF;

  WITH students AS (
    SELECT DISTINCT p.id, u.last_sign_in_at
      FROM class_assignments ca
      JOIN profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE
      LEFT JOIN auth.users u ON u.id = p.id
     WHERE ca.class_id = ANY(v_class_ids)
       AND ca.role::text = 'student'
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE last_sign_in_at IS NULL)::int,
         count(*) FILTER (WHERE last_sign_in_at >= now() - INTERVAL '1 day')::int,
         count(*) FILTER (WHERE last_sign_in_at >= now() - INTERVAL '7 days')::int,
         count(*) FILTER (WHERE last_sign_in_at >= now() - INTERVAL '30 days')::int
    INTO v_total, v_never, v_1d, v_7d, v_30d
    FROM students;

  -- Bounded sample of students who have never opened the portal.
  SELECT COALESCE(jsonb_agg(x ORDER BY nm), '[]'::jsonb) INTO v_never_list
    FROM (
      SELECT COALESCE(p.full_name, p.email) AS nm,
             jsonb_build_object(
               'student_id', p.id,
               'name', COALESCE(p.full_name, p.email),
               'class', (SELECT string_agg(DISTINCT c.name ||
                                CASE WHEN COALESCE(c.section,'') <> ''
                                     THEN ' ' || c.section ELSE '' END, ', ')
                           FROM class_assignments ca2
                           JOIN classes c ON c.id = ca2.class_id
                          WHERE ca2.user_id = p.id
                            AND ca2.role::text = 'student'
                            AND ca2.class_id = ANY(v_class_ids))
             ) AS x
        FROM (SELECT DISTINCT ca.user_id FROM class_assignments ca
               WHERE ca.class_id = ANY(v_class_ids) AND ca.role::text = 'student') s
        JOIN profiles p ON p.id = s.user_id AND p.is_active IS NOT FALSE
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE u.last_sign_in_at IS NULL
       ORDER BY nm
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50)
    ) q;

  -- Weakest classes first: the coordinator acts on a class, not on the wing.
  SELECT COALESCE(jsonb_agg(x ORDER BY pct ASC NULLS FIRST), '[]'::jsonb) INTO v_by_class
    FROM (
      SELECT CASE WHEN count(*) > 0
                  THEN round(count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')
                             * 100.0 / count(*), 1)
             END AS pct,
             jsonb_build_object(
               'class_id', c.id,
               'class_name', c.name || CASE WHEN COALESCE(c.section,'') <> ''
                                            THEN ' ' || c.section ELSE '' END,
               'students', count(*)::int,
               'active_30d', count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')::int,
               'never', count(*) FILTER (WHERE u.last_sign_in_at IS NULL)::int,
               'pct', CASE WHEN count(*) > 0
                           THEN round(count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')
                                      * 100.0 / count(*), 1)
                      END
             ) AS x
        FROM classes c
        JOIN class_assignments ca ON ca.class_id = c.id AND ca.role::text = 'student'
        JOIN profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE c.id = ANY(v_class_ids)
       GROUP BY c.id, c.name, c.section
    ) q;

  RETURN jsonb_build_object(
    'total', v_total,
    'never_signed_in', v_never,
    'active_1d', v_1d,
    'active_7d', v_7d,
    'active_30d', v_30d,
    'pct_active_7d',  CASE WHEN v_total > 0 THEN round(v_7d  * 100.0 / v_total, 1) END,
    'pct_active_30d', CASE WHEN v_total > 0 THEN round(v_30d * 100.0 / v_total, 1) END,
    'never_list', v_never_list,
    'by_class', v_by_class
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 2. Teacher adoption, scoped. NEW concept: "are MY teachers using SALCI?".
--
--    Four signals were specified. Two are backed by real data and two are
--    reported as unavailable rather than faked, because reporting 0% for a
--    module nobody uses reads as a teacher failure rather than a rollout gap:
--      login_recency        -> auth.users.last_sign_in_at            (available)
--      exams_in_system      -> exams.created_by + finalized attempts (available)
--      attendance_digital   -> attendance_records.method             (available
--                              only if more than one method is in use)
--      syllabus_pacing      -> syllabus_progress_events              (available
--                              only if the wing has logged any event)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_teacher_adoption(p_limit integer DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_total int; v_never int; v_1d int; v_7d int; v_30d int;
  v_exams_total int; v_exams_graded int;
  v_att_methods int; v_syllabus_events int;
  v_laggards jsonb;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL OR v_inst IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'laggards', '[]'::jsonb);
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  WITH teachers AS (
    SELECT DISTINCT p.id, u.last_sign_in_at
      FROM class_assignments ca
      JOIN profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE
      LEFT JOIN auth.users u ON u.id = p.id
     WHERE ca.class_id = ANY(v_class_ids)
       AND ca.role::text = 'teacher'
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE last_sign_in_at IS NULL)::int,
         count(*) FILTER (WHERE last_sign_in_at >= now() - INTERVAL '1 day')::int,
         count(*) FILTER (WHERE last_sign_in_at >= now() - INTERVAL '7 days')::int,
         count(*) FILTER (WHERE last_sign_in_at >= now() - INTERVAL '30 days')::int
    INTO v_total, v_never, v_1d, v_7d, v_30d
    FROM teachers;

  -- Exams in-system: of the attempts sat by this scope's students in the
  -- current academic year, how many were carried through to a final result.
  SELECT count(*)::int,
         count(*) FILTER (WHERE fr.id IS NOT NULL)::int
    INTO v_exams_total, v_exams_graded
    FROM student_exam_attempts a
    JOIN exams e ON e.id = a.exam_id
    LEFT JOIN final_results fr ON fr.attempt_id = a.id
   WHERE a.class_id = ANY(v_class_ids)
     AND e.institution_id = v_inst
     AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
         BETWEEN v_ay_start AND v_ay_end;

  -- Availability probes for the two signals that may have no data at all.
  SELECT count(DISTINCT ar.method)::int INTO v_att_methods
    FROM attendance_records ar
   WHERE ar.class_id = ANY(v_class_ids)
     AND ar.date > v_today - 30;

  SELECT count(*)::int INTO v_syllabus_events
    FROM syllabus_progress_events spe
   WHERE spe.class_id = ANY(v_class_ids);

  -- Laggards, worst pattern first: never signed in, then longest inactive.
  SELECT COALESCE(jsonb_agg(x ORDER BY sort_key), '[]'::jsonb) INTO v_laggards
    FROM (
      SELECT CASE WHEN u.last_sign_in_at IS NULL THEN '0'
                  ELSE '1' || to_char(u.last_sign_in_at, 'YYYYMMDDHH24MISS') END AS sort_key,
             jsonb_build_object(
               'teacher_id', p.id,
               'name', COALESCE(p.full_name, p.email),
               'last_sign_in_at', u.last_sign_in_at,
               'days_inactive', CASE WHEN u.last_sign_in_at IS NOT NULL
                                     THEN (v_today - u.last_sign_in_at::date) END,
               'classes', (SELECT string_agg(DISTINCT c.name ||
                                CASE WHEN COALESCE(c.section,'') <> ''
                                     THEN ' ' || c.section ELSE '' END, ', ')
                             FROM class_assignments ca2
                             JOIN classes c ON c.id = ca2.class_id
                            WHERE ca2.user_id = p.id
                              AND ca2.role::text = 'teacher'
                              AND ca2.class_id = ANY(v_class_ids)),
               'exams_created', (SELECT count(*)::int FROM exams e
                                  WHERE e.created_by = p.id
                                    AND e.institution_id = v_inst
                                    AND COALESCE(e.published_at::date, e.scheduled_date::date,
                                                 e.created_at::date)
                                        BETWEEN v_ay_start AND v_ay_end)
             ) AS x
        FROM (SELECT DISTINCT ca.user_id FROM class_assignments ca
               WHERE ca.class_id = ANY(v_class_ids) AND ca.role::text = 'teacher') t
        JOIN profiles p ON p.id = t.user_id AND p.is_active IS NOT FALSE
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE u.last_sign_in_at IS NULL
          OR u.last_sign_in_at < now() - INTERVAL '7 days'
       ORDER BY sort_key
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 15), 1), 50)
    ) q;

  RETURN jsonb_build_object(
    'total', v_total,
    'never_signed_in', v_never,
    'active_1d', v_1d,
    'active_7d', v_7d,
    'active_30d', v_30d,
    'signals', jsonb_build_array(
      jsonb_build_object(
        'key', 'login_recency', 'label', 'Logged in this week',
        'available', true,
        'value', v_7d, 'of', v_total,
        'pct', CASE WHEN v_total > 0 THEN round(v_7d * 100.0 / v_total, 1) END),
      jsonb_build_object(
        'key', 'exams_in_system', 'label', 'Exams carried through to results',
        'available', v_exams_total > 0,
        'value', v_exams_graded, 'of', v_exams_total,
        'pct', CASE WHEN v_exams_total > 0
                    THEN round(v_exams_graded * 100.0 / v_exams_total, 1) END,
        'unavailable_reason', CASE WHEN v_exams_total = 0
                                   THEN 'No exams sat in this academic year yet' END),
      jsonb_build_object(
        'key', 'attendance_digital', 'label', 'Attendance marked digitally',
        -- One distinct method means every row was recorded the same way, so the
        -- signal cannot separate digital from paper. Say so, do not report 100%.
        'available', v_att_methods > 1,
        'value', NULL, 'of', NULL, 'pct', NULL,
        'unavailable_reason', CASE WHEN v_att_methods = 0
                                   THEN 'No attendance recorded in the last 30 days'
                                   WHEN v_att_methods = 1
                                   THEN 'Every record uses the same marking method, so digital and paper cannot be told apart'
                              END),
      jsonb_build_object(
        'key', 'syllabus_pacing', 'label', 'Syllabus progress logged',
        'available', v_syllabus_events > 0,
        'value', NULL, 'of', NULL, 'pct', NULL,
        'unavailable_reason', CASE WHEN v_syllabus_events = 0
                                   THEN 'No syllabus progress has ever been logged for these classes' END)
    ),
    'laggards', v_laggards
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Class performance, scoped: average score per class with the scope average
--    as the reference line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_class_performance()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_rows jsonb; v_avg numeric;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL OR v_inst IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'scope_avg_pct', NULL);
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  SELECT COALESCE(jsonb_agg(x ORDER BY avg_pct ASC), '[]'::jsonb), round(avg(avg_pct), 1)
    INTO v_rows, v_avg
    FROM (
      SELECT round(avg(fr.percentage), 1) AS avg_pct,
             jsonb_build_object(
               'class_id', c.id,
               'class_name', c.name || CASE WHEN COALESCE(c.section,'') <> ''
                                            THEN ' ' || c.section ELSE '' END,
               'avg_pct', round(avg(fr.percentage), 1),
               'results', count(*)::int,
               'students', count(DISTINCT a.student_id)::int
             ) AS x
        FROM classes c
        JOIN student_exam_attempts a ON a.class_id = c.id
        JOIN final_results fr ON fr.attempt_id = a.id
        JOIN exams e ON e.id = a.exam_id
       WHERE c.id = ANY(v_class_ids)
         AND e.institution_id = v_inst
         AND e.status IN ('published', 'active', 'completed')
         AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
             BETWEEN v_ay_start AND v_ay_end
       GROUP BY c.id, c.name, c.section
    ) q;

  RETURN jsonb_build_object('rows', v_rows, 'scope_avg_pct', v_avg);
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Attendance logging compliance, scoped. "Which of my classes has not
--    logged attendance today, and who is chronically behind."
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_attendance_compliance(p_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz text; v_today date; v_days int;
  v_working_days int; v_latest date;
  v_missing_today int; v_total_classes int;
  v_rows jsonb;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL OR v_inst IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total_classes', 0,
                              'missing_today', 0, 'latest_date', NULL,
                              'working_days', 0);
  END IF;

  v_days := LEAST(GREATEST(COALESCE(p_days, 14), 1), 60);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  v_total_classes := array_length(v_class_ids, 1);

  -- Working days = dates on which ANY class in the institution marked
  -- attendance. The deliberate proxy used across the dash_* family.
  SELECT count(DISTINCT ar.date)::int, max(ar.date)
    INTO v_working_days, v_latest
    FROM attendance_records ar
   WHERE ar.institution_id = v_inst
     AND ar.date > v_today - v_days;

  SELECT count(*)::int INTO v_missing_today
    FROM unnest(v_class_ids) AS cid
   WHERE v_latest IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM attendance_records ar
                      WHERE ar.class_id = cid AND ar.date = v_latest);

  SELECT COALESCE(jsonb_agg(x ORDER BY pct ASC NULLS FIRST), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT CASE WHEN v_working_days > 0
                  THEN round(count(DISTINCT ar.date) * 100.0 / v_working_days, 1) END AS pct,
             jsonb_build_object(
               'class_id', c.id,
               'class_name', c.name || CASE WHEN COALESCE(c.section,'') <> ''
                                            THEN ' ' || c.section ELSE '' END,
               'days_marked', count(DISTINCT ar.date)::int,
               'days_expected', v_working_days,
               'pct', CASE WHEN v_working_days > 0
                           THEN round(count(DISTINCT ar.date) * 100.0 / v_working_days, 1) END,
               'last_marked', max(ar.date),
               'missing_latest', (v_latest IS NOT NULL AND max(ar.date) IS DISTINCT FROM v_latest)
             ) AS x
        FROM classes c
        LEFT JOIN attendance_records ar
               ON ar.class_id = c.id AND ar.date > v_today - v_days
       WHERE c.id = ANY(v_class_ids)
       GROUP BY c.id, c.name, c.section
    ) q;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total_classes', v_total_classes,
    'missing_today', v_missing_today,
    'latest_date', v_latest,
    'working_days', v_working_days
  );
END
$function$;

-- Lock every new function down: Supabase grants EXECUTE to both anon (by name)
-- and PUBLIC (which anon inherits); revoking one does not strip the other.
REVOKE EXECUTE ON FUNCTION public.dash_scoped_student_portal_adoption(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash_scoped_teacher_adoption(integer)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash_scoped_class_performance()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash_scoped_attendance_compliance(integer)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dash_scoped_student_portal_adoption(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_teacher_adoption(integer)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_class_performance()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_attendance_compliance(integer)   TO authenticated;
