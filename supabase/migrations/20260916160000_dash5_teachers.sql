-- Admin Dashboard v5, phase 4a: Teachers and staff.
-- Design: docs/superpowers/specs/2026-09-16-admin-dashboard-v5-design.md
--
-- Two tables from the reference: teachers ranked by ENGAGEMENT with the
-- platform, quietest first, and one row per coordinator against the wing they
-- run.
--
-- Engagement deliberately excludes student scores. Mixing outcome into a usage
-- index makes a teacher with strong classes look engaged while never opening
-- SALCI, which is the exact blindness the table exists to remove. The average
-- score is still shown, in its own column, so the two are never conflated.

CREATE OR REPLACE FUNCTION public.dash5_teacher_activity(
  p_wing_id uuid DEFAULT NULL, p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  WITH atoms AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  staff AS (
    SELECT DISTINCT pf.id, COALESCE(pf.full_name, pf.email) nm
      FROM profiles pf
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'teacher'
     WHERE pf.institution_id = v_inst AND pf.is_active IS NOT FALSE
  ),
  -- The pairs a teacher actually holds. A row with no subject is the pastoral
  -- class-teacher assignment and grants no subject, so it is counted as a class
  -- but never as a subject (CLAUDE.md 25).
  pairs AS (
    SELECT ca.user_id, ca.class_id, ca.subject_id, m.wing_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE ca.role::text = 'teacher'
  ),
  scope AS (
    SELECT p.user_id,
           count(DISTINCT p.class_id)::int classes,
           count(DISTINCT p.subject_id) FILTER (WHERE p.subject_id IS NOT NULL)::int subjects,
           (array_agg(p.wing_id ORDER BY p.wing_id) FILTER (WHERE p.wing_id IS NOT NULL))[1] wing_id,
           string_agg(DISTINCT us.name, ', ') subject_names
      FROM pairs p
      LEFT JOIN universal_subjects us ON us.id = p.subject_id
     GROUP BY p.user_id
  ),
  -- Attempts-weighted accuracy across only the pairs this teacher holds.
  acc AS (
    SELECT p.user_id,
           sum(a.acc * a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)         FILTER (WHERE a.acc IS NOT NULL) den
      FROM pairs p
      JOIN atoms a ON a.class_id = p.class_id AND a.subject_id = p.subject_id
     GROUP BY p.user_id
  ),
  made AS (
    SELECT e.created_by uid, count(*)::int tests
      FROM exams e
     WHERE e.institution_id = v_inst
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  ),
  hw AS (
    SELECT h.created_by uid, count(*)::int n
      FROM homework_assignments h
     WHERE h.institution_id = v_inst
     GROUP BY 1
  ),
  les AS (
    SELECT lp.owner_teacher_id uid, count(*) FILTER (WHERE lp.status = 'done')::int n
      FROM tt_lesson_plans lp
     WHERE lp.institution_id = v_inst AND lp.session_type = 'teaching'
     GROUP BY 1
  ),
  seen AS (
    SELECT u.id uid,
           CASE WHEN u.last_sign_in_at IS NULL THEN NULL
                ELSE GREATEST(0, (v_today - (u.last_sign_in_at AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date))
           END days
      FROM auth.users u
  ),
  j AS (
    SELECT s.id, s.nm, sc.wing_id, COALESCE(sc.classes,0) classes,
           COALESCE(sc.subjects,0) subjects, sc.subject_names,
           COALESCE(m.tests,0) tests, COALESCE(h.n,0) hw_given, COALESCE(l.n,0) lessons,
           CASE WHEN a.den > 0 THEN round(a.num/a.den, 1) END avg_score,
           se.days last_seen_days
      FROM staff s
      LEFT JOIN scope sc ON sc.user_id = s.id
      LEFT JOIN acc   a  ON a.user_id = s.id
      LEFT JOIN made  m  ON m.uid = s.id
      LEFT JOIN hw    h  ON h.uid = s.id
      LEFT JOIN les   l  ON l.uid = s.id
      LEFT JOIN seen  se ON se.uid = s.id
     WHERE p_wing_id IS NULL OR sc.wing_id = p_wing_id
  ),
  mx AS (
    SELECT GREATEST(max(tests), 1) mt, GREATEST(max(hw_given), 1) mh FROM j
  ),
  scored AS (
    SELECT j.*,
           -- Platform behaviour only, normalised within this school so the
           -- ranking means "quiet compared with your colleagues", not compared
           -- with a number invented elsewhere.
           round(( 0.38 * j.tests::numeric / mx.mt
                 + 0.34 * j.hw_given::numeric / mx.mh
                 + 0.28 * (1 - LEAST(COALESCE(j.last_seen_days, 12), 12)::numeric / 12)
                 ) * 100, 1) engagement,
           CASE
             WHEN j.last_seen_days IS NULL OR j.last_seen_days >= 7 OR j.tests < 2 THEN 'Minimal'
             WHEN j.last_seen_days <= 3 AND j.tests >= 3 AND j.hw_given >= 45 THEN 'Strong'
             ELSE 'Moderate'
           END level
      FROM j, mx
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM scored),
    'minimal', (SELECT count(*)::int FROM scored WHERE level = 'Minimal'),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.nm,
        'wing_id', r.wing_id,
        'wing_name', (SELECT w.name FROM wings w WHERE w.id = r.wing_id),
        'classes', r.classes, 'subjects', r.subjects, 'subject_names', r.subject_names,
        'last_seen_days', r.last_seen_days,
        'tests', r.tests, 'homework_given', r.hw_given, 'lessons', r.lessons,
        'avg_score', r.avg_score, 'engagement', r.engagement, 'level', r.level
      ) ORDER BY CASE r.level WHEN 'Minimal' THEN 0 WHEN 'Moderate' THEN 1 ELSE 2 END,
                 r.engagement, r.nm) FROM scored r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------------- coordinators ----- */

CREATE OR REPLACE FUNCTION public.dash5_coordinators(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH atoms AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  pc AS (SELECT DISTINCT a.class_id, a.wing_id, a.students, a.att_present, a.att_total FROM atoms a),
  wagg AS (
    SELECT a.wing_id,
           sum(a.chapters)::int chapters, sum(a.chapters_done)::int done,
           sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den
      FROM atoms a GROUP BY a.wing_id
  ),
  wc AS (
    SELECT pc.wing_id, count(*)::int classes, sum(pc.students)::int students,
           sum(pc.att_present)::int ap, sum(pc.att_total)::int at2
      FROM pc GROUP BY pc.wing_id
  ),
  coord AS (
    SELECT wa.wing_id, wa.user_id, COALESCE(pf.full_name, pf.email) nm
      FROM wing_assignments wa
      JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
  ),
  staff_in_wing AS (
    SELECT m.wing_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
      JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE ca.role::text = 'teacher'
     GROUP BY 1
  ),
  tsk AS (
    SELECT t.wing_id,
           count(*)::int total,
           count(*) FILTER (WHERE t.status::text IN ('done','completed'))::int closed,
           count(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date::date < v_today
                              AND t.status::text NOT IN ('done','completed','cancelled'))::int overdue
      FROM tasks t
     WHERE t.institution_id = v_inst AND t.wing_id IS NOT NULL
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'wing_id', w.id, 'wing_name', w.name,
      'coordinator', (SELECT string_agg(c.nm, ', ') FROM coord c WHERE c.wing_id = w.id),
      'classes', COALESCE(k.classes, 0),
      'students', COALESCE(k.students, 0),
      'teachers', COALESCE(sw.n, 0),
      'avg_score', CASE WHEN g.den > 0 THEN round(g.num/g.den, 1) END,
      'coverage_pct', CASE WHEN g.chapters > 0
         THEN round((g.done*2 + g.part)*100.0/(g.chapters*2), 1) END,
      'attendance_pct', CASE WHEN k.at2 > 0 THEN round(k.ap*100.0/k.at2, 1) END,
      'tasks_closed', COALESCE(t.closed, 0), 'tasks_total', COALESCE(t.total, 0),
      'tasks_overdue', COALESCE(t.overdue, 0),
      'band', public.dash5_band(public.dash5_composite(
         CASE WHEN g.den > 0 THEN g.num/g.den END,
         CASE WHEN g.chapters > 0 THEN (g.done*2+g.part)*100.0/(g.chapters*2) END,
         CASE WHEN k.at2 > 0 THEN k.ap*100.0/k.at2 END,
         NULL))
    ) ORDER BY w.name), '[]'::jsonb)
  ) INTO v_out
  FROM wings w
  LEFT JOIN wagg g ON g.wing_id = w.id
  LEFT JOIN wc   k ON k.wing_id = w.id
  LEFT JOIN staff_in_wing sw ON sw.wing_id = w.id
  LEFT JOIN tsk  t ON t.wing_id = w.id
  WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_teacher_activity(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_coordinators(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash5_teacher_activity(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_coordinators(uuid) TO authenticated, service_role;
