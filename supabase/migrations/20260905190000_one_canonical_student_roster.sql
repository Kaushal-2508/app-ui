-- One canonical student roster, used everywhere (2026-09-05)
-- ============================================================================
-- The Command Center showed two different student totals on the same screen:
-- "Students 253" / "Total students: 253" on the roster tile, and "0 of 252
-- logged in" plus "240 students have never logged in" in the adoption panel.
--
-- Neither was miscalculating. They were counting different populations:
--   * profiles + user_roles  -> student ACCOUNTS owned by the institution
--   * class_assignments      -> students ASSIGNED to one of its classes
-- and the two disagree wherever the data has drifted. Across prod the gap runs
-- BOTH ways: Salci National 253/252, Iscool 17/12, Vanshika 42/44,
-- Alliance 1542/1545.
--
-- A survey of all 487 public functions found the platform had already settled
-- this argument in practice: 35 functions count students through
-- class_assignments and only 6 through profiles. Attendance, homework, exams
-- and results all key on the class roster, so a student with no class cannot
-- receive anything and should not inflate a denominator.
--
-- So: ONE definition, in ONE place, that every caller uses.
--
-- Verified before adopting: gating additionally on profile.is_active, on the
-- student role, and on class.is_active produces IDENTICAL counts in every
-- institution today, so the strict form is adopted at zero cost.

-- ── 1. The canonical roster ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.institution_student_ids(_institution uuid)
RETURNS TABLE (student_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT ca.user_id
    FROM public.class_assignments ca
    JOIN public.classes c ON c.id = ca.class_id
    JOIN public.profiles p ON p.id = ca.user_id
   WHERE c.institution_id = _institution
     AND ca.role = 'student'
     AND p.is_active IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = ca.user_id AND ur.role::text = 'student')
$function$;

COMMENT ON FUNCTION public.institution_student_ids(uuid) IS
  'THE definition of "the students of this institution": assigned to one of its classes, active profile, holds the student role. Every student total on every surface must come from here - two hand-rolled definitions is what put 253 and 252 on the same dashboard. Deliberately keyed on class_assignments, not profiles.institution_id: a student with no class receives no attendance, homework or exams and must not inflate a denominator.';

REVOKE ALL ON FUNCTION public.institution_student_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.institution_student_ids(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.institution_student_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.institution_student_ids(uuid) TO service_role;

-- ── 2. Every profiles-based student total repointed at it ──────────────────
-- Generated from the live prod definitions with anchored replacements, each
-- asserted to match exactly once, and each function re-checked afterwards for
-- any surviving profiles-based student join.

-- dash_admin_roster_counts: student roster now comes from institution_student_ids()
CREATE OR REPLACE FUNCTION public.dash_admin_roster_counts(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT count(*) INTO v_students
    FROM public.institution_student_ids(v_inst);

  -- "ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ² N this month" on the students tile
  SELECT count(*) INTO v_students_new
    FROM public.institution_student_ids(v_inst) s
    JOIN public.profiles p ON p.id = s.student_id
   WHERE p.created_at >= (v_today - INTERVAL '30 days');

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
END $function$;

-- dash_admin_digest: student roster now comes from institution_student_ids()
CREATE OR REPLACE FUNCTION public.dash_admin_digest(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(code text, severity text, headline text, detail text, link_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_students int; v_never int; v_active30 int;
  v_wk numeric; v_pwk numeric;
  v_subj text; v_subj_pct numeric;
  v_class text; v_class_pct numeric;
  v_unmarked int; v_classes int;
  v_low_notices int; v_notices int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  -- ---- 1. portal adoption ------------------------------------------------
  SELECT count(*),
         count(*) FILTER (WHERE u.last_sign_in_at IS NULL),
         count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')
    INTO v_students, v_never, v_active30
    FROM public.institution_student_ids(v_inst) s
    LEFT JOIN auth.users u ON u.id = s.student_id;

  IF v_students > 0 AND v_never > 0 THEN
    RETURN QUERY SELECT
      'portal_adoption',
      CASE WHEN v_never * 100.0 / v_students >= 50 THEN 'high'
           WHEN v_never * 100.0 / v_students >= 20 THEN 'medium'
           ELSE 'low' END,
      v_never || ' of ' || v_students || ' students have never signed in',
      'They cannot see homework, notices or results, so nothing else on this '
        || 'dashboard reaches them. Only ' || v_active30
        || ' signed in during the last 30 days.',
      '/school/students';
  END IF;

  -- ---- 2. weakest subject (>= 5 results, so one bad paper is not a trend) --
  SELECT subject_name, school_avg INTO v_subj, v_subj_pct
    FROM public.dash_school_subject_performance(v_inst)
   WHERE results >= 5
   ORDER BY school_avg ASC
   LIMIT 1;

  IF v_subj IS NOT NULL THEN
    RETURN QUERY SELECT
      'weakest_subject',
      CASE WHEN v_subj_pct < 50 THEN 'high'
           WHEN v_subj_pct < 65 THEN 'medium' ELSE 'low' END,
      v_subj || ' is your weakest subject school-wide at ' || v_subj_pct || '%',
      'Averaged across every graded exam this academic year.',
      '/school/analytics';
  END IF;

  -- ---- 3. weakest class ---------------------------------------------------
  SELECT c.name || CASE WHEN coalesce(c.section,'') <> '' THEN '-' || c.section ELSE '' END,
         round(avg(fr.percentage), 1)
    INTO v_class, v_class_pct
    FROM classes c
    JOIN class_assignments ca ON ca.class_id = c.id AND ca.role::text = 'student'
    JOIN student_exam_attempts a ON a.student_id = ca.user_id
    JOIN final_results fr ON fr.attempt_id = a.id
    JOIN exams e ON e.id = a.exam_id
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND e.status IN ('published','active','completed')
     AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
         BETWEEN v_ay_start AND v_ay_end
   GROUP BY 1
  HAVING count(*) >= 5
   ORDER BY 2 ASC
   LIMIT 1;

  IF v_class IS NOT NULL AND v_class_pct < 65 THEN
    RETURN QUERY SELECT
      'weakest_class',
      CASE WHEN v_class_pct < 50 THEN 'high' ELSE 'medium' END,
      v_class || ' is your lowest-scoring class at ' || v_class_pct || '%',
      'Sitting below the 65% band across recent exams.',
      '/school/classes';
  END IF;

  -- ---- 4. attendance week over week --------------------------------------
  SELECT round(count(*) FILTER (WHERE status IN ('present','late')) * 100.0
               / NULLIF(count(*), 0), 1) INTO v_wk
    FROM attendance_records
   WHERE institution_id = v_inst AND date > v_today - 7 AND date <= v_today;
  SELECT round(count(*) FILTER (WHERE status IN ('present','late')) * 100.0
               / NULLIF(count(*), 0), 1) INTO v_pwk
    FROM attendance_records
   WHERE institution_id = v_inst AND date > v_today - 14 AND date <= v_today - 7;

  IF v_wk IS NOT NULL AND v_pwk IS NOT NULL AND abs(v_wk - v_pwk) >= 1 THEN
    RETURN QUERY SELECT
      'attendance_trend',
      CASE WHEN v_wk - v_pwk <= -3 THEN 'high'
           WHEN v_wk - v_pwk <  0  THEN 'medium' ELSE 'low' END,
      'Attendance ' || CASE WHEN v_wk > v_pwk THEN 'rose ' ELSE 'dipped ' END
        || round(abs(v_wk - v_pwk), 1) || 'pp vs last week',
      'Now ' || v_wk || '%, was ' || v_pwk || '%.',
      '/school/attendance';
  END IF;

  -- ---- 5. classes not marking attendance ---------------------------------
  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_unmarked
    FROM classes c
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND NOT EXISTS (
       SELECT 1 FROM attendance_records ar
        WHERE ar.class_id = c.id
          AND ar.date > v_today - 14 AND ar.date <= v_today);

  IF v_unmarked > 0 THEN
    RETURN QUERY SELECT
      'attendance_compliance',
      CASE WHEN v_unmarked * 100.0 / GREATEST(v_classes, 1) >= 50 THEN 'high'
           ELSE 'medium' END,
      v_unmarked || ' of ' || v_classes
        || ' classes have not marked attendance in 14 days',
      'Their attendance figures elsewhere on this page are not measuring '
        || 'anything until the register is taken.',
      '/school/attendance';
  END IF;

  -- ---- 6. notices nobody opened ------------------------------------------
  SELECT count(*), count(*) FILTER (
           WHERE n.recipient_count > 0
             AND (SELECT count(*) FROM notice_recipients r
                   WHERE r.notice_id = n.id AND r.read_at IS NOT NULL)
                 * 100.0 / n.recipient_count < 40)
    INTO v_notices, v_low_notices
    FROM notices n
   WHERE n.institution_id = v_inst
     AND n.published_at >= now() - INTERVAL '30 days';

  IF v_low_notices > 0 THEN
    RETURN QUERY SELECT
      'notice_reach',
      'medium',
      v_low_notices || ' of ' || v_notices
        || ' recent notices were read by under 40% of their audience',
      'A notice with low reach did not fail to send, it failed to land.',
      '/school/notices';
  END IF;

  RETURN;
END $function$;

-- badge_rarity: student roster now comes from institution_student_ids()
CREATE OR REPLACE FUNCTION public.badge_rarity()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_total int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT count(*) INTO v_total
  FROM public.institution_student_ids(v_inst);

  RETURN COALESCE((
    SELECT jsonb_object_agg(x.badge_id, jsonb_build_object(
             'holders', x.holders,
             -- NULL rather than 0 when the cohort is empty: "earned by 0%" is a
             -- claim, "unknown" is the truth.
             'percent', CASE WHEN v_total > 0
                             THEN round(x.holders * 100.0 / v_total, 1) END))
    FROM (
      SELECT ub.badge_id, count(DISTINCT ub.user_id) AS holders
      FROM user_badges ub
      JOIN profiles p2 ON p2.id = ub.user_id
      WHERE p2.institution_id = v_inst
      GROUP BY ub.badge_id
    ) x
  ), '{}'::jsonb);
END $function$;

-- dash_student_portal_adoption: student roster now comes from institution_student_ids()
CREATE OR REPLACE FUNCTION public.dash_student_portal_adoption(p_institution_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 8, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_now timestamptz;
  v_total int; v_never int; v_7d int; v_30d int;
  v_laggards jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_now := now();

  -- A class from another institution must not silently return zeroes and read
  -- as "nobody here has ever signed in".
  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  WITH students AS (
    SELECT p.id, p.full_name, u.last_sign_in_at
      FROM public.institution_student_ids(v_inst) sr
      JOIN public.profiles p ON p.id = sr.student_id
      LEFT JOIN auth.users u ON u.id = p.id
     WHERE (p_class_id IS NULL OR EXISTS (
             SELECT 1 FROM class_assignments ca
              WHERE ca.user_id = p.id AND ca.role::text = 'student'
                AND ca.class_id = p_class_id))
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
        FROM public.institution_student_ids(v_inst) sr
        JOIN public.profiles p ON p.id = sr.student_id
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE u.last_sign_in_at IS NULL
         AND (p_class_id IS NULL OR EXISTS (
               SELECT 1 FROM class_assignments ca
                WHERE ca.user_id = p.id AND ca.role::text = 'student'
                  AND ca.class_id = p_class_id))
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
END $function$;

-- ── 3. Scalar companion for callers that only want the number ──────────────
-- Scalar companion to institution_student_ids(), for callers that just want the
-- number. Kept as a wrapper (not a second query) so there is still exactly ONE
-- definition of the roster to change.
CREATE OR REPLACE FUNCTION public.institution_student_count(_institution uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::int FROM public.institution_student_ids(_institution);
$function$;

COMMENT ON FUNCTION public.institution_student_count(uuid) IS
  'Row count of institution_student_ids(). Use this for any "total students" figure - it cannot drift from the roster because it IS the roster.';

REVOKE ALL ON FUNCTION public.institution_student_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.institution_student_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.institution_student_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.institution_student_count(uuid) TO service_role;
