-- The five data sources the admin-dashboard blueprint needed and did not have.
--
-- Each follows the existing dash_* conventions exactly: resolve the institution
-- through dash_resolve_institution (so a super admin managing a school gets
-- that school), take "today" in the INSTITUTION's timezone rather than UTC
-- (§24 -- a bare CURRENT_DATE re-introduces the 2026-05-25 bug where auto-mark
-- was dead for every IST school until 13:30 IST), aggregate server-side, and
-- return one jsonb payload so the client never counts rows.
BEGIN;

/*
 * Roster counts + present-today, for the blueprint's five KPI tiles.
 *
 * dash_kpi_summary returns none of these -- it returns school average,
 * attendance percentage, students needing help and decisions waiting. This is
 * the headcount half.
 *
 * Student and staff attendance live in SEPARATE tables (attendance_records vs
 * staff_attendance_records) with different status vocabularies, so each is
 * counted against its own.
 */
CREATE OR REPLACE FUNCTION public.dash_admin_roster_counts(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_students int; v_students_new int;
  v_staff int; v_classes int; v_wings int;
  v_s_present int; v_s_total int;
  v_t_present int; v_t_total int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(DISTINCT p.id) INTO v_students
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE;

  -- "▲ N this month" on the students tile
  SELECT count(DISTINCT p.id) INTO v_students_new
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND p.created_at >= (v_today - INTERVAL '30 days');

  SELECT count(DISTINCT p.id) INTO v_staff
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND ur.role::text IN ('teacher','coordinator','school_admin','super_school_admin','employee');

  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_wings
    FROM wings WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_s_present, v_s_total
    FROM attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_t_present, v_t_total
    FROM staff_attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  RETURN jsonb_build_object(
    'students', jsonb_build_object('count', v_students, 'new_30d', v_students_new),
    'staff',    jsonb_build_object('count', v_staff),
    'classes',  jsonb_build_object('count', v_classes, 'wings', v_wings),
    'students_present', jsonb_build_object(
       'present', v_s_present, 'total', v_s_total, 'marked', v_s_total > 0,
       'pct', CASE WHEN v_s_total > 0 THEN round(v_s_present*100.0/v_s_total, 1) END),
    'staff_present', jsonb_build_object(
       'present', v_t_present, 'total', v_t_total, 'marked', v_t_total > 0,
       'pct', CASE WHEN v_t_total > 0 THEN round(v_t_present*100.0/v_t_total, 1) END)
  );
END $$;

/*
 * Student portal adoption: "Are your students using SALCI?" + "Not using the
 * portal".
 *
 * The only sign-in signal on this database is auth.users.last_sign_in_at --
 * `profiles` has no activity column at all. That table is not readable under
 * RLS, which is exactly why this is SECURITY DEFINER: it exposes aggregate
 * counts and a short never-signed-in list, never the auth rows themselves.
 */
CREATE OR REPLACE FUNCTION public.dash_student_portal_adoption(
  p_institution_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 8
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_now timestamptz;
  v_total int; v_never int; v_7d int; v_30d int;
  v_laggards jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_now := now();

  WITH students AS (
    SELECT p.id, p.full_name, u.last_sign_in_at
      FROM profiles p
      JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
      LEFT JOIN auth.users u ON u.id = p.id
     WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
  )
  SELECT count(*),
         count(*) FILTER (WHERE last_sign_in_at IS NULL),
         count(*) FILTER (WHERE last_sign_in_at >= v_now - INTERVAL '7 days'),
         count(*) FILTER (WHERE last_sign_in_at >= v_now - INTERVAL '30 days')
    INTO v_total, v_never, v_7d, v_30d
    FROM students;

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_laggards
    FROM (
      SELECT jsonb_build_object(
               'student_id', p.id,
               'name', coalesce(p.full_name, p.email),
               'class', (SELECT string_agg(DISTINCT c.name || CASE WHEN coalesce(c.section,'') <> ''
                                                                   THEN '-' || c.section ELSE '' END, ', ')
                           FROM class_assignments ca
                           JOIN classes c ON c.id = ca.class_id
                          WHERE ca.user_id = p.id AND ca.role::text = 'student'),
               'last_sign_in_at', u.last_sign_in_at) AS x
        FROM profiles p
        JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
         AND u.last_sign_in_at IS NULL
       ORDER BY coalesce(p.full_name, p.email)
       LIMIT LEAST(GREATEST(coalesce(p_limit, 8), 1), 50)
    ) s;

  RETURN jsonb_build_object(
    'total', v_total,
    'never_signed_in', v_never,
    'active_7d', v_7d,
    'active_30d', v_30d,
    'pct_active_7d',  CASE WHEN v_total > 0 THEN round(v_7d *100.0/v_total, 1) END,
    'pct_active_30d', CASE WHEN v_total > 0 THEN round(v_30d*100.0/v_total, 1) END,
    'never_list', v_laggards
  );
END $$;

/*
 * Coordinators by wing performance.
 *
 * A wing's score is the average of recent exam results across the classes
 * mapped to it. Wings with no mapped classes, or no results, come back with a
 * NULL pct rather than a zero -- "no data" and "scored zero" are different
 * facts and a bar chart cannot show the difference.
 */
CREATE OR REPLACE FUNCTION public.dash_wing_performance(
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE(
  wing_id uuid, wing_name text, coordinators text, classes integer,
  students integer, avg_pct numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  SELECT w.id,
         w.name,
         (SELECT string_agg(coalesce(p.full_name, p.email), ', ')
            FROM wing_assignments wa
            JOIN profiles p ON p.id = wa.user_id
            JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'coordinator'
           WHERE wa.wing_id = w.id AND p.is_active IS NOT FALSE),
         (SELECT count(*)::int FROM wing_class_mappings m WHERE m.wing_id = w.id),
         (SELECT count(DISTINCT ca.user_id)::int
            FROM wing_class_mappings m
            JOIN class_assignments ca ON ca.class_id = m.class_id AND ca.role::text = 'student'
           WHERE m.wing_id = w.id),
         (SELECT round(avg(fr.percentage), 1)
            FROM wing_class_mappings m
            JOIN class_assignments ca ON ca.class_id = m.class_id AND ca.role::text = 'student'
            JOIN student_exam_attempts a ON a.student_id = ca.user_id
            JOIN final_results fr ON fr.attempt_id = a.id
            JOIN exams e ON e.id = a.exam_id
           WHERE m.wing_id = w.id
             AND e.institution_id = v_inst
             AND e.status IN ('published','active','completed')
             AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                 BETWEEN v_ay_start AND v_ay_end)
    FROM wings w
   WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
   ORDER BY 6 ASC NULLS LAST, w.name;
END $$;

/*
 * Attendance logging compliance: is anyone actually marking it?
 *
 * Reports, per class, how many of the last p_days SCHOOL days have any
 * attendance row. Counting distinct marked dates rather than rows, because one
 * class marking 40 students still only covers one day.
 */
CREATE OR REPLACE FUNCTION public.dash_attendance_compliance(
  p_institution_id uuid DEFAULT NULL,
  p_days integer DEFAULT 14
) RETURNS TABLE(
  class_id uuid, class_name text, days_marked integer, days_expected integer,
  pct numeric, last_marked date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_days int; v_expected int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  v_days := LEAST(GREATEST(coalesce(p_days, 14), 1), 90);

  -- Expected = weekdays in the window. Sunday is not a school day, and holidays
  -- would need the academic calendar; treating every calendar day as expected
  -- would make every class look non-compliant by ~2/7ths.
  SELECT count(*)::int INTO v_expected
    FROM generate_series(v_today - (v_days - 1), v_today, INTERVAL '1 day') d
   WHERE extract(isodow FROM d) < 7;

  RETURN QUERY
  SELECT c.id,
         c.name || CASE WHEN coalesce(c.section,'') <> '' THEN '-' || c.section ELSE '' END,
         coalesce(m.marked_days, 0)::int,
         v_expected,
         CASE WHEN v_expected > 0
              THEN round(coalesce(m.marked_days, 0) * 100.0 / v_expected, 1) END,
         m.last_day
    FROM classes c
    LEFT JOIN (
      SELECT ar.class_id,
             count(DISTINCT ar.date) AS marked_days,
             max(ar.date) AS last_day
        FROM attendance_records ar
       WHERE ar.institution_id = v_inst
         AND ar.date > v_today - v_days
         AND ar.date <= v_today
       GROUP BY ar.class_id
    ) m ON m.class_id = c.id
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
   ORDER BY 5 ASC NULLS FIRST, c.name;
END $$;

/*
 * Recent + upcoming calendar events, for the Communication section.
 * Upcoming first, then the most recent past ones, which is what a principal
 * scanning the page actually wants.
 */
CREATE OR REPLACE FUNCTION public.dash_recent_events(
  p_institution_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 6
) RETURNS TABLE(
  event_id uuid, title text, kind text, starts_on date, ends_on date,
  is_upcoming boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  RETURN QUERY
  SELECT e.id, e.title, e.kind, e.starts_on, e.ends_on,
         (e.starts_on >= v_today) AS is_upcoming
    FROM cal_events e
   WHERE e.institution_id = v_inst
     AND e.starts_on >= v_today - INTERVAL '30 days'
   ORDER BY (e.starts_on >= v_today) DESC,
            CASE WHEN e.starts_on >= v_today THEN e.starts_on END ASC,
            CASE WHEN e.starts_on <  v_today THEN e.starts_on END DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 6), 1), 30);
END $$;

REVOKE EXECUTE ON FUNCTION public.dash_admin_roster_counts(uuid)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.dash_student_portal_adoption(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dash_wing_performance(uuid)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.dash_attendance_compliance(uuid, integer)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.dash_recent_events(uuid, integer)           FROM anon;

GRANT EXECUTE ON FUNCTION public.dash_admin_roster_counts(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_student_portal_adoption(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_wing_performance(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_attendance_compliance(uuid, integer)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_recent_events(uuid, integer)           TO authenticated;

COMMIT;
