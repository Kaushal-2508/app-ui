-- Fix: portal adoption reported on the wrong population with a metric that
-- rounds real activity to zero.
--
-- MEASURED IN PROD (Teacher2, Class 12 Science Non-Medical A, 2026-08-19):
--   class students ................ 9
--   dashboard roster used ......... 1   (teacher_roster_student_ids: English Core
--                                        is is_optional=true with 0 enrolments)
--   students active in 30 days .... 1   (student2, last sign-in 2026-08-18)
--   "30-day avg" as displayed ..... 0   (1 student-day / 30 = 0.033 -> 0.0)
--
-- So the card said "0 / 0% of your students" while a student had signed in the
-- previous day, and the companion card said "Everyone is using the portal"
-- because the only pupil in its 1-person roster was active. Both readings were
-- false to the teacher, whose class has 9 children of whom 8 have not opened
-- SALCI since February-May.
--
-- TWO CHANGES
-- 1. POPULATION. Portal adoption and the laggards list now use every student in
--    the classes the teacher is assigned to, NOT the optional-subject roster.
--    "Is this child using the portal" is a pastoral question about the class the
--    teacher stands in front of; it is not gated on which optional subject the
--    child picked. This is not a scope leak: every one of these students is in a
--    class this teacher is assigned to. Subject narrowing still governs the
--    ACADEMIC panels (2.4 / 2.5 / 2.6), where it belongs.
-- 2. METRIC. "7/30-day daily average" is replaced by DISTINCT STUDENTS ACTIVE AT
--    LEAST ONCE in the window. An average-per-day over a small class is always a
--    fraction and always rounds to 0, which reads as "nobody" when the truth is
--    "one". Counts of people are what the teacher can act on.

CREATE OR REPLACE FUNCTION public.dash_teacher_portal_adoption()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid; v_classes uuid[]; v_roster uuid[];
  v_tz text; v_today date; v_total int;
  v_never int; v_never_names text[];
  v_today_n int; v_yday_n int; v_7 int; v_30 int;
  v_spark jsonb; v_hw_pct numeric; v_ex_pct numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  IF v_classes IS NULL THEN RETURN jsonb_build_object('has_data', false); END IF;

  -- Every student in the teacher's classes (see note 1 above).
  SELECT array_agg(DISTINCT ca.user_id) INTO v_roster
    FROM class_assignments ca
   WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes);
  v_roster := COALESCE(v_roster, ARRAY[]::uuid[]);
  v_total := COALESCE(array_length(v_roster, 1), 0);
  IF v_total = 0 THEN RETURN jsonb_build_object('has_data', false); END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*) INTO v_never
    FROM auth.users u
   WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL;

  SELECT array_agg(nm) INTO v_never_names FROM (
    SELECT (SELECT pf.full_name FROM profiles pf WHERE pf.id = u.id) AS nm
      FROM auth.users u
     WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL
     ORDER BY 1 LIMIT 3) s;

  -- DISTINCT people, not student-days averaged over the window.
  SELECT count(DISTINCT d.student_id) INTO v_today_n FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster) AND d.activity_date = v_today;
  SELECT count(DISTINCT d.student_id) INTO v_yday_n FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster) AND d.activity_date = v_today - 1;
  SELECT count(DISTINCT d.student_id) INTO v_7 FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster)
     AND d.activity_date > v_today - 7 AND d.activity_date <= v_today;
  SELECT count(DISTINCT d.student_id) INTO v_30 FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster)
     AND d.activity_date > v_today - 30 AND d.activity_date <= v_today;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', g.day, 'n', COALESCE(c.n, 0)) ORDER BY g.day), '[]'::jsonb)
    INTO v_spark
    FROM generate_series(v_today - 13, v_today, INTERVAL '1 day') AS g(day)
    LEFT JOIN (
      SELECT d.activity_date, count(DISTINCT d.student_id) AS n
        FROM student_activity_daily d
       WHERE d.student_id = ANY(v_roster) AND d.activity_date > v_today - 14
       GROUP BY d.activity_date) c ON c.activity_date = g.day::date;

  SELECT round(count(*) FILTER (WHERE s.id IS NOT NULL) * 100.0 / NULLIF(count(*), 0), 0)
    INTO v_hw_pct
    FROM homework_assignments h
    JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
                                        AND hac.class_id = ANY(v_classes)
    CROSS JOIN LATERAL unnest(v_roster) AS t(student_id)
    LEFT JOIN homework_submissions s ON s.homework_assignment_id = h.id AND s.student_id = t.student_id
   WHERE h.created_by = v_uid;

  SELECT round(count(*) FILTER (WHERE a.id IS NOT NULL) * 100.0 / NULLIF(count(*), 0), 0)
    INTO v_ex_pct
    FROM exams e
    JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ANY(v_classes)
    CROSS JOIN LATERAL unnest(v_roster) AS t(student_id)
    LEFT JOIN student_exam_attempts a ON a.exam_id = e.id AND a.student_id = t.student_id
   WHERE e.created_by = v_uid AND e.status IN ('published','active','completed');

  RETURN jsonb_build_object(
    'has_data', true,
    'total_students', v_total,
    'never_logged_in', jsonb_build_object('count', COALESCE(v_never,0),
                                          'names', COALESCE(to_jsonb(v_never_names), '[]'::jsonb)),
    'today',     jsonb_build_object('n', v_today_n, 'pct', round(v_today_n * 100.0 / v_total, 0)),
    'yesterday', jsonb_build_object('n', v_yday_n,  'pct', round(v_yday_n  * 100.0 / v_total, 0)),
    'avg_7',     jsonb_build_object('n', v_7,  'pct', round(v_7  * 100.0 / v_total, 0)),
    'avg_30',    jsonb_build_object('n', v_30, 'pct', round(v_30 * 100.0 / v_total, 0)),
    'sparkline', v_spark,
    'engagement', jsonb_build_object('homework_pct', v_hw_pct, 'tests_pct', v_ex_pct));
END $function$;

-- Same population change for the laggards list, so the 8 pupils who have not
-- opened SALCI since February-May actually appear.
CREATE OR REPLACE FUNCTION public.dash_teacher_portal_laggards(p_limit integer DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_classes uuid[]; v_rows jsonb; v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 15), 1), 50);
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'students', '[]'::jsonb);
  END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH roster AS (
    -- One representative class per student. NOT min(class_id): Postgres has no
    -- min() aggregate for uuid, which is what broke this function in review.
    SELECT ca.user_id AS student_id,
           (array_agg(ca.class_id ORDER BY ca.class_id))[1] AS class_id
      FROM class_assignments ca
     WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes)
     GROUP BY ca.user_id
  ),
  seen AS (
    SELECT r.student_id,
           GREATEST(
             (SELECT max(d.activity_date) FROM student_activity_daily d
               WHERE d.student_id = r.student_id),
             (SELECT (u.last_sign_in_at)::date FROM auth.users u WHERE u.id = r.student_id)
           ) AS last_seen,
           (SELECT u.last_sign_in_at IS NULL FROM auth.users u WHERE u.id = r.student_id)
             AS never_signed_in
      FROM roster r
  ),
  hw_recent AS (
    SELECT h.id, hac.class_id,
           row_number() OVER (PARTITION BY hac.class_id
                              ORDER BY h.due_at DESC NULLS LAST, h.created_at DESC) AS rn
      FROM homework_assignments h
      JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
     WHERE h.created_by = v_uid AND hac.class_id = ANY(v_classes)
  ),
  hw AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE s.id IS NOT NULL) AS submitted, count(*) AS expected
      FROM roster r
      JOIN hw_recent hr ON hr.class_id = r.class_id AND hr.rn <= 5
      LEFT JOIN homework_submissions s
             ON s.homework_assignment_id = hr.id AND s.student_id = r.student_id
     GROUP BY r.student_id
  ),
  ex_recent AS (
    SELECT e.id, ec.class_id,
           row_number() OVER (PARTITION BY ec.class_id
                              ORDER BY COALESCE(e.scheduled_date, e.created_at::date) DESC) AS rn
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.created_by = v_uid AND ec.class_id = ANY(v_classes)
       AND e.status IN ('published','active','completed')
  ),
  ex AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE a.id IS NOT NULL) AS attempted, count(*) AS expected
      FROM roster r
      JOIN ex_recent er ON er.class_id = r.class_id AND er.rn <= 3
      LEFT JOIN student_exam_attempts a
             ON a.exam_id = er.id AND a.student_id = r.student_id
     GROUP BY r.student_id
  ),
  scored AS (
    SELECT r.student_id, r.class_id, s.last_seen, s.never_signed_in,
           CASE WHEN s.last_seen IS NULL THEN NULL ELSE v_today - s.last_seen END AS days_since,
           COALESCE(hw.submitted,0) AS hw_submitted, COALESCE(hw.expected,0) AS hw_expected,
           COALESCE(ex.attempted,0) AS ex_attempted, COALESCE(ex.expected,0) AS ex_expected,
           COALESCE(CASE WHEN hw.expected > 0 THEN hw.submitted::numeric / hw.expected END, 1)
         + COALESCE(CASE WHEN ex.expected > 0 THEN ex.attempted::numeric / ex.expected END, 1)
             AS work_score
      FROM roster r
      LEFT JOIN seen s ON s.student_id = r.student_id
      LEFT JOIN hw ON hw.student_id = r.student_id
      LEFT JOIN ex ON ex.student_id = r.student_id
  ),
  ranked AS (
    SELECT sc.*, COALESCE(sc.days_since, 9999) AS stale,
           CASE
             WHEN COALESCE(sc.days_since, 9999) >= 7 AND sc.work_score < 0.8 THEN 'high'
             WHEN COALESCE(sc.days_since, 9999) >= 5 AND sc.work_score < 1.4 THEN 'medium'
             ELSE 'watch'
           END AS severity
      FROM scored sc
     WHERE COALESCE(sc.days_since, 9999) >= 3
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY sev_rank, stale DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'student_id',   rk.student_id,
             'student_name', (SELECT pf.full_name FROM profiles pf WHERE pf.id = rk.student_id),
             'class_id',     rk.class_id,
             'class_name',   c.name,
             'section',      c.section,
             'days_since',   rk.days_since,
             'never_seen',   COALESCE(rk.never_signed_in, false),
             'hw_submitted', rk.hw_submitted,
             'hw_expected',  rk.hw_expected,
             'ex_attempted', rk.ex_attempted,
             'ex_expected',  rk.ex_expected,
             'severity',     rk.severity,
             'note',         CASE WHEN rk.severity = 'watch' AND rk.work_score >= 1.6
                                  THEN 'Logs in rarely, work is otherwise fine' END
           ) AS x,
           CASE rk.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END AS sev_rank,
           rk.stale
      FROM ranked rk
      JOIN classes c ON c.id = rk.class_id
     ORDER BY CASE rk.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, rk.stale DESC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'students', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_portal_adoption()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dash_teacher_portal_laggards(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_portal_adoption()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teacher_portal_laggards(integer) TO authenticated;
