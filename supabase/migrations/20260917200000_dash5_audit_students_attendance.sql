-- Admin Dashboard v5, audit round: the student and attendance data the build
-- was missing.
--
-- A four-way read-through of public/report_reference/salci-admin-dashboard-v5.html
-- against the shipped page found 87 differences. These are the ones that needed
-- data rather than markup:
--
--   1. the adoption table's THIRD level, subjects inside a class
--   2. the band donut's THIRD level, classes inside a wing inside a band
--   3. the at-risk queue's roll number, class teacher and risk index
--   4. the absentee bar's per-wing split, its per-wing hand-over rows, and the
--      year figures each row is supposed to carry alongside the window figure
--
-- Plain ASCII throughout: prod SQL goes through scripts/run-sql.ps1 and
-- PowerShell 5.1 mangles non-ASCII in a request body.

/* ------------------------------------- 1. adoption, third level ----------- */

-- One row per subject taught in a class, measured from the STUDENT side: who
-- sat the papers, how they did, what they handed in. The teaching-side view of
-- the same pair lives in dash5_tree; this one answers "are the students in this
-- subject engaging", which is what the adoption table is about.
CREATE OR REPLACE FUNCTION public.dash5_student_subjects(
  p_class_id uuid,
  p_institution_id uuid DEFAULT NULL
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
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  WITH a AS MATERIALIZED (
    SELECT x.* FROM public.dash5_atom_rows(v_inst) x WHERE x.class_id = p_class_id
  ),
  -- Distinct heads who actually sat at least one paper in the subject. Not the
  -- same as attempts: one student sitting three papers is one student.
  sat AS (
    SELECT es.subject_id, count(DISTINCT at.student_id)::int n
      FROM student_exam_attempts at
      JOIN exams e ON e.id = at.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = v_inst AND at.class_id = p_class_id
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'class_id', p_class_id,
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'total', (SELECT count(*)::int FROM a),
    'students', (SELECT COALESCE(max(a.students), 0)::int FROM a),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.subject_id,
               'name', us.name,
               'teacher', (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
                             FROM class_assignments ca
                             JOIN profiles pf ON pf.id = ca.user_id
                            WHERE ca.class_id = p_class_id AND ca.subject_id = a.subject_id
                              AND ca.role::text = 'teacher'),
               'students', a.students,
               'students_sat', COALESCE((SELECT s.n FROM sat s WHERE s.subject_id = a.subject_id), 0),
               'papers', a.papers,
               -- Papers sat against papers set to the whole class.
               'submission_pct', CASE WHEN a.papers > 0 AND a.students > 0
                                      THEN round(a.attempts * 100.0 / (a.papers * a.students), 1) END,
               'score_pct', round(a.acc, 1),
               'homework_pct', CASE WHEN a.hw_slots > 0
                                    THEN round(a.hw_submitted * 100.0 / a.hw_slots, 1) END,
               'attempts', a.attempts)
             ORDER BY us.name)
        FROM a JOIN universal_subjects us ON us.id = a.subject_id), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* --------------------------------- 2. band donut, third level ------------- */

-- The classes behind one band inside one wing. The donut's second level is a
-- wing split; this is what a wing segment opens into.
CREATE OR REPLACE FUNCTION public.dash5_band_classes(
  p_band text,
  p_wing_id uuid,
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
  IF p_band NOT IN ('att','watch','good','exc') THEN
    RAISE EXCEPTION 'dash5: unknown band';
  END IF;

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR x.wing_id = p_wing_id)
  )
  SELECT jsonb_build_object(
    'band', p_band,
    'wing_id', p_wing_id,
    'wing_name', (SELECT w.name FROM wings w WHERE w.id = p_wing_id),
    'in_band', (SELECT count(*)::int FROM s WHERE s.band = p_band),
    'total', (SELECT count(*)::int FROM s),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'class_id', z.class_id, 'class_label', z.class_label,
               'n', z.n, 'of', z.of,
               'pct', CASE WHEN z.of > 0 THEN round(z.n * 100.0 / z.of, 1) END)
             ORDER BY z.n DESC, z.class_label)
        FROM (
          SELECT s.class_id, s.class_label,
                 count(*) FILTER (WHERE s.band = p_band)::int n,
                 count(*)::int of
            FROM s
           WHERE s.class_id IS NOT NULL
           GROUP BY 1, 2
          HAVING count(*) FILTER (WHERE s.band = p_band) > 0
        ) z), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------- 3. at risk: who, and how badly ----------- */

CREATE OR REPLACE FUNCTION public.dash5_students_at_risk(
  p_wing_id uuid DEFAULT NULL, p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 50, p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb; v_lim int := LEAST(GREATEST(COALESCE(p_limit,50),1), 200);
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH s AS MATERIALIZED (
    SELECT * FROM public.dash5_student_rows(v_inst) x
     WHERE x.at_risk
       AND (p_wing_id IS NULL OR x.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR x.class_id = p_class_id)
  ),
  ranked AS (
    -- Worst first. One number so the queue has a defensible order: marks weigh
    -- most, then attendance, then work handed in. It is RETURNED now, not just
    -- sorted on, because a queue that will not show its own ordering key asks
    -- the reader to take the order on trust.
    SELECT s.*, round(COALESCE(s.score,60)*0.5 + COALESCE(s.attendance_pct,100)*0.3
                 + COALESCE(s.homework_pct,0)*0.2, 1) rank_score
      FROM s
  ),
  ct AS (
    SELECT ca.class_id, string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ') nm
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.subject_id IS NULL AND ca.role::text = 'teacher'
       AND pf.is_active IS NOT FALSE
       AND ca.class_id IN (SELECT DISTINCT r.class_id FROM ranked r WHERE r.class_id IS NOT NULL)
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM ranked),
    'by_wing', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'wing_id', w.id, 'wing_name', w.name,
               'n', (SELECT count(*)::int FROM ranked r WHERE r.wing_id = w.id))
             ORDER BY (SELECT count(*) FROM ranked r WHERE r.wing_id = w.id) DESC, w.name)
        FROM wings w
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb),
    'unmapped', (SELECT count(*)::int FROM ranked WHERE ranked.wing_id IS NULL),
    'rows', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', r.student_id, 'name', r.full_name, 'roll', r.roll,
        'class_label', r.class_label, 'wing_id', r.wing_id,
        'class_teacher', (SELECT ct.nm FROM ct WHERE ct.class_id = r.class_id),
        'rank_score', r.rank_score,
        'score', r.score, 'attendance_pct', r.attendance_pct,
        'homework_pct', r.homework_pct, 'submission_pct', r.submission_pct,
        'band', r.band, 'never_in', r.never_in,
        'reasons', (
          SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
            SELECT 'marks below 60%' t WHERE COALESCE(r.score, 100) < 60
            UNION ALL SELECT 'attendance below 72%' WHERE COALESCE(r.attendance_pct, 100) < 72
            UNION ALL SELECT 'under half the homework in' WHERE COALESCE(r.homework_pct, 100) < 50
            UNION ALL SELECT 'never signed in' WHERE r.never_in) z)
      ) ORDER BY r.rank_score, r.full_name), '[]'::jsonb)
      FROM (SELECT * FROM ranked ORDER BY rank_score, full_name
             LIMIT v_lim OFFSET GREATEST(COALESCE(p_offset,0),0)) r)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ----------------------- 4. absentees: the split and the hand-over -------- */

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
  -- The year figures each row carries beside its window figure. Without them a
  -- reader narrowing to "last 7 days" cannot tell a child who is always absent
  -- from one who had a bad week.
  yr AS MATERIALIZED (
    SELECT x.student_id, x.attendance_pct year_pct, x.score
      FROM public.dash5_student_rows(v_inst) x
  ),
  named AS (
    SELECT h.*, COALESCE(pf.full_name, pf.email) nm, pf.roll_number,
           cl.id class_id, cl.label class_label, cl.wing_id,
           y.year_pct, y.score
      FROM hit h
      JOIN profiles pf ON pf.id = h.student_id
      LEFT JOIN yr y ON y.student_id = h.student_id
      JOIN LATERAL (
        SELECT c2.* FROM rec r2 JOIN cls c2 ON c2.id = r2.class_id
         WHERE r2.student_id = h.student_id LIMIT 1) cl ON true
     WHERE h.run >= v_streak
       AND (p_wing_id IS NULL OR cl.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR cl.id = p_class_id)
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
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'student_id', r.student_id, 'name', r.nm, 'roll', r.roll_number,
        'class_id', r.class_id, 'class_label', r.class_label, 'wing_id', r.wing_id,
        'class_teacher', (SELECT ct.nm FROM ct WHERE ct.class_id = r.class_id),
        'pct', r.pct, 'days_counted', r.days_counted, 'absent_streak', r.run,
        'year_pct', r.year_pct, 'score', r.score
      ) ORDER BY r.pct, r.nm)
      FROM (SELECT * FROM named ORDER BY pct, nm LIMIT v_lim) r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------------------- grants ----- */

REVOKE EXECUTE ON FUNCTION public.dash5_student_subjects(uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_student_subjects(uuid,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_band_classes(text,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_band_classes(text,uuid,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_students_at_risk(uuid,uuid,int,int,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_students_at_risk(uuid,uuid,int,int,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_chronic_absentees(uuid,uuid,int,numeric,int,int,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_chronic_absentees(uuid,uuid,int,numeric,int,int,uuid) TO authenticated, service_role;
