-- Admin dashboard accuracy pass: the Attendance section and the "Needs your
-- attention" wing queue. Audit: docs/admin-dashboard-audit-2026-10-05.md
-- (R1, R11 and the smaller defects on pending papers, empty wings, copy).
-- Owner decisions 2026-10-05 apply (published marks only, nothing removed).
--
-- What changed and why:
--  * NEW dash5_attendance_school_days: ONE definition of a school day, used by
--    the trend, the chronic-absentee window and the needs queue. A day counts
--    when at least half the classes that have students took a register OR at
--    least half the teachers checked in (R11). Before, any date with a single
--    register row was a "school day" (a Sunday with one class marked plotted
--    1.6%), and a weekday with teachers in but no register vanished.
--  * dash5_attendance_series: the day set above (today included once it
--    qualifies, flagged is_today so the card can say "so far"); student_pct is
--    now present out of those REGISTERED, not out of the whole roll (R11). New
--    keys: register_pct, classes_marked, classes_total, is_today, basis. Every
--    old key is kept with its old meaning except student_pct's value.
--  * dash5_attendance_by_wing: same academic-year figure as before (still equal
--    to the tree's Attendance column), now computed straight from the register
--    and wing mappings so a class without a subject mapping is not dropped.
--    New keys: from, to, classes, marks, present. Values unchanged.
--  * dash5_chronic_absentees: no wing fan-out (R1: a class in two wings
--    doubled days counted and streaks), wing membership by EXISTS (a student
--    counts in every wing their class belongs to), the window is the last N
--    real school days of the academic year (every mark inside that date span
--    counts, so a class registered on a thin day keeps its marks), a student
--    needs at least
--    min_days marks (half the window, at most 5) to be listed, the absence run
--    stops at a leave mark, class = class of the latest mark. New keys:
--    min_days, today, rows[].last_mark_date, rows[].last_status,
--    rows[].wing_ids. The row score reads dash5_counted_results (published
--    marks only).
--  * dash5_needs_by_wing: pace from dash5_year_pace; per-wing student counts by
--    class membership (R1: dash5_student_rows keeps one arbitrary wing per
--    student); pending = DISTINCT papers with any unpublished result (it
--    summed class-subject pairs: 110 for 103 papers at Alliance); the
--    attendance item uses the same rule as the chronic-absentee card so "Open
--    absentees" lands on the same number; wings ordered by severity; detail
--    copy no longer claims "failing marks" for under 60% or "board
--    eligibility" for Pre Nursery. Wings with nothing open stay listed.

-- 1. The school-day rule (internal helper) ----------------------------------
CREATE OR REPLACE FUNCTION public.dash5_attendance_school_days(
  p_inst uuid, p_wing uuid DEFAULT NULL, p_from date DEFAULT NULL)
RETURNS TABLE(day date, classes_marked integer, classes_total integer,
              teachers_in integer, teachers_total integer, is_today boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz text; v_today date; v_from date;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_from := COALESCE(p_from, v_today - 400);

  RETURN QUERY
  WITH cls AS MATERIALIZED (
    -- Classes that have at least one student on the roster. A class with
    -- nobody in it has no register to take and must not raise the bar.
    SELECT DISTINCT c.id
      FROM classes c
      JOIN class_assignments ca ON ca.class_id = c.id AND ca.role::text = 'student'
      JOIN public.institution_student_ids(p_inst) s ON s.student_id = ca.user_id
     WHERE c.institution_id = p_inst AND c.is_active IS NOT FALSE
       AND (p_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings m
                                       WHERE m.class_id = c.id AND m.wing_id = p_wing))
  ),
  tch AS MATERIALIZED (
    -- The teacher roll dash5_attendance_series has always used.
    SELECT DISTINCT p.id,
           COALESCE((p.created_at AT TIME ZONE v_tz)::date, DATE '1900-01-01') AS joined
      FROM profiles p
      JOIN user_roles ur ON ur.user_id = p.id
     WHERE p.institution_id = p_inst
       AND p.is_active IS NOT FALSE
       AND ur.role::text = 'teacher'
       AND (p_wing IS NULL OR EXISTS (SELECT 1 FROM class_assignments ca
             JOIN wing_class_mappings wm ON wm.class_id = ca.class_id AND wm.wing_id = p_wing
            WHERE ca.user_id = p.id AND ca.role::text = 'teacher'))
  ),
  reg AS (
    SELECT ar.date AS dt, count(DISTINCT ar.class_id)::int AS n
      FROM attendance_records ar
     WHERE ar.institution_id = p_inst
       AND ar.date BETWEEN v_from AND v_today
       AND ar.class_id IN (SELECT cls.id FROM cls)
     GROUP BY 1
  ),
  chk AS (
    SELECT sr.date AS dt, count(DISTINCT sr.staff_id)::int AS n
      FROM staff_attendance_records sr
     WHERE sr.institution_id = p_inst
       AND sr.date BETWEEN v_from AND v_today
       AND sr.status IN ('present', 'late')
       AND sr.staff_id IN (SELECT tch.id FROM tch)
     GROUP BY 1
  ),
  k AS (SELECT count(*)::int AS n FROM cls),
  cand AS (
    SELECT x.dt,
           COALESCE(r.n, 0) AS cm,
           k.n AS ct,
           COALESCE(h.n, 0) AS ti,
           (SELECT count(*)::int FROM tch t WHERE t.joined <= x.dt) AS tt
      FROM (SELECT reg.dt FROM reg UNION SELECT chk.dt FROM chk) x
      CROSS JOIN k
      LEFT JOIN reg r ON r.dt = x.dt
      LEFT JOIN chk h ON h.dt = x.dt
  )
  SELECT c.dt, c.cm, c.ct, c.ti, c.tt, c.dt = v_today
    FROM cand c
   WHERE (c.ct > 0 AND c.cm * 2 >= c.ct)
      OR (c.tt > 0 AND c.ti * 2 >= c.tt);
END
$function$;

REVOKE ALL ON FUNCTION public.dash5_attendance_school_days(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash5_attendance_school_days(uuid, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.dash5_attendance_school_days(uuid, uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dash5_attendance_school_days(uuid, uuid, date) TO service_role;

-- 2. Attendance trend ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_attendance_series(p_days integer DEFAULT 20, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_out jsonb; v_wing uuid;
  v_n int := LEAST(GREATEST(COALESCE(p_days, 20), 1), 90);
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  v_wing := public.dash5_caller_wing(v_inst);
  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM institutions WHERE id = v_inst;

  WITH d AS MATERIALIZED (
    -- Real school days only (dash5_attendance_school_days). Today is in the
    -- list as soon as it qualifies, flagged so the card can say "so far".
    SELECT sd.day AS date, sd.classes_marked, sd.classes_total, sd.is_today
      FROM public.dash5_attendance_school_days(v_inst, v_wing, NULL) sd
     ORDER BY sd.day DESC
     LIMIT v_n
  ),
  -- ----------------------------------------------------------------- rolls --
  stu_roll AS MATERIALIZED (
    SELECT s.student_id AS id,
           COALESCE((p.created_at AT TIME ZONE v_tz)::date, DATE '1900-01-01') AS joined
      FROM public.institution_student_ids(v_inst) s
      JOIN profiles p ON p.id = s.student_id
     WHERE v_wing IS NULL OR EXISTS (SELECT 1 FROM class_assignments ca
             JOIN wing_class_mappings wm ON wm.class_id = ca.class_id
                                        AND wm.wing_id = v_wing
            WHERE ca.user_id = s.student_id AND ca.role::text = 'student')
  ),
  tch_roll AS MATERIALIZED (
    -- DISTINCT because a teacher who also holds another role has two
    -- user_roles rows and must still count once.
    SELECT DISTINCT p.id,
           COALESCE((p.created_at AT TIME ZONE v_tz)::date, DATE '1900-01-01') AS joined
      FROM profiles p
      JOIN user_roles ur ON ur.user_id = p.id
     WHERE p.institution_id = v_inst
       AND p.is_active IS NOT FALSE
       AND ur.role::text = 'teacher'
       AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM class_assignments ca
             JOIN wing_class_mappings wm ON wm.class_id = ca.class_id
                                        AND wm.wing_id = v_wing
            WHERE ca.user_id = p.id AND ca.role::text = 'teacher'))
  ),
  -- ------------------------------------------------------------- numerators --
  stu AS (
    SELECT d.date,
           count(ar.id) FILTER (WHERE ar.status IN ('present','late'))::int present,
           count(ar.id)::int marked
      FROM d
      LEFT JOIN attendance_records ar
             ON ar.date = d.date
            AND ar.institution_id = v_inst
            AND EXISTS (SELECT 1 FROM stu_roll r WHERE r.id = ar.student_id)
     GROUP BY d.date
  ),
  ins AS (
    SELECT d.date,
           count(sr.id) FILTER (WHERE sr.status IN ('present','late'))::int present,
           count(sr.id)::int marked
      FROM d
      LEFT JOIN staff_attendance_records sr
             ON sr.date = d.date
            AND sr.institution_id = v_inst
            AND EXISTS (SELECT 1 FROM tch_roll r WHERE r.id = sr.staff_id)
     GROUP BY d.date
  ),
  -- ----------------------------------------------------------- denominators --
  roll AS (
    SELECT d.date,
           (SELECT count(*) FROM stu_roll r WHERE r.joined <= d.date)::int students,
           (SELECT count(*) FROM tch_roll r WHERE r.joined <= d.date)::int teachers
      FROM d
  )
  SELECT jsonb_build_object(
    -- student_pct is present out of those registered. The roll is still
    -- returned as student_total, and register_pct says how much of it was
    -- registered, so a low-coverage day is told apart from a low-attendance one.
    'basis', 'registered',
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', d.date,
        'student_pct',   CASE WHEN s.marked > 0 THEN round(s.present*100.0/s.marked, 1) END,
        'staff_pct',     CASE WHEN k.teachers > 0 THEN round(i.present*100.0/k.teachers, 1) END,
        'student_total',   COALESCE(k.students, 0),
        'student_present', COALESCE(s.present, 0),
        'student_marked',  COALESCE(s.marked, 0),
        'staff_total',     COALESCE(k.teachers, 0),
        'staff_present',   COALESCE(i.present, 0),
        'staff_marked',    COALESCE(i.marked, 0),
        'register_pct',    CASE WHEN k.students > 0 THEN round(COALESCE(s.marked, 0)*100.0/k.students, 1) END,
        'classes_marked',  d.classes_marked,
        'classes_total',   d.classes_total,
        'is_today',        d.is_today
      ) ORDER BY d.date)
      FROM d
      LEFT JOIN stu  s ON s.date = d.date
      LEFT JOIN ins  i ON i.date = d.date
      LEFT JOIN roll k ON k.date = d.date), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- 3. Attendance by wing -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_attendance_by_wing(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb; v_tz text; v_today date; v_s date; v_e date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_s, v_e FROM public.dash_current_academic_year(v_inst);
  v_s := COALESCE(v_s, v_today - INTERVAL '12 months')::date;
  v_e := COALESCE(v_e, v_today)::date;

  -- The academic year so far: present or late out of every register mark the
  -- wing's active classes received. A day a class was not registered adds
  -- nothing to either side. Same figure as the tree's Attendance column.
  WITH wc AS MATERIALIZED (
    SELECT m.wing_id, m.class_id
      FROM wing_class_mappings m
      JOIN wings w ON w.id = m.wing_id AND w.institution_id = v_inst AND w.is_active IS NOT FALSE
      JOIN classes c ON c.id = m.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
  ),
  att AS (
    SELECT ar.class_id,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::int present,
           count(*)::int total
      FROM attendance_records ar
     WHERE ar.institution_id = v_inst
       AND ar.date BETWEEN v_s AND v_e
       AND ar.class_id IN (SELECT wc.class_id FROM wc)
     GROUP BY 1
  ),
  stu AS (
    SELECT DISTINCT wc.wing_id, ca.user_id
      FROM wc
      JOIN class_assignments ca ON ca.class_id = wc.class_id AND ca.role::text = 'student'
     WHERE ca.user_id IN (SELECT s.student_id FROM public.institution_student_ids(v_inst) s)
  ),
  k AS (
    SELECT wc.wing_id,
           count(DISTINCT wc.class_id)::int classes,
           COALESCE(sum(a.present), 0)::int ap,
           COALESCE(sum(a.total), 0)::int at2
      FROM wc LEFT JOIN att a ON a.class_id = wc.class_id
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'from', v_s,
    'to', LEAST(v_e, v_today),
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'wing_id', w.id, 'wing_name', w.name,
      'students', (SELECT count(*)::int FROM stu WHERE stu.wing_id = w.id),
      'classes', COALESCE(k.classes, 0),
      'marks', COALESCE(k.at2, 0),
      'present', COALESCE(k.ap, 0),
      'pct', CASE WHEN k.at2 > 0 THEN round(k.ap*100.0/k.at2, 1) END
    ) ORDER BY w.name), '[]'::jsonb)
  ) INTO v_out
  FROM wings w
  LEFT JOIN k ON k.wing_id = w.id
  WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE;

  RETURN v_out;
END
$function$;

-- 4. Chronic absentees --------------------------------------------------------
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

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  WITH d AS MATERIALIZED (
    -- The window: the last N real school days of this academic year. It is
    -- measured in school days, and every mark inside its date span counts, so
    -- a class that took its register on a day when most of the school did not
    -- (common before staff check-in was in use) keeps its marks.
    SELECT sd.day AS date
      FROM public.dash5_attendance_school_days(v_inst, NULL, v_ay_start) sd
     ORDER BY sd.day DESC
     LIMIT v_n
  ),
  -- A student needs at least half the window in marks (at most 5) to be judged:
  -- one absence out of one mark is not chronic absence.
  wd AS (
    -- While the year has fewer school days than the window, the window is the
    -- whole year so far, so marks before the first full school day still count.
    SELECT count(*)::int n,
           CASE WHEN count(*) = 0 THEN NULL
                WHEN count(*) < v_n THEN v_ay_start
                ELSE min(d.date) END d0,
           GREATEST(1, LEAST(5, ceil(count(*) / 2.0)::int)) min_days
      FROM d
  ),
  cls AS MATERIALIZED (
    SELECT c.id, c.name || COALESCE(' ' || NULLIF(c.section,''), '') label
      FROM classes c
     WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
  ),
  -- Every wing a class belongs to. Kept apart from cls so a class in two wings
  -- never duplicates a register row (it doubled days counted and streaks).
  cw AS MATERIALIZED (
    SELECT m.class_id, m.wing_id, w.name wing_name, w.display_order
      FROM wing_class_mappings m
      JOIN wings w ON w.id = m.wing_id AND w.institution_id = v_inst AND w.is_active IS NOT FALSE
  ),
  rec AS MATERIALIZED (
    SELECT ar.student_id, ar.class_id, ar.date, ar.status
      FROM attendance_records ar
      CROSS JOIN wd
     WHERE ar.institution_id = v_inst
       AND ar.date BETWEEN wd.d0 AND v_today
       AND ar.class_id IN (SELECT cls.id FROM cls)
  ),
  agg AS (
    SELECT r.student_id,
           count(DISTINCT r.date) FILTER (WHERE r.status IN ('present','late'))::numeric p,
           count(DISTINCT r.date)::numeric n,
           max(r.date) last_mark_date,
           max(r.date) FILTER (WHERE r.status <> 'absent') last_not_absent
      FROM rec r GROUP BY 1
  ),
  -- Absences in a row, counting back from the latest mark. A present, late or
  -- leave mark ends the run: approved leave is not an absence streak.
  streak AS (
    SELECT a.student_id, count(DISTINCT r.date)::int run
      FROM agg a
      JOIN rec r ON r.student_id = a.student_id
     WHERE r.date > COALESCE(a.last_not_absent, DATE '1900-01-01')
     GROUP BY 1
  ),
  -- The class (and status) of the latest mark.
  lastrow AS MATERIALIZED (
    SELECT DISTINCT ON (r.student_id) r.student_id, r.class_id, r.status
      FROM rec r
     ORDER BY r.student_id, r.date DESC, (r.status IN ('present','late')) DESC, r.class_id
  ),
  hit AS MATERIALIZED (
    SELECT a.student_id,
           round(a.p*100.0/NULLIF(a.n,0), 1) pct,
           a.n::int days_counted,
           COALESCE(s.run, 0) run,
           a.last_mark_date,
           l.status last_status,
           l.class_id
      FROM agg a
      CROSS JOIN wd
      JOIN lastrow l ON l.student_id = a.student_id
      LEFT JOIN streak s ON s.student_id = a.student_id
     WHERE a.n > 0 AND a.n >= wd.min_days AND a.p*100.0/a.n < v_thr
  ),
  named AS MATERIALIZED (
    SELECT h.student_id, h.pct, h.days_counted, h.run, h.last_mark_date, h.last_status,
           COALESCE(pf.full_name, pf.email) nm, pf.roll_number,
           cl.id class_id, cl.label class_label,
           (SELECT x.wing_id FROM cw x WHERE x.class_id = cl.id
             ORDER BY x.display_order NULLS LAST, x.wing_name, x.wing_id LIMIT 1) wing_id,
           COALESCE((SELECT jsonb_agg(x.wing_id ORDER BY x.display_order NULLS LAST, x.wing_name, x.wing_id)
                       FROM cw x WHERE x.class_id = cl.id), '[]'::jsonb) wing_ids
      FROM hit h
      JOIN profiles pf ON pf.id = h.student_id
      JOIN cls cl ON cl.id = h.class_id
     WHERE h.run >= v_streak
       AND (p_wing_id IS NULL OR EXISTS (SELECT 1 FROM cw x
                                          WHERE x.class_id = cl.id AND x.wing_id = p_wing_id))
       AND (p_class_id IS NULL OR cl.id = p_class_id)
  ),
  shown AS MATERIALIZED (
    SELECT * FROM named ORDER BY pct, nm, student_id LIMIT v_lim
  ),
  ct AS (
    SELECT ca.class_id, string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ') nm
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.subject_id IS NULL AND ca.role::text = 'teacher'
       AND pf.is_active IS NOT FALSE
       AND ca.class_id IN (SELECT DISTINCT s2.class_id FROM shown s2)
     GROUP BY 1
  ),
  -- Year figures for the rows shown: attendance over the academic year, and the
  -- mean of PUBLISHED marks (dash5_counted_results: blank papers and absences
  -- left out, one row per result). NULL for a student off the roster.
  onroll AS (
    SELECT s.student_id FROM public.institution_student_ids(v_inst) s
     WHERE s.student_id IN (SELECT shown.student_id FROM shown)
       AND EXISTS (SELECT 1 FROM class_assignments ca2
                     JOIN classes c3 ON c3.id = ca2.class_id
                    WHERE ca2.user_id = s.student_id AND ca2.role::text = 'student'
                      AND c3.institution_id = v_inst AND c3.is_active IS NOT FALSE)
  ),
  yatt AS (
    SELECT ar.student_id,
           round((count(*) FILTER (WHERE ar.status IN ('present','late')))::numeric
                 * 100.0 / count(*)::numeric, 1) year_pct
      FROM attendance_records ar
     WHERE ar.institution_id = v_inst
       AND ar.date BETWEEN v_ay_start AND v_ay_end
       AND ar.student_id IN (SELECT onroll.student_id FROM onroll)
     GROUP BY 1
  ),
  ysc AS (
    SELECT q.student_id, round(avg(q.percentage), 1) score
      FROM (SELECT DISTINCT ON (cr.result_id) cr.result_id, cr.student_id, cr.percentage
              FROM public.dash5_counted_results(v_inst) cr
             WHERE cr.student_id IN (SELECT onroll.student_id FROM onroll)
               AND cr.exam_date BETWEEN v_ay_start AND v_ay_end) q
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'window_days', (SELECT n FROM wd),
    'min_days', (SELECT min_days FROM wd),
    'today', v_today,
    'threshold', v_thr, 'streak', v_streak,
    'total', (SELECT count(*)::int FROM named),
    -- Unfiltered by wing or class on purpose, so the headline stays comparable
    -- while the reader narrows the list underneath it.
    'total_school', (SELECT count(*)::int FROM hit WHERE run >= v_streak),
    -- A student counts in every wing their class belongs to, so the wing
    -- figures can add up to more than the total when classes are shared.
    'by_wing', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'wing_id', w.id, 'wing_name', w.name,
               'n', z.n,
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
               'worst', COALESCE((SELECT jsonb_agg(y.nm ORDER BY y.pct, y.nm)
                                    FROM (SELECT n3.nm, n3.pct FROM named n3
                                           WHERE EXISTS (SELECT 1 FROM cw x
                                                          WHERE x.class_id = n3.class_id AND x.wing_id = w.id)
                                           ORDER BY n3.pct, n3.nm LIMIT 3) y), '[]'::jsonb))
             ORDER BY z.n DESC, w.name)
        FROM wings w
        CROSS JOIN LATERAL (
          SELECT count(*)::int n FROM named n2
           WHERE EXISTS (SELECT 1 FROM cw x WHERE x.class_id = n2.class_id AND x.wing_id = w.id)) z
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb),
    'unmapped', (SELECT count(*)::int FROM named WHERE jsonb_array_length(named.wing_ids) = 0),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'student_id', r.student_id, 'name', r.nm, 'roll', r.roll_number,
        'class_id', r.class_id, 'class_label', r.class_label,
        'wing_id', r.wing_id, 'wing_ids', r.wing_ids,
        'class_teacher', (SELECT ct.nm FROM ct WHERE ct.class_id = r.class_id),
        'pct', r.pct, 'days_counted', r.days_counted, 'absent_streak', r.run,
        'last_mark_date', r.last_mark_date, 'last_status', r.last_status,
        'year_pct', ya.year_pct, 'score', ys.score
      ) ORDER BY r.pct, r.nm, r.student_id)
      FROM shown r
      LEFT JOIN yatt ya ON ya.student_id = r.student_id
      LEFT JOIN ysc  ys ON ys.student_id = r.student_id), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- 5. Needs by wing --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_needs_by_wing(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb; v_pace numeric; v_wing uuid;
  v_tz text; v_today date; v_ay_start date;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  v_wing := public.dash5_caller_wing(v_inst);

  -- Pace is the share of the year gone (the one shared definition).
  v_pace := public.dash5_year_pace(v_inst);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date INTO v_ay_start FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;

  WITH a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  s AS MATERIALIZED (
    SELECT x.student_id, x.never_in, x.at_risk FROM public.dash5_student_rows(v_inst) x
  ),
  -- Wing membership straight from the mappings: a class in two wings belongs
  -- to both, and so do its students.
  wcls AS MATERIALIZED (
    SELECT m.wing_id, c.id class_id,
           COALESCE(gl.grade_number >= 9,
                    c.name ~* '^\s*(class|grade)\s*(9|1[0-2])\M', false) board
      FROM wing_class_mappings m
      JOIN wings w ON w.id = m.wing_id AND w.institution_id = v_inst AND w.is_active IS NOT FALSE
      JOIN classes c ON c.id = m.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
      LEFT JOIN class_groups cg ON cg.id = c.class_group_id
      LEFT JOIN grade_levels gl ON gl.id = cg.grade_level_id
  ),
  wstu AS MATERIALIZED (
    SELECT wc.wing_id, s.student_id, bool_or(s.never_in) never_in, bool_or(s.at_risk) at_risk,
           bool_or(wc.board) board
      FROM s
      JOIN class_assignments ca ON ca.user_id = s.student_id AND ca.role::text = 'student'
      JOIN wcls wc ON wc.class_id = ca.class_id
     GROUP BY 1, 2
  ),
  -- Below 75% on the same rule as the chronic-absentee card (its default
  -- "whole year" view): real school days this year, at least min_days marks.
  att_d AS MATERIALIZED (
    SELECT sd.day FROM public.dash5_attendance_school_days(v_inst, NULL, v_ay_start) sd
     ORDER BY sd.day DESC LIMIT 250
  ),
  att_min AS (
    SELECT CASE WHEN count(*) = 0 THEN NULL
                WHEN count(*) < 250 THEN v_ay_start
                ELSE min(att_d.day) END d0,
           GREATEST(1, LEAST(5, ceil(count(*) / 2.0)::int)) m
      FROM att_d
  ),
  low_att AS MATERIALIZED (
    SELECT ar.student_id
      FROM attendance_records ar
      CROSS JOIN att_min
      JOIN classes c ON c.id = ar.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
     WHERE ar.institution_id = v_inst
       AND ar.date BETWEEN att_min.d0 AND v_today
     GROUP BY 1
    HAVING count(DISTINCT ar.date) >= (SELECT m FROM att_min)
       AND (count(DISTINCT ar.date) FILTER (WHERE ar.status IN ('present','late')))::numeric * 100.0
           / count(DISTINCT ar.date) < 75
  ),
  cls AS (
    SELECT a.class_id, a.wing_id,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done, sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*) FILTER (WHERE a.papers = 0)::int no_paper
      FROM a GROUP BY 1,2
  ),
  -- Papers with any result not yet published, counted once per paper (it
  -- summed class-subject pairs: Alliance 110 for 103 papers). The same unit as
  -- the school-wide queue.
  pend_pairs AS (
    SELECT DISTINCT e.id exam_id, sa.class_id
      FROM final_results fr
      JOIN student_exam_attempts sa ON sa.id = fr.attempt_id
      JOIN exams e ON e.id = sa.exam_id
     WHERE e.institution_id = v_inst AND fr.is_published IS NOT TRUE
  ),
  per_wing AS (
    SELECT w.id wing_id, w.name wing_name,
           (SELECT count(*) FILTER (WHERE c.ch > 0
                    AND (c.done*2 + c.part)*100.0/(c.ch*2) < v_pace)::int
              FROM cls c WHERE c.wing_id = w.id) behind,
           (SELECT count(*) FILTER (WHERE c.den > 0 AND c.num/c.den < 70)::int
              FROM cls c WHERE c.wing_id = w.id) weak,
           (SELECT COALESCE(sum(c.no_paper), 0)::int FROM cls c WHERE c.wing_id = w.id) no_paper,
           (SELECT count(DISTINCT pp.exam_id)::int FROM pend_pairs pp
              JOIN wcls wc ON wc.class_id = pp.class_id AND wc.wing_id = w.id) pending,
           (SELECT count(DISTINCT wc.class_id)::int FROM wcls wc WHERE wc.wing_id = w.id) classes,
           (SELECT count(*)::int FROM wstu ws WHERE ws.wing_id = w.id) students,
           (SELECT count(*)::int FROM wstu ws WHERE ws.wing_id = w.id AND ws.never_in) never_in,
           (SELECT count(*)::int FROM wstu ws WHERE ws.wing_id = w.id
               AND ws.student_id IN (SELECT low_att.student_id FROM low_att)) chronic,
           (SELECT count(*)::int FROM wstu ws WHERE ws.wing_id = w.id AND ws.board
               AND ws.student_id IN (SELECT low_att.student_id FROM low_att)) chronic_board,
           (SELECT count(*)::int FROM wstu ws WHERE ws.wing_id = w.id AND ws.at_risk) at_risk,
           (SELECT wa.user_id FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = w.id ORDER BY pf.full_name LIMIT 1) coord_id,
           (SELECT COALESCE(pf.full_name, pf.email) FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = w.id ORDER BY pf.full_name LIMIT 1) coord_name
      FROM wings w
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
  ),
  items AS (
    -- `cta` is the words on the link, `goto` is where it lands.
    SELECT p.wing_id, p.wing_name, i.sev, i.n,
           i.n || ' ' || CASE WHEN i.n = 1 THEN i.one ELSE i.many END AS title,
           i.detail, i.cta, i.goto
      FROM per_wing p
      CROSS JOIN LATERAL (VALUES
        ('High',   p.behind,   'class behind the pace line', 'classes behind the pace line',
                   'Syllabus coverage is under ' || v_pace || '%, the share of the year gone.',
                   'Open syllabus', 'academics'),
        ('High',   p.weak,     'class averaging below 70%', 'classes averaging below 70%',
                   'The class average across this year''s published papers is under 70%.',
                   'Open performance', 'overview'),
        ('High',   p.chronic,  'student below the 75% attendance floor',
                   'students below the 75% attendance floor',
                   CASE WHEN p.chronic_board > 0
                        THEN p.chronic_board || ' of them '
                             || CASE WHEN p.chronic_board = 1 THEN 'is' ELSE 'are' END
                             || ' in Classes 9 to 12, where 75% decides board exam eligibility.'
                        ELSE 'Attendance on school days this year is under 75%.' END,
                   'Open absentees', 'attendance'),
        ('Medium', p.no_paper, 'class subject with no published paper this year',
                   'class subjects with no published paper this year',
                   'Nothing published means nothing measured. These are missing from every average above.',
                   'Open exams', 'academics'),
        ('Medium', p.never_in, 'student has never signed in', 'students have never signed in',
                   'They have never opened their SALCI account.',
                   'Open adoption', 'students'),
        ('Medium', p.at_risk,  'student flagged as needing attention',
                   'students flagged as needing attention',
                   'Average under 60%, attendance under 72%, or homework not handed in.',
                   'Open the list', 'students'),
        ('Medium', p.pending,  'paper with marks not yet published',
                   'papers with marks not yet published',
                   'Students cannot see these results until they are published.',
                   'Open exams', 'academics')
      ) AS i(sev, n, one, many, detail, cta, goto)
     WHERE i.n > 0
  ),
  wing_json AS (
    SELECT p.*,
           (SELECT count(*)::int FROM items i WHERE i.wing_id = p.wing_id) cnt,
           (SELECT count(*)::int FROM items i WHERE i.wing_id = p.wing_id AND i.sev = 'High') hi,
           (SELECT COALESCE(sum(i.n), 0)::int FROM items i WHERE i.wing_id = p.wing_id AND i.sev = 'High') hi_units,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'severity', i.sev, 'title', i.title, 'detail', i.detail,
               'cta', i.cta, 'goto', i.goto)
               ORDER BY CASE i.sev WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, i.n DESC)
             FROM items i WHERE i.wing_id = p.wing_id), '[]'::jsonb) items
      FROM per_wing p
  )
  SELECT jsonb_build_object(
    'pace', v_pace,
    'total', (SELECT count(*)::int FROM items),
    -- Most serious first: more High issue types, then more students and
    -- classes caught by them, then more issue types in all.
    'wings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'wing_id', w.wing_id, 'wing_name', w.wing_name,
        'coordinator_id', w.coord_id, 'coordinator', w.coord_name,
        'classes', w.classes, 'students', w.students,
        'high', w.hi,
        'count', w.cnt, 'items', w.items)
        ORDER BY w.hi DESC, w.hi_units DESC, w.cnt DESC, w.wing_name)
      FROM wing_json w), '[]'::jsonb)
  ) INTO v_out;

  IF v_wing IS NOT NULL THEN
    v_out := jsonb_set(v_out, '{wings}', COALESCE((
      SELECT jsonb_agg(e) FROM jsonb_array_elements(v_out->'wings') e
       WHERE (e->>'wing_id')::uuid = v_wing), '[]'::jsonb));
    v_out := jsonb_set(v_out, '{total}', to_jsonb(COALESCE((
      SELECT sum((e->>'count')::int)::int
        FROM jsonb_array_elements(v_out->'wings') e), 0)));
  END IF;

  RETURN v_out;
END
$function$;
