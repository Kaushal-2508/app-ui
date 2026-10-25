-- dash5_teacher_activity + dash5_coordinators: speed-up, identical output.
-- Applied to prod 2026-09-23 via scripts/run-sql.ps1 (CLAUDE.md 26). CREATE OR
-- REPLACE keeps the owner and the grants (authenticated, service_role; no
-- anon), SECURITY DEFINER, STABLE, plpgsql and search_path are unchanged.
--
-- CAUSE (EXPLAIN ANALYZE, Alliance, admin, 2026-09-23)
--  1. dash5_teacher_activity called dash5_atom_rows(v_inst) for avg_score
--     alone: 372 of 404 ms and 105,349 of 111,095 buffer hits were that one
--     Function Scan, which builds all 21 atom columns (coverage, lessons,
--     papers, pending, homework, attendance, roster) and this function read
--     4 of them (class_id, subject_id, attempts, acc).
--  2. dash5_coordinators called dash5_teacher_activity (one full atom_rows)
--     and then dash5_atom_rows again for its own card: two per call.
--  3. Inside the scores rule the planner reads the COALESCE(published_at,
--     scheduled_date, created_at)::date BETWEEN year range as 0.5% of the
--     exams (6 estimated, 1,305 real) and walks final_results by index
--     20,645 times (61,125 buffers).
--  4. From a session's 6th call PL/pgSQL switches to a generic plan sized
--     for the average school: teacher_activity 70 -> 130 ms (paired test),
--     dash5_atom_rows 282 -> 426 ms (234,461 buffers, both pend and scores
--     walk final_results by index).
--
-- FIX
--  teacher_activity: computes only the scores rule (same cls/prs/scores
--   rules as dash5_atom_rows, inlined; KEEP IN STEP), with the year test as
--   an aggregate FILTER plus an estimable published_at superset in WHERE;
--   compares class_assignments.role as the app_role enum (same rows, real
--   statistics, so the acc join hashes instead of a 636 x 315 nested loop);
--   SET plan_cache_mode = force_custom_plan.
--  coordinators: body unchanged; SET plan_cache_mode = force_custom_plan,
--   which also reaches its dash5_atom_rows() call.
--
-- MEASURED (prod, school hours, ms; old = live public fn, new = pg_temp
-- candidate, same transaction)
--  Alliance admin   teacher_activity(NULL)     335 -> 74
--  Alliance admin   teacher_activity(Middle)   286 -> 75
--  Alliance coord   teacher_activity(NULL)     358 -> 90   (Middle wing)
--  Alliance coord   teacher_activity(own wing) 339 -> 85   (Senior wing)
--  Alliance admin   coordinators               783 -> 431
--  Alliance admin   teacher_activity, old under generic plans 690; new
--                   stays 67-79 over 9 calls (without the SET: 128-133 from
--                   the 6th call)
--  Salci National   teacher_activity           105-153 -> 27-48
--  Vidyabodhini     teacher_activity(NULL)     124 -> 17
--  EXPLAIN, Alliance teacher_activity: 403.9 ms / 111,095 buffers ->
--                   99.8 ms / 3,761 buffers.
--  Small schools pay ~15-25 ms of planning per call for the SET: Salci
--  National without it settles at ~18 ms, with it ~45 ms (old ~110 ms).
-- EQUIVALENCE: md5 of the full jsonb identical in 32 of 32 scenarios
--  (Alliance 7: admin NULL and Middle wing, Middle coordinator NULL, Senior
--  coordinator own wing and refused Middle wing, coordinators as admin and
--  refused to a coordinator; Salci National 17: admin NULL, NULL
--  institution, all 6 wings, foreign wing, both coordinators NULL / own /
--  other wing / NULL institution, other school, coordinators as admin and
--  refused; Vidyabodhini 8: admin NULL and all 3 wings, both coordinators,
--  refused wing, coordinators). Error paths compared by message text. The
--  final form (with the SET clauses) was re-run on all 25 Salci National and
--  Vidyabodhini scenarios, and on Alliance admin and Middle coordinator over
--  20 calls: same md5 as the old function every time.
--
-- Apply teacher_activity first: coordinators calls it.

BEGIN;

CREATE OR REPLACE FUNCTION public.dash5_teacher_activity(p_wing_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
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

  -- Only avg_score needs the atoms, and only their class, subject, attempts
  -- and accuracy. Calling dash5_atom_rows() here built all 21 columns
  -- (coverage, lessons, papers, pending, homework, attendance, roster) for
  -- every atom of the school and threw 17 of them away: 92% of this
  -- function's time. cls, prs and scores below are the same rules as the
  -- CTEs of those names in dash5_atom_rows: KEEP THEM IN STEP.
  -- plan_cache_mode force_custom_plan (in the header): from a session's 6th
  -- call PL/pgSQL would reuse a generic plan that sizes every school as the
  -- average one (62 papers, not Alliance's 1,305) and walks final_results by
  -- index 20,645 times: ~130 ms instead of ~70 ms on Alliance. The price is
  -- planning on every call (~15-25 ms), which the first five calls pay anyway.
  WITH cls AS (
    SELECT c.id, c.class_group_id, m.wing_id
      FROM classes c
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
  ),
  prs AS (
    SELECT DISTINCT scm.class_id, scm.subject_id, cl.class_group_id, cl.wing_id
      FROM subject_class_mappings scm
      JOIN cls cl ON cl.id = scm.class_id
     WHERE scm.institution_id = v_inst
  ),
  -- Present sittings on this school's held papers in the academic year.
  -- The exact year test is an aggregate FILTER, not a WHERE, on purpose: as
  -- a WHERE the planner reads the COALESCE(...) date range as ~0.5% of the
  -- exams (6 estimated, 1,305 real on Alliance) and walks attempts and
  -- final_results by index 20,000 times. The published_at test in the WHERE
  -- is only a loose superset of that FILTER's lower bound (a paper published
  -- before the year can never pass it), there so past years are not read
  -- once the school rolls over; it is estimable, so it does not bring the
  -- misestimate back. A (class, subject) with no sitting inside the year
  -- gets acc NULL here instead of no row, and the acc FILTER below drops acc
  -- NULL either way, so no sum changes.
  scores AS (
    SELECT a.class_id, es.subject_id,
           count(*) FILTER (WHERE COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                                  BETWEEN v_ay_start AND v_ay_end)::int attempts,
           avg(fr.percentage) FILTER (WHERE COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                                  BETWEEN v_ay_start AND v_ay_end) acc
      FROM exams e
      JOIN exam_subjects es ON es.exam_id = e.id
      JOIN student_exam_attempts a ON a.exam_id = e.id
      JOIN final_results fr ON fr.attempt_id = a.id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','completed')
       AND (e.published_at IS NULL OR e.published_at >= v_ay_start - 1)
       AND COALESCE(fr.is_absent, false) = false
     GROUP BY 1,2
  ),
  -- An atom with no scores row has acc NULL, which the FILTER below drops,
  -- so the inner join to scores changes no sum.
  atoms AS MATERIALIZED (
    SELECT p.class_id, p.subject_id, sc.attempts, sc.acc
      FROM prs p
      JOIN universal_subjects us0 ON us0.id = p.subject_id
      JOIN scores sc ON sc.class_id = p.class_id AND sc.subject_id = p.subject_id
  ),
  staff AS (
    SELECT DISTINCT pf.id, COALESCE(pf.full_name, pf.email) nm
      FROM profiles pf
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'teacher'
     WHERE pf.institution_id = v_inst AND pf.is_active IS NOT FALSE
  ),
  -- The pairs a teacher actually holds. A row with no subject is the pastoral
  -- class-teacher assignment and grants no subject, so it is counted as a class
  -- but never as a subject (CLAUDE.md 25).
  -- role is compared as the app_role enum, not role::text: same rows, but
  -- the cast hid the column statistics (16 estimated, 915 real) and the
  -- 1-row guess turned the acc join below into a 636 x 315 nested loop.
  pairs AS (
    SELECT ca.user_id, ca.class_id, ca.subject_id, m.wing_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE ca.role = 'teacher'::app_role
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

CREATE OR REPLACE FUNCTION public.dash5_coordinators(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_out jsonb; v_act jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  -- plan_cache_mode force_custom_plan (in the header) reaches the
  -- dash5_atom_rows() call below: from a session's 6th call its generic
  -- plan sizes every school as the average one and walks final_results by
  -- index twice (pend and scores, 20,645 probes each on Alliance): 426 ms
  -- against 282 ms for the custom plan. Same rows either way.

  -- Read the quiet-teacher count from dash5_teacher_activity rather than
  -- recomputing the "Minimal" rule here. Two copies of that rule would drift,
  -- and the two cards sit on the same screen.
  v_act := public.dash5_teacher_activity(NULL, p_institution_id);

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
    SELECT wa.wing_id, wa.user_id uid, COALESCE(pf.full_name, pf.email) nm
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
  quiet AS (
    SELECT (r->>'wing_id')::uuid wing_id, count(*)::int n
      FROM jsonb_array_elements(v_act->'rows') r
     WHERE r->>'level' = 'Minimal' AND r->>'wing_id' IS NOT NULL
     GROUP BY 1
  ),
  tsk AS (
    SELECT t.wing_id,
           count(*)::int total,
           count(*) FILTER (WHERE t.status::text = 'completed')::int closed,
           count(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date::date < v_today
                              AND t.status::text NOT IN ('completed','rejected'))::int overdue
      FROM tasks t
     WHERE t.institution_id = v_inst AND t.wing_id IS NOT NULL
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'wing_id', w.id, 'wing_name', w.name,
      'coordinator', (SELECT string_agg(c.nm, ', ') FROM coord c WHERE c.wing_id = w.id),
      'coordinator_id', (SELECT c.uid FROM coord c WHERE c.wing_id = w.id ORDER BY c.nm LIMIT 1),
      'classes', COALESCE(k.classes, 0),
      'students', COALESCE(k.students, 0),
      'teachers', COALESCE(sw.n, 0),
      'teachers_minimal', COALESCE(qt.n, 0),
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
  LEFT JOIN quiet qt ON qt.wing_id = w.id
  LEFT JOIN tsk  t ON t.wing_id = w.id
  WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE;

  RETURN v_out;
END
$function$;

COMMIT;

-- Verify after applying (expect both rows, proconfig with plan_cache_mode):
-- SELECT p.oid::regprocedure, p.provolatile, p.prosecdef, p.proconfig, p.proacl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('dash5_teacher_activity','dash5_coordinators');
