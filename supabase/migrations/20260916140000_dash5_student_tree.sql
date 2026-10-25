-- Admin Dashboard v5, phase 3: the student side.
-- Design: docs/superpowers/specs/2026-09-16-admin-dashboard-v5-design.md
--
-- The same discipline as the performance tree, one level down: ONE per-student
-- atom, and the wing / class / school figures are means over the students inside
-- the row. Nothing is modelled and nothing is typed twice.
--
-- The student atom deliberately measures the STUDENT side only: did they open
-- the portal, did they sit the paper, did they hand the homework in, were they
-- in the room. Teaching-side measures live in dash5_tree.

/* ---------------------------------------------------------- student atom -- */

-- INTERNAL, trusts its institution argument, revoked from every client role.
DROP FUNCTION IF EXISTS public.dash5_student_rows(uuid);
CREATE OR REPLACE FUNCTION public.dash5_student_rows(p_inst uuid)
RETURNS TABLE (
  student_id uuid, full_name text, roll text,
  class_id uuid, class_label text, wing_id uuid,
  active7 boolean, never_in boolean,
  score numeric, attendance_pct numeric, homework_pct numeric, submission_pct numeric,
  band text, at_risk boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(p_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  WITH cls AS (
    SELECT c.id, c.name || COALESCE(' ' || NULLIF(c.section,''), '') label, m.wing_id
      FROM classes c
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE c.institution_id = p_inst AND c.is_active IS NOT FALSE
  ),
  -- One row per student, through the canonical roster. A student sitting in two
  -- classes would otherwise be counted twice in every mean on the page.
  base AS (
    SELECT DISTINCT ON (s.student_id)
           s.student_id, cl.id AS class_id, cl.label AS class_label, cl.wing_id
      FROM public.institution_student_ids(p_inst) s
      JOIN class_assignments ca ON ca.user_id = s.student_id AND ca.role::text = 'student'
      JOIN cls cl ON cl.id = ca.class_id
     ORDER BY s.student_id, cl.label
  ),
  who AS (
    SELECT b.*, COALESCE(pf.full_name, pf.email) nm,
           u.last_sign_in_at
      FROM base b
      JOIN profiles pf ON pf.id = b.student_id
      LEFT JOIN auth.users u ON u.id = b.student_id
  ),
  sc AS (
    SELECT a.student_id, avg(fr.percentage) score
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
     WHERE e.institution_id = p_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
       AND COALESCE(fr.is_absent, false) = false
     GROUP BY 1
  ),
  att AS (
    SELECT ar.student_id,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::numeric present,
           count(*)::numeric total
      FROM attendance_records ar
     WHERE ar.institution_id = p_inst AND ar.date BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  ),
  -- Homework set to the student's class, against what they handed in.
  hw_set AS (
    SELECT hc.class_id, count(DISTINCT h.id)::numeric n
      FROM homework_assignments h
      JOIN homework_assignment_classes hc ON hc.homework_assignment_id = h.id
     WHERE h.institution_id = p_inst
     GROUP BY 1
  ),
  hw_done AS (
    SELECT sub.student_id, count(DISTINCT sub.homework_assignment_id)::numeric n
      FROM homework_submissions sub
      JOIN homework_assignments h ON h.id = sub.homework_assignment_id
     WHERE h.institution_id = p_inst
     GROUP BY 1
  ),
  -- Papers set to the student's class, against the ones they actually sat.
  ex_set AS (
    SELECT ec.class_id, count(DISTINCT e.id)::numeric n
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.institution_id = p_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  ),
  ex_sat AS (
    SELECT a.student_id, count(DISTINCT a.exam_id)::numeric n
      FROM student_exam_attempts a
      JOIN exams e ON e.id = a.exam_id
     WHERE e.institution_id = p_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  ),
  j AS (
    SELECT w.student_id, w.nm, w.class_id, w.class_label, w.wing_id,
           (w.last_sign_in_at IS NOT NULL AND w.last_sign_in_at >= now() - INTERVAL '7 days') act7,
           (w.last_sign_in_at IS NULL) nev,
           round(sc.score, 1) score,
           CASE WHEN at2.total > 0 THEN round(at2.present*100.0/at2.total, 1) END att_pct,
           -- COALESCE inside LEAST, not around it: LEAST/GREATEST IGNORE nulls
           -- in Postgres, so LEAST(NULL, 180) is 180, and every student who had
           -- submitted nothing was scoring 100%. Measured on Alliance: 1,411 of
           -- 1,545 read 100% and not one read 0.
           CASE WHEN hs.n > 0 THEN round(LEAST(COALESCE(hd.n, 0), hs.n)*100.0/hs.n, 1) END hw_pct,
           CASE WHEN es.n > 0 THEN round(LEAST(COALESCE(ea.n, 0), es.n)*100.0/es.n, 1) END sub_pct
      FROM who w
      LEFT JOIN sc      ON sc.student_id = w.student_id
      LEFT JOIN att at2 ON at2.student_id = w.student_id
      LEFT JOIN hw_set  hs ON hs.class_id = w.class_id
      LEFT JOIN hw_done hd ON hd.student_id = w.student_id
      LEFT JOIN ex_set  es ON es.class_id = w.class_id
      LEFT JOIN ex_sat  ea ON ea.student_id = w.student_id
  ),
  -- "Not handing work in" is only a fact about a CHILD where handing work in is
  -- what the class does. The reference's < 50% rule assumed classes running at
  -- 62-95%; Alliance runs at 0.7%, where the rule stops describing children and
  -- starts describing the school. Ungated it flagged 1,542 of 1,545 and buried
  -- the 739 with real marks or attendance problems, which is precisely the
  -- undifferentiated-alarm failure this rebuild exists to end. So the criterion
  -- sleeps until the class itself reaches 40%, and switches on by itself when a
  -- school starts using homework properly. The school-wide failure is still
  -- reported, once, as an insight.
  class_hw AS (SELECT j.class_id, avg(j.hw_pct) m FROM j GROUP BY 1),
  jj AS (
    SELECT j.*, COALESCE((SELECT ch.m FROM class_hw ch WHERE ch.class_id = j.class_id), 0) >= 40 hw_live
      FROM j
  )
  SELECT j.student_id, j.nm,
         NULL::text,                       -- roll: no roll column on profiles here
         j.class_id, j.class_label, j.wing_id,
         j.act7, j.nev,
         j.score, j.att_pct, j.hw_pct, j.sub_pct,
         CASE WHEN j.score IS NULL THEN 'watch'
              WHEN j.score >= 85 THEN 'exc'
              WHEN j.score >= 72 THEN 'good'
              WHEN j.score >= 60 THEN 'watch'
              ELSE 'att' END,
         -- At risk = failing marks, heavy absence, or not handing work in.
         -- A missing measure is not a signal: a class that was never set any
         -- homework must not make every child in it a case to chase.
         (COALESCE(j.score, 100) < 60
          OR COALESCE(j.att_pct, 100) < 72
          OR (j.hw_live AND COALESCE(j.hw_pct, 100) < 50))
    FROM jj j;
END
$function$;

/* --------------------------------------------------------- student tree --- */

CREATE OR REPLACE FUNCTION public.dash5_student_tree(
  p_level          text DEFAULT 'wings',
  p_wing_id        uuid DEFAULT NULL,
  p_class_id       uuid DEFAULT NULL,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb;
  v_level text := lower(COALESCE(p_level, 'wings'));
BEGIN
  IF v_level NOT IN ('wings','classes') THEN
    RAISE EXCEPTION 'dash5: unknown student level %', p_level;
  END IF;
  v_inst := public.dash_resolve_institution(p_institution_id);

  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  WITH s AS MATERIALIZED (
    SELECT * FROM public.dash5_student_rows(v_inst) x
     WHERE p_wing_id IS NULL OR x.wing_id = p_wing_id
  ),
  agg AS (
    SELECT CASE WHEN v_level = 'wings' THEN s.wing_id ELSE s.class_id END grp_id,
           count(*)::int students,
           round(avg(CASE WHEN s.active7 THEN 100.0 ELSE 0 END), 1) adopt_pct,
           round(avg(s.submission_pct), 1) sub_pct,
           round(avg(s.score) FILTER (WHERE s.score IS NOT NULL), 1) score_pct,
           round(avg(s.homework_pct), 1) hw_pct,
           round(avg(s.attendance_pct) FILTER (WHERE s.attendance_pct IS NOT NULL), 1) att_pct,
           count(*) FILTER (WHERE s.at_risk)::int at_risk,
           count(*) FILTER (WHERE s.never_in)::int never_in
      FROM s GROUP BY 1
  ),
  rows_j AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', g.grp_id,
      'name', CASE WHEN v_level = 'wings'
                THEN (SELECT w.name FROM wings w WHERE w.id = g.grp_id)
                ELSE (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                        FROM classes c WHERE c.id = g.grp_id) END,
      'students', g.students, 'adopt_pct', g.adopt_pct, 'submission_pct', g.sub_pct,
      'score_pct', g.score_pct, 'homework_pct', g.hw_pct, 'attendance_pct', g.att_pct,
      'at_risk', g.at_risk, 'never_in', g.never_in
    ) ORDER BY CASE WHEN v_level = 'wings'
                 THEN (SELECT w.name FROM wings w WHERE w.id = g.grp_id)
                 ELSE (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                         FROM classes c WHERE c.id = g.grp_id) END), '[]'::jsonb) j
      FROM agg g WHERE g.grp_id IS NOT NULL
  ),
  tot AS (
    SELECT count(*)::int students,
           round(avg(CASE WHEN s.active7 THEN 100.0 ELSE 0 END), 1) adopt_pct,
           round(avg(s.submission_pct), 1) sub_pct,
           round(avg(s.score) FILTER (WHERE s.score IS NOT NULL), 1) score_pct,
           round(avg(s.homework_pct), 1) hw_pct,
           round(avg(s.attendance_pct) FILTER (WHERE s.attendance_pct IS NOT NULL), 1) att_pct,
           count(*) FILTER (WHERE s.at_risk)::int at_risk,
           count(*) FILTER (WHERE s.never_in)::int never_in
      FROM s
  )
  SELECT jsonb_build_object(
    'level', v_level,
    'scope', jsonb_build_object('wing_id', p_wing_id,
       'wing_name', (SELECT w.name FROM wings w WHERE w.id = p_wing_id)),
    'rows', (SELECT j FROM rows_j),
    'total', (SELECT jsonb_build_object(
       'students', t.students, 'adopt_pct', t.adopt_pct, 'submission_pct', t.sub_pct,
       'score_pct', t.score_pct, 'homework_pct', t.hw_pct, 'attendance_pct', t.att_pct,
       'at_risk', t.at_risk, 'never_in', t.never_in) FROM tot t)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ---------------------------------------------------- score distribution -- */

-- Five score bands, each split by wing, for the stacked bar. Bands are the
-- student-side cut (the donut's three are a different question and stay as they
-- are in dash_student_distribution).
CREATE OR REPLACE FUNCTION public.dash5_score_distribution(
  p_wing_id uuid DEFAULT NULL, p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  WITH s AS MATERIALIZED (
    SELECT * FROM public.dash5_student_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR x.wing_id = p_wing_id) AND x.score IS NOT NULL
  ),
  bands(lo, hi, label, ord) AS (
    VALUES (0,40,'0 to 40',1), (40,55,'40 to 55',2), (55,70,'55 to 70',3),
           (70,85,'70 to 85',4), (85,101,'85 to 100',5)
  ),
  wl AS (
    SELECT w.id, w.name FROM wings w
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
       AND (p_wing_id IS NULL OR w.id = p_wing_id)
  ),
  cells AS (
    SELECT b.ord, b.label, wl.id wing_id, wl.name wing_name,
           count(s.student_id)::int n
      FROM bands b
      CROSS JOIN wl
      LEFT JOIN s ON s.wing_id = wl.id AND s.score >= b.lo AND s.score < b.hi
     GROUP BY 1,2,3,4
  )
  SELECT jsonb_build_object(
    'wings', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]'::jsonb) FROM wl),
    'bands', (SELECT COALESCE(jsonb_agg(x ORDER BY ord), '[]'::jsonb) FROM (
       SELECT c.ord, jsonb_build_object(
         'label', c.label,
         'total', sum(c.n)::int,
         'by_wing', jsonb_agg(jsonb_build_object('wing_id', c.wing_id, 'n', c.n) ORDER BY c.wing_name)
       ) x FROM cells c GROUP BY c.ord, c.label) q),
    'scored', (SELECT count(*)::int FROM s)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------- students who need help - */

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
    -- most, then attendance, then work handed in.
    SELECT s.*, (COALESCE(s.score,60)*0.5 + COALESCE(s.attendance_pct,100)*0.3
                 + COALESCE(s.homework_pct,0)*0.2) rank_score
      FROM s
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM ranked),
    'rows', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', r.student_id, 'name', r.full_name,
        'class_label', r.class_label, 'wing_id', r.wing_id,
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

/* ----------------------------------------------------------- privileges --- */
REVOKE EXECUTE ON FUNCTION public.dash5_student_tree(text,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_score_distribution(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_students_at_risk(uuid,uuid,int,int,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash5_student_tree(text,uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_score_distribution(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_students_at_risk(uuid,uuid,int,int,uuid) TO authenticated, service_role;

-- Trusts its institution argument, so no client role may call it directly.
REVOKE EXECUTE ON FUNCTION public.dash5_student_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dash5_student_rows(uuid) TO service_role;
