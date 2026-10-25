-- Admin Dashboard v5, phase 5: Attendance and Needs your attention.
-- Design: docs/superpowers/specs/2026-09-16-admin-dashboard-v5-design.md

/* -------------------------------------------------- attendance series ----- */

-- Students against staff on one axis, over the last N days on which the school
-- actually took a register. Calendar days would draw Sundays and holidays as a
-- collapse to zero.
CREATE OR REPLACE FUNCTION public.dash5_attendance_series(
  p_days int DEFAULT 20, p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb; v_n int := LEAST(GREATEST(COALESCE(p_days, 20), 1), 90);
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH d AS (
    SELECT DISTINCT ar.date FROM attendance_records ar
     WHERE ar.institution_id = v_inst
     ORDER BY ar.date DESC LIMIT v_n
  ),
  stu AS (
    SELECT ar.date,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::int present,
           count(*)::int total
      FROM attendance_records ar JOIN d ON d.date = ar.date
     WHERE ar.institution_id = v_inst
     GROUP BY 1
  ),
  stf AS (
    SELECT sr.date,
           count(*) FILTER (WHERE sr.status IN ('present','late'))::int present,
           count(*)::int total
      FROM staff_attendance_records sr JOIN d ON d.date = sr.date
     WHERE sr.institution_id = v_inst
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', d.date,
        'student_pct', CASE WHEN s.total > 0 THEN round(s.present*100.0/s.total, 1) END,
        'staff_pct',   CASE WHEN f.total > 0 THEN round(f.present*100.0/f.total, 1) END,
        'student_total', COALESCE(s.total, 0), 'staff_total', COALESCE(f.total, 0)
      ) ORDER BY d.date)
      FROM d LEFT JOIN stu s ON s.date = d.date LEFT JOIN stf f ON f.date = d.date), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------- attendance by wing ----- */

CREATE OR REPLACE FUNCTION public.dash5_attendance_by_wing(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  pc AS (SELECT DISTINCT a.class_id, a.wing_id, a.students, a.att_present, a.att_total FROM a)
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'wing_id', w.id, 'wing_name', w.name,
      'students', COALESCE(k.students, 0),
      'pct', CASE WHEN k.at2 > 0 THEN round(k.ap*100.0/k.at2, 1) END
    ) ORDER BY w.name), '[]'::jsonb)
  ) INTO v_out
  FROM wings w
  LEFT JOIN (SELECT pc.wing_id, sum(pc.students)::int students,
                    sum(pc.att_present)::int ap, sum(pc.att_total)::int at2
               FROM pc GROUP BY pc.wing_id) k ON k.wing_id = w.id
  WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE;

  RETURN v_out;
END
$function$;

/* -------------------------------------------------- chronic absentees ----- */

-- Every figure is RECOMPUTED from the daily register over the chosen window, so
-- "below 75%" means below 75% in that window, not the year figure filtered
-- afterwards. Those are different numbers, and conflating them would waste the
-- whole point of the filter.
CREATE OR REPLACE FUNCTION public.dash5_chronic_absentees(
  p_wing_id   uuid DEFAULT NULL,
  p_class_id  uuid DEFAULT NULL,
  p_days      int  DEFAULT 100,
  p_threshold numeric DEFAULT 75,
  p_streak    int  DEFAULT 0,
  p_limit     int  DEFAULT 60,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb;
  v_n int := LEAST(GREATEST(COALESCE(p_days, 100), 1), 250);
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 300);
  v_thr numeric := LEAST(GREATEST(COALESCE(p_threshold, 75), 0), 100);
  v_streak int := GREATEST(COALESCE(p_streak, 0), 0);
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

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
  hit AS (
    SELECT a.student_id,
           round(a.p*100.0/NULLIF(a.n,0), 1) pct,
           a.n::int days_counted,
           COALESCE(s.run, 0) run
      FROM agg a LEFT JOIN streak s ON s.student_id = a.student_id
     WHERE a.n > 0 AND a.p*100.0/a.n < v_thr
  ),
  named AS (
    SELECT h.*, COALESCE(pf.full_name, pf.email) nm, pf.roll_number,
           cl.id class_id, cl.label class_label, cl.wing_id
      FROM hit h
      JOIN profiles pf ON pf.id = h.student_id
      JOIN LATERAL (
        SELECT c2.* FROM rec r2 JOIN cls c2 ON c2.id = r2.class_id
         WHERE r2.student_id = h.student_id LIMIT 1) cl ON true
     WHERE h.run >= v_streak
       AND (p_wing_id IS NULL OR cl.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR cl.id = p_class_id)
  )
  SELECT jsonb_build_object(
    'window_days', (SELECT count(*)::int FROM d),
    'threshold', v_thr, 'streak', v_streak,
    'total', (SELECT count(*)::int FROM named),
    -- Unfiltered by wing or class on purpose, so the headline stays comparable
    -- while the reader narrows the list underneath it.
    'total_school', (SELECT count(*)::int FROM hit WHERE run >= v_streak),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'student_id', r.student_id, 'name', r.nm, 'roll', r.roll_number,
        'class_id', r.class_id, 'class_label', r.class_label, 'wing_id', r.wing_id,
        'pct', r.pct, 'days_counted', r.days_counted, 'absent_streak', r.run
      ) ORDER BY r.pct, r.nm)
      FROM (SELECT * FROM named ORDER BY pct, nm LIMIT v_lim) r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* -------------------------------------------------- needs, by wing ------- */

-- The same facts the rest of the page already holds, grouped by the person who
-- can act on them. Nothing here is a new measurement; it is the existing
-- numbers addressed to a coordinator.
CREATE OR REPLACE FUNCTION public.dash5_needs_by_wing(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb; v_pace numeric := 74;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  s AS MATERIALIZED (SELECT * FROM public.dash5_student_rows(v_inst)),
  cls AS (
    SELECT a.class_id, a.wing_id,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done, sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*) FILTER (WHERE a.papers = 0)::int no_paper,
           sum(a.pending_grading)::int pending
      FROM a GROUP BY 1,2
  ),
  per_wing AS (
    SELECT w.id wing_id, w.name wing_name,
           count(*) FILTER (WHERE c.ch > 0
             AND (c.done*2 + c.part)*100.0/(c.ch*2) < v_pace)::int behind,
           count(*) FILTER (WHERE c.den > 0 AND c.num/c.den < 70)::int weak,
           COALESCE(sum(c.no_paper), 0)::int no_paper,
           COALESCE(sum(c.pending), 0)::int pending,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id AND s.never_in) never_in,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id
              AND COALESCE(s.attendance_pct, 100) < 75) chronic,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id AND s.at_risk) at_risk
      FROM wings w
      LEFT JOIN cls c ON c.wing_id = w.id
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
     GROUP BY w.id, w.name
  ),
  items AS (
    SELECT p.wing_id, p.wing_name, i.sev, i.n,
           i.n || ' ' || i.title AS title, i.detail, i.cta
      FROM per_wing p
      CROSS JOIN LATERAL (VALUES
        ('High',   p.behind,   'classes behind the pace line',
                   'Coverage is the leading indicator: a class behind now is a class revising in the exam week.', 'academics'),
        ('High',   p.weak,     'classes averaging below 70%',
                   'Sustained across more than one cycle this is a teaching-support question, not a student-effort one.', 'overview'),
        ('High',   p.chronic,  'students below the 75% attendance floor',
                   'Board eligibility risk.', 'attendance'),
        ('Medium', p.no_paper, 'subject-class pairs with no paper this year',
                   'Nothing to grade means nothing to measure. These are invisible in every score above.', 'academics'),
        ('Medium', p.never_in, 'students have never signed in',
                   'Nothing they do is measured until they do.', 'students'),
        ('Medium', p.at_risk,  'students flagged as needing attention',
                   'Failing marks or heavy absence.', 'students'),
        ('Medium', p.pending,  'papers written but not yet published',
                   'Results cannot reach parents until these close.', 'academics')
      ) AS i(sev, n, title, detail, cta)
     WHERE i.n > 0
  ),
  wing_json AS (
    SELECT p.wing_id, p.wing_name,
           (SELECT count(*)::int FROM items i WHERE i.wing_id = p.wing_id) cnt,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'severity', i.sev, 'title', i.title, 'detail', i.detail, 'goto', i.cta)
               ORDER BY CASE i.sev WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, i.n DESC)
             FROM items i WHERE i.wing_id = p.wing_id), '[]'::jsonb) items
      FROM per_wing p
  )
  SELECT jsonb_build_object(
    'pace', v_pace,
    'total', (SELECT count(*)::int FROM items),
    'wings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'wing_id', w.wing_id, 'wing_name', w.wing_name,
        'count', w.cnt, 'items', w.items) ORDER BY w.cnt DESC, w.wing_name)
      FROM wing_json w), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_attendance_series(int,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_attendance_by_wing(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_chronic_absentees(uuid,uuid,int,numeric,int,int,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_needs_by_wing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash5_attendance_series(int,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_attendance_by_wing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_chronic_absentees(uuid,uuid,int,numeric,int,int,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_needs_by_wing(uuid) TO authenticated, service_role;
