-- Class filters for "Attendance trend" and "Are your students using SALCI?".
--
-- Neither shared RPC accepts a class, so a teacher with several classes could
-- only ever see them pooled. Both new functions take p_class_id, where NULL
-- means "all my classes" — the existing behaviour — and a supplied class is
-- validated against the caller's own pairs, so the parameter can only narrow.

-- ---------------------------------------------------------------------------
-- 1. Attendance trend. Body copied from dash_scoped_attendance_trend verbatim
--    (same present/late definition, same institution-local "today" per §24, same
--    all_time_avg over the unfiltered window) with only the class filter added.
--    Attendance is pastoral and is not recorded per subject, so this stays
--    class-level by design — there is no subject dimension to add.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_teacher_attendance_trend(
  p_days     integer DEFAULT 30,
  p_class_id uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_classes uuid[]; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(auth.uid());

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('points', '[]'::jsonb, 'all_time_avg', NULL);
  END IF;

  IF p_class_id IS NOT NULL THEN
    IF NOT (p_class_id = ANY(v_classes)) THEN
      RAISE EXCEPTION 'dashboard: class not in scope';
    END IF;
    v_classes := ARRAY[p_class_id];
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.date, 'present', d.present, 'total', d.total,
           'pct', CASE WHEN d.total > 0 THEN round(d.present * 100.0 / d.total, 1) END)
         ORDER BY d.date), '[]'::jsonb)
    INTO v_points
    FROM (
      SELECT date,
             count(*) FILTER (WHERE status IN ('present','late')) AS present,
             count(*) AS total
        FROM attendance_records
       WHERE institution_id = v_inst AND class_id = ANY(v_classes)
         AND date > v_today - p_days AND date <= v_today
       GROUP BY date) d;

  SELECT round((count(*) FILTER (WHERE status IN ('present','late'))) * 100.0 / NULLIF(count(*), 0), 1)
    INTO v_all
    FROM attendance_records
   WHERE institution_id = v_inst AND class_id = ANY(v_classes);

  RETURN jsonb_build_object('points', v_points, 'all_time_avg', v_all);
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_attendance_trend(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_attendance_trend(integer, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Portal adoption. Same body as before, plus p_class_id. The zero-argument
--    form is dropped so a one-call site cannot become ambiguous.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dash_teacher_portal_adoption();

CREATE OR REPLACE FUNCTION public.dash_teacher_portal_adoption(p_class_id uuid DEFAULT NULL)
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

  IF p_class_id IS NOT NULL THEN
    IF NOT (p_class_id = ANY(v_classes)) THEN
      RAISE EXCEPTION 'dashboard: class not in scope';
    END IF;
    v_classes := ARRAY[p_class_id];
  END IF;

  -- Every student in the (possibly filtered) classes. Deliberately NOT narrowed
  -- by teacher_roster_student_ids: "is this child using the portal" is pastoral,
  -- and an optional subject with no enrolments collapsed it to one pupil.
  SELECT array_agg(DISTINCT ca.user_id) INTO v_roster
    FROM class_assignments ca
   WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes);
  v_roster := COALESCE(v_roster, ARRAY[]::uuid[]);
  v_total := COALESCE(array_length(v_roster, 1), 0);
  IF v_total = 0 THEN RETURN jsonb_build_object('has_data', false); END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*) INTO v_never
    FROM auth.users u WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL;

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

REVOKE ALL ON FUNCTION public.dash_teacher_portal_adoption(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_portal_adoption(uuid) TO authenticated;
