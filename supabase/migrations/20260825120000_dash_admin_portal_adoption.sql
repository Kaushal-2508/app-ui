-- "Are your students using SALCI?" for the ADMIN dashboard, to the blueprint.
--
-- The card already existed, correctly, for teachers: dash_teacher_portal_adoption
-- returns the never-logged-in names, today / yesterday / 7d / 30d, a 14-day
-- sparkline and the homework + tests engagement pair, and TeacherPortalAdoption
-- renders them. The admin surface shipped something else entirely -- four count
-- chips and two percentage bars -- so the same question got two different
-- answers depending on who asked it. This is the teacher RPC widened to the
-- institution, plus the two things the blueprint's admin version has and the
-- teacher's does not: a roster badge and an adoption-by-wing split.
--
-- Logins come from student_activity_daily, a rollup of TWO sources
-- (auth.refresh_tokens for per-day granularity, auth.users.last_sign_in_at as a
-- coarse fallback that survives GoTrue's token pruning). Neither underlying
-- table is client-queryable, which is why this is SECURITY DEFINER and returns
-- counts plus at most three names -- never a student-level activity row.
--
-- DIFFERENCE FROM THE TEACHER RPC, deliberate: the blueprint labels the third
-- and fourth tiles "daily avg" and prints "1,126 of 1,543, avg/day", so they are
-- mean daily actives across the window. The teacher card labels its equivalents
-- "Active in 7 days" and counts DISTINCT people, which is a different figure and
-- correct for its own label. Each card's number matches its own caption; they
-- are not meant to agree.
--
-- The engagement pair is computed as sum(submissions) / sum(expected) across
-- assignments rather than with the teacher RPC's CROSS JOIN over the roster.
-- Institution-wide that cross join is students x assignments -- on a 1,500-pupil
-- school with a year of homework it is millions of rows to produce one integer
-- (CLAUDE.md §23: aggregate server-side, and cheaply).
BEGIN;

CREATE OR REPLACE FUNCTION public.dash_admin_portal_adoption(
  p_institution_id uuid DEFAULT NULL::uuid,
  p_class_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_roster uuid[]; v_total int;
  v_never int; v_never_names text[];
  v_today_n int; v_yday_n int;
  v_avg7 numeric; v_avg30 numeric;
  v_spark jsonb; v_wings jsonb;
  v_hw_pct numeric; v_ex_pct numeric;
  v_first_half numeric; v_second_half numeric;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  -- One roster array drives every figure below, so the denominator is provably
  -- the same in the badge, the tiles, the sparkline and the wing split.
  SELECT array_agg(DISTINCT ca.user_id) INTO v_roster
    FROM class_assignments ca
    JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst
   WHERE ca.role = 'student'
     AND (p_class_id IS NULL OR ca.class_id = p_class_id);
  v_roster := COALESCE(v_roster, ARRAY[]::uuid[]);
  v_total := COALESCE(array_length(v_roster, 1), 0);
  IF v_total = 0 THEN RETURN jsonb_build_object('has_data', false); END IF;

  SELECT count(*) INTO v_never
    FROM auth.users u WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL;

  SELECT array_agg(nm) INTO v_never_names FROM (
    SELECT COALESCE(pf.full_name, pf.email)::text AS nm
      FROM auth.users u
      JOIN profiles pf ON pf.id = u.id
     WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL
     ORDER BY 1 LIMIT 3) s;

  SELECT count(DISTINCT d.student_id) INTO v_today_n FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster) AND d.activity_date = v_today;
  SELECT count(DISTINCT d.student_id) INTO v_yday_n FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster) AND d.activity_date = v_today - 1;

  -- Mean daily actives: total student-days over the window divided by the
  -- number of days IN the window, not by the number of days that happen to have
  -- a row. Dividing by the latter would report a school active one day in
  -- thirty as if it were active every day.
  SELECT round(count(*)::numeric / 7, 0) INTO v_avg7
    FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster)
     AND d.activity_date > v_today - 7 AND d.activity_date <= v_today;
  SELECT round(count(*)::numeric / 30, 0) INTO v_avg30
    FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster)
     AND d.activity_date > v_today - 30 AND d.activity_date <= v_today;

  -- generate_series, so a day with no activity is a zero on the chart rather
  -- than a gap the line skips over.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'd', g.day::date,
           'n', COALESCE(c.n, 0),
           'pct', round(COALESCE(c.n,0) * 100.0 / v_total, 0)) ORDER BY g.day), '[]'::jsonb)
    INTO v_spark
    FROM generate_series(v_today - 13, v_today, INTERVAL '1 day') AS g(day)
    LEFT JOIN (
      SELECT d.activity_date, count(DISTINCT d.student_id) AS n
        FROM student_activity_daily d
       WHERE d.student_id = ANY(v_roster) AND d.activity_date > v_today - 14
       GROUP BY d.activity_date) c ON c.activity_date = g.day::date;

  -- Trend arrow: the last seven days against the seven before them.
  SELECT count(*)::numeric INTO v_first_half FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster)
     AND d.activity_date > v_today - 14 AND d.activity_date <= v_today - 7;
  SELECT count(*)::numeric INTO v_second_half FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster)
     AND d.activity_date > v_today - 7 AND d.activity_date <= v_today;

  -- Homework: submissions over expected submissions, summed across assignments.
  SELECT round(sum(x.subs) * 100.0 / NULLIF(sum(x.expected), 0), 0) INTO v_hw_pct
    FROM (
      SELECT (SELECT count(DISTINCT ca.user_id)
                FROM homework_assignment_classes hac
                JOIN class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
               WHERE hac.homework_assignment_id = h.id
                 AND ca.user_id = ANY(v_roster)) AS expected,
             (SELECT count(*) FROM homework_submissions s
               WHERE s.homework_assignment_id = h.id
                 AND s.student_id = ANY(v_roster)) AS subs
        FROM homework_assignments h
       WHERE h.institution_id = v_inst
         AND h.status <> 'draft'
         AND h.created_at > now() - INTERVAL '90 days') x;

  -- Tests / assignments: attempts over expected attempts, same shape.
  SELECT round(sum(x.att) * 100.0 / NULLIF(sum(x.expected), 0), 0) INTO v_ex_pct
    FROM (
      SELECT (SELECT count(DISTINCT ca.user_id)
                FROM exam_classes ec
                JOIN class_assignments ca ON ca.class_id = ec.class_id AND ca.role = 'student'
               WHERE ec.exam_id = e.id
                 AND ca.user_id = ANY(v_roster)) AS expected,
             (SELECT count(DISTINCT a.student_id) FROM student_exam_attempts a
               WHERE a.exam_id = e.id
                 AND a.student_id = ANY(v_roster)) AS att
        FROM exams e
       WHERE e.institution_id = v_inst
         AND e.status IN ('published','active','completed')
         AND COALESCE(e.published_at, e.created_at) > now() - INTERVAL '90 days') x;

  -- Adoption by wing, 7-day mean daily actives over each wing's own roster.
  -- The blueprint's admin card has this and the teacher's does not, because a
  -- wing is the unit an admin can hand the problem to.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'wing_id', t.wing_id, 'wing_name', t.wing_name,
           'students', t.students, 'pct', t.pct) ORDER BY t.pct ASC NULLS LAST), '[]'::jsonb)
    INTO v_wings
    FROM (
      SELECT w.id AS wing_id, w.name AS wing_name, r.students,
             CASE WHEN r.students > 0
                  THEN round(
                    (SELECT count(*)::numeric FROM student_activity_daily d
                      WHERE d.student_id = ANY(r.ids)
                        AND d.activity_date > v_today - 7 AND d.activity_date <= v_today)
                    / 7 * 100.0 / r.students, 0)
             END AS pct
        FROM wings w
        CROSS JOIN LATERAL (
          SELECT array_agg(DISTINCT ca.user_id) AS ids,
                 count(DISTINCT ca.user_id)::int AS students
            FROM wing_class_mappings m
            JOIN class_assignments ca ON ca.class_id = m.class_id AND ca.role = 'student'
           WHERE m.wing_id = w.id AND ca.user_id = ANY(v_roster)) r
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
         AND r.students > 0) t;

  RETURN jsonb_build_object(
    'has_data', true,
    'total_students', v_total,
    'never_logged_in', jsonb_build_object(
      'count', COALESCE(v_never, 0),
      'names', COALESCE(to_jsonb(v_never_names), '[]'::jsonb)),
    'today',     jsonb_build_object('n', v_today_n,
                                    'pct', round(v_today_n * 100.0 / v_total, 0)),
    'yesterday', jsonb_build_object('n', v_yday_n,
                                    'pct', round(v_yday_n * 100.0 / v_total, 0)),
    'avg_7',     jsonb_build_object('n', COALESCE(v_avg7, 0),
                                    'pct', round(COALESCE(v_avg7,0) * 100.0 / v_total, 0)),
    'avg_30',    jsonb_build_object('n', COALESCE(v_avg30, 0),
                                    'pct', round(COALESCE(v_avg30,0) * 100.0 / v_total, 0)),
    -- The blueprint's "▼ 7pp vs last month" is the 7-day tile measured against
    -- the 30-day one: 73% against 80%.
    'delta_pp',  round(COALESCE(v_avg7,0) * 100.0 / v_total, 0)
                 - round(COALESCE(v_avg30,0) * 100.0 / v_total, 0),
    'trend',     CASE WHEN v_second_half > v_first_half THEN 'up'
                      WHEN v_second_half < v_first_half THEN 'down'
                      ELSE 'flat' END,
    'sparkline', v_spark,
    'engagement', jsonb_build_object('homework_pct', v_hw_pct, 'tests_pct', v_ex_pct),
    'wings', v_wings);
END $function$;

REVOKE EXECUTE ON FUNCTION public.dash_admin_portal_adoption(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_admin_portal_adoption(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_admin_portal_adoption(uuid, uuid) TO authenticated;

COMMIT;
