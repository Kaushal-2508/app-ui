-- dash5_chronic_absentees: identical output, about 6.5x faster. Applied to prod 2026-09-23.
--
-- CAUSE (EXPLAIN ANALYZE of the body, Alliance admin, card defaults 250/75/0/50: 1,927 ms)
--   1. 1,535 ms (80%) was CTE yr = public.dash5_student_rows(v_inst): the whole per-student
--      scorecard (homework, exams, attendance, sign-ins) for all 1,545 students, built only
--      to read two columns (attendance_pct, score) for the <= p_limit (50) rows returned.
--   2. 73 ms and growing: each hit student's class came from
--      LATERAL (SELECT ... FROM rec JOIN cls ... LIMIT 1), a CTE scan of rec per student
--      (187 loops x 3,650 rows filtered). Cost grows with hits x days in the window.
--
-- FIX
--   1. year_pct / score are computed here for the <= v_lim rows only, with the same
--      definitions and academic-year window as dash5_student_rows (att / sc CTEs), through
--      indexes on attendance_records(student_id, date), student_exam_attempts(student_id),
--      final_results(attempt_id). NULL for a student outside that function's roster
--      (institution_student_ids + an active class), exactly as the old LEFT JOIN gave.
--      KEEP IN SYNC: if dash5_student_rows changes how attendance_pct or score are computed,
--      change the two subqueries in 'rows' below too. This function no longer calls it.
--   2. The first rec row per student is found in one pass (row_number() OVER () over rec,
--      DISTINCT ON), then the first cls row for that class: the same pick the LIMIT 1 made,
--      including for a class mapped to more than one wing.
--   d, cls, rec, agg, ranked, streak and hit are UNCHANGED on purpose: by_wing[].worst
--   breaks pct ties by hit's row order, and keeping those CTEs verbatim keeps that order.
--
-- MEASURED on prod 2026-09-23, old vs new in one REPEATABLE READ snapshot:
--   Alliance admin (250/75/0/50)       1,760 ms -> 271-291 ms (7 consecutive calls)
--   Alliance Middle wing coordinator   1,880 ms -> 254-264 ms
--   Alliance Senior coordinator        1,735 ms -> 255-268 ms (7 consecutive calls)
--   Alliance admin 30-day window       1,559 ms -> 155-200 ms
--   Alliance admin streak 3            1,657 ms -> 266-273 ms
--   Salci National admin default         174 ms ->  69 ms
-- EQUIVALENCE: md5 of the full jsonb identical in 32 scenarios: Alliance admin, both
--   coordinators, streak 3, 30 days; Salci National admin, both coordinators, streak 3,
--   30 days, 7 days, threshold 100 / limit 300, NULL args, wing and class filters (incl. a
--   class mapped to 3 wings), and the three refusals (other wing, other wing's class, other
--   school's class, same error text); Vidyabodhini admin and both coordinators.
-- NOTE: the OLD function is itself unstable. From the 6th call in a session PL/pgSQL may
--   switch to a generic plan, and the order of TIED names inside by_wing[].worst changes
--   (reproduced on Salci National: calls 1-5 one md5, calls 6-7 another; rows untouched).
--   The new function returns the old function's calls 1-5 output on every call.
--
-- Grants are unchanged by CREATE OR REPLACE (EXECUTE: authenticated, service_role; none to
-- anon or PUBLIC). The REVOKE / GRANT below only restate that state.
-- Verify after applying:
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public' AND routine_name = 'dash5_chronic_absentees';

BEGIN;

CREATE OR REPLACE FUNCTION public.dash5_chronic_absentees(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 100, p_threshold numeric DEFAULT 75, p_streak integer DEFAULT 0, p_limit integer DEFAULT 60, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb;
  v_n int := LEAST(GREATEST(COALESCE(p_days, 100), 1), 250);
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 300);
  v_thr numeric := LEAST(GREATEST(COALESCE(p_threshold, 75), 0), 100);
  v_streak int := GREATEST(COALESCE(p_streak, 0), 0);
  v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  -- The academic-year window, resolved exactly as dash5_student_rows resolves it, for
  -- the two year figures each visible row carries (year_pct, score).
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  WITH d AS (
    SELECT DISTINCT ar.date FROM attendance_records ar
     WHERE ar.institution_id = v_inst
     ORDER BY ar.date DESC LIMIT v_n
  ),
  cls AS (
    SELECT c.id, c.name || COALESCE(' ' || NULLIF(c.section,''), '') label, m.wing_id
      FROM classes c
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
  ),
  rec AS (
    SELECT ar.student_id, ar.class_id, ar.date,
           (ar.status IN ('present','late')) present
      FROM attendance_records ar
      JOIN d ON d.date = ar.date
      JOIN cls ON cls.id = ar.class_id
     WHERE ar.institution_id = v_inst
  ),
  agg AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE r.present)::numeric p,
           count(*)::numeric n
      FROM rec r GROUP BY 1
  ),
  ranked AS (
    SELECT r.student_id, r.present,
           row_number() OVER (PARTITION BY r.student_id ORDER BY r.date DESC) rn
      FROM rec r
  ),
  -- Consecutive school days absent counting back from their most recent record:
  -- everything before the first present day they hit walking backwards.
  streak AS (
    SELECT z.student_id, count(*)::int run FROM (
      SELECT k.student_id, k.present,
             sum(CASE WHEN k.present THEN 1 ELSE 0 END)
               OVER (PARTITION BY k.student_id ORDER BY k.rn
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) seen_present
        FROM ranked k) z
     WHERE NOT z.present AND z.seen_present = 0
     GROUP BY 1
  ),
  -- d, cls, rec, agg, ranked, streak and hit are deliberately written exactly as before:
  -- by_wing[].worst breaks pct ties by hit's row order, and that order comes from this plan.
  hit AS (
    SELECT a.student_id,
           round(a.p*100.0/NULLIF(a.n,0), 1) pct,
           a.n::int days_counted,
           COALESCE(s.run, 0) run
      FROM agg a LEFT JOIN streak s ON s.student_id = a.student_id
     WHERE a.n > 0 AND a.p*100.0/a.n < v_thr
  ),
  -- Each student's class = the class on their FIRST row of rec, in rec's own row order,
  -- then the FIRST cls row for that class (a class mapped to two wings has two rows).
  -- That is exactly what the old per-student "LATERAL (SELECT ... FROM rec JOIN cls ...
  -- LIMIT 1)" returned, found in one pass instead of rescanning rec once per student.
  -- MATERIALIZED so that no plan can rerun the window over rec inside a nested loop.
  hfirst AS MATERIALIZED (
    SELECT DISTINCT ON (rp.student_id) rp.student_id, rp.class_id
      FROM (SELECT r.student_id, r.class_id, row_number() OVER () o FROM rec r) rp
     WHERE rp.student_id IN (SELECT h1.student_id FROM hit h1)
     ORDER BY rp.student_id, rp.o
  ),
  cfirst AS MATERIALIZED (
    SELECT DISTINCT ON (cp.id) cp.id, cp.label, cp.wing_id
      FROM (SELECT c.id, c.label, c.wing_id, row_number() OVER () o FROM cls c) cp
     ORDER BY cp.id, cp.o
  ),
  -- named keeps hit's row order, as the old query produced it: the tie-breaking of the
  -- pct sorts below (the per-wing "worst" three) reads it.
  hord AS MATERIALIZED (
    SELECT h0.*, row_number() OVER () h_ord FROM hit h0
  ),
  named AS MATERIALIZED (
    SELECT h.student_id, h.pct, h.days_counted, h.run,
           COALESCE(pf.full_name, pf.email) nm, pf.roll_number,
           cl.id class_id, cl.label class_label, cl.wing_id
      FROM hord h
      JOIN profiles pf ON pf.id = h.student_id
      JOIN hfirst f ON f.student_id = h.student_id
      JOIN cfirst cl ON cl.id = f.class_id
     WHERE h.run >= v_streak
       AND (p_wing_id IS NULL OR cl.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR cl.id = p_class_id)
     ORDER BY h.h_ord
  ),
  ct AS (
    SELECT ca.class_id, string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ') nm
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.subject_id IS NULL AND ca.role::text = 'teacher'
       AND pf.is_active IS NOT FALSE
       AND ca.class_id IN (SELECT DISTINCT n2.class_id FROM named n2)
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'window_days', (SELECT count(*)::int FROM d),
    'threshold', v_thr, 'streak', v_streak,
    'total', (SELECT count(*)::int FROM named),
    -- Unfiltered by wing or class on purpose, so the headline stays comparable
    -- while the reader narrows the list underneath it.
    'total_school', (SELECT count(*)::int FROM hit WHERE run >= v_streak),
    -- Where the absentees are, and who can chase them. Both the collapsed
    -- summary bar and the hand-over rows read this, so the chip a reader counts
    -- and the row they press are the same number.
    'by_wing', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'wing_id', w.id, 'wing_name', w.name,
               'n', (SELECT count(*)::int FROM named n2 WHERE n2.wing_id = w.id),
               'coordinator_id', (SELECT wa.user_id FROM wing_assignments wa
                                    JOIN profiles pf2 ON pf2.id = wa.user_id
                                    JOIN user_roles ur ON ur.user_id = pf2.id
                                                      AND ur.role::text = 'coordinator'
                                   WHERE wa.wing_id = w.id AND pf2.is_active IS NOT FALSE
                                   ORDER BY pf2.full_name LIMIT 1),
               'coordinator', (SELECT COALESCE(pf2.full_name, pf2.email) FROM wing_assignments wa
                                 JOIN profiles pf2 ON pf2.id = wa.user_id
                                 JOIN user_roles ur ON ur.user_id = pf2.id
                                                   AND ur.role::text = 'coordinator'
                                WHERE wa.wing_id = w.id AND pf2.is_active IS NOT FALSE
                                ORDER BY pf2.full_name LIMIT 1),
               'worst', COALESCE((SELECT jsonb_agg(z.nm ORDER BY z.pct)
                                    FROM (SELECT n3.nm, n3.pct FROM named n3
                                           WHERE n3.wing_id = w.id
                                           ORDER BY n3.pct LIMIT 3) z), '[]'::jsonb))
             ORDER BY (SELECT count(*) FROM named n2 WHERE n2.wing_id = w.id) DESC, w.name)
        FROM wings w
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb),
    'unmapped', (SELECT count(*)::int FROM named WHERE named.wing_id IS NULL),
    -- The year figures each row carries beside its window figure. Without them a
    -- reader narrowing to "last 7 days" cannot tell a child who is always absent
    -- from one who had a bad week. They are dash5_student_rows' attendance_pct and
    -- score (academic-year attendance, mean exam %), computed for the <= v_lim rows
    -- shown rather than for the whole school; NULL for a student outside that
    -- function's roster (institution_student_ids + an active class).
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'student_id', r.student_id, 'name', r.nm, 'roll', r.roll_number,
        'class_id', r.class_id, 'class_label', r.class_label, 'wing_id', r.wing_id,
        'class_teacher', (SELECT ct.nm FROM ct WHERE ct.class_id = r.class_id),
        'pct', r.pct, 'days_counted', r.days_counted, 'absent_streak', r.run,
        'year_pct', y.year_pct, 'score', y.score
      ) ORDER BY r.pct, r.nm)
      FROM (SELECT * FROM named ORDER BY pct, nm LIMIT v_lim) r
      LEFT JOIN LATERAL (
        SELECT
          -- = dash5_student_rows.att_pct
          (SELECT CASE WHEN count(*) > 0
                       THEN round((count(*) FILTER (WHERE ar.status IN ('present','late')))::numeric
                                  * 100.0 / count(*)::numeric, 1) END
             FROM attendance_records ar
            WHERE ar.student_id = r.student_id
              AND ar.institution_id = v_inst
              AND ar.date BETWEEN v_ay_start AND v_ay_end) year_pct,
          -- = dash5_student_rows.score
          (SELECT round(avg(fr.percentage), 1)
             FROM student_exam_attempts a
             JOIN final_results fr ON fr.attempt_id = a.id
             JOIN exams e ON e.id = a.exam_id
            WHERE a.student_id = r.student_id
              AND e.institution_id = v_inst
              AND e.status IN ('published','completed')
              AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                  BETWEEN v_ay_start AND v_ay_end
              AND COALESCE(fr.is_absent, false) = false) score
         WHERE r.student_id IN (SELECT s.student_id FROM public.institution_student_ids(v_inst) s)
           AND EXISTS (SELECT 1 FROM class_assignments ca2
                         JOIN classes c3 ON c3.id = ca2.class_id
                        WHERE ca2.user_id = r.student_id AND ca2.role::text = 'student'
                          AND c3.institution_id = v_inst AND c3.is_active IS NOT FALSE)
      ) y ON true), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.dash5_chronic_absentees(uuid, uuid, integer, numeric, integer, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash5_chronic_absentees(uuid, uuid, integer, numeric, integer, integer, uuid) TO authenticated, service_role;

COMMIT;
