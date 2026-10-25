-- Admin dashboard accuracy pass, part 2: the Students section.
-- Audit: docs/admin-dashboard-audit-2026-10-05.md. Builds on the shared counting
-- rules in 20261005160000_dash5_counting_rules.sql (dash5_counted_results).
--
-- What changed and why:
--  * R3  Portal adoption ("active in the last 7 days") read auth.users
--        .last_sign_in_at, which only moves on a password sign-in. It now reads
--        real last-seen: the later of last_sign_in_at and the newest session
--        refresh. Alliance 26.5% shown vs 35.7% real (141 active students read
--        inactive). "Never signed in" stays last_sign_in_at IS NULL (verified).
--  * R4  Scores counted unpublished marks. Every score here now comes from
--        dash5_counted_results inside the academic year: published exam AND
--        published result, not absent, blank (exam, class) papers left out.
--        Applies to dash5_student_rows (and everything built on it: tree,
--        bands, distribution, at-risk, drawer) and dash5_subject_roster.
--  * Test submission counted a paper marked absent as a paper sat, and the
--        subject level counted absent-only students and students no longer in
--        the class as "sat" (Math 27 / 26). Both now count a paper as sat only
--        when the student has a counted result, against the papers set to the
--        class that have counted results, and only for students on the roster.
--  * R1  A class mapped into two wings put each student in ONE arbitrary wing
--        (DISTINCT ON tie), so one class was split across wings at Salci
--        National. dash5_student_rows now returns wing_ids (every active wing of
--        the class, by display order then name) as a NEW LAST column; wing_id is
--        wing_ids[1], deterministic. Per-wing figures count a student in each of
--        their wings; school totals still count every student once.
--        RETURNS TABLE gained a column, so it is DROP + CREATE; grants restored
--        to exactly what they were (postgres, service_role).
--  * Roll numbers were hard-coded NULL; profiles.roll_number is filled for
--        1,395 of 1,545 Alliance students.
--  * Students with no counted result were put in band 'watch'. Their band is
--        now NULL, which the page shows as "Not assessed"; the donut keeps them
--        visible under a NEW key not_assessed (existing keys unchanged).
--  * The at-risk "under half the homework in" chip appeared on every row
--        although that rule only applies once the class itself uses homework
--        (class mean >= 40%, the same gate at_risk applies). It is gated now.
--  * Homework: drafts no longer count as set, and a submission counts only
--        against homework set to the student's own class (R16).
--  * dash5_student_subjects read dash5_atom_rows, which returns a class once per
--        wing; it is de-duplicated per subject now.
--  * dash5_student_counts picked a student's wing arbitrarily; it is the first
--        active wing (deterministic). Its only caller sums it for school totals,
--        so it deliberately keeps one row per student.
-- Signatures and existing jsonb keys are unchanged; new keys: tree.multi_wing,
-- distribution.multi_wing / unmapped / bands[].unmapped, donut.not_assessed /
-- multi_wing / unmapped / bands[].unmapped, at_risk.multi_wing,
-- never_signed_in.multi_wing.

-- --------------------------------------------------------------------------
-- 1. The per-student atom.
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dash5_student_rows(uuid);

CREATE FUNCTION public.dash5_student_rows(p_inst uuid)
 RETURNS TABLE(student_id uuid, full_name text, roll text, class_id uuid, class_label text,
               wing_id uuid, active7 boolean, never_in boolean, score numeric,
               attendance_pct numeric, homework_pct numeric, submission_pct numeric,
               band text, at_risk boolean, wing_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 -- Every join below is per-student aggregate against per-student aggregate.
 -- The planner under-estimates the CTE row counts and picks nested loops that
 -- re-scan them once per student (measured: 2.8 s at Alliance, 40 s with the
 -- extra CTEs). Hash joins only: 0.6 s, a third of it dash5_counted_results.
 SET enable_nestloop TO 'off'
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
    -- Every active wing the class is mapped into, in a fixed order, so a class
    -- in two wings belongs to both and never lands in one of them by chance.
    SELECT c.id AS cid, c.name || COALESCE(' ' || NULLIF(c.section,''), '') AS clabel,
           COALESCE((SELECT array_agg(w.id ORDER BY w.display_order NULLS LAST, w.name, w.id)
                       FROM wing_class_mappings m
                       JOIN wings w ON w.id = m.wing_id
                                   AND w.institution_id = p_inst
                                   AND w.is_active IS NOT FALSE
                      WHERE m.class_id = c.id), '{}'::uuid[]) AS wids
      FROM classes c
     WHERE c.institution_id = p_inst AND c.is_active IS NOT FALSE
  ),
  -- One row per student, through the canonical roster. A student sitting in two
  -- classes would otherwise be counted twice in every mean on the page.
  base AS MATERIALIZED (
    SELECT DISTINCT ON (s.student_id)
           s.student_id AS sid, cl.cid, cl.clabel, cl.wids
      FROM public.institution_student_ids(p_inst) s
      JOIN class_assignments ca ON ca.user_id = s.student_id AND ca.role::text = 'student'
      JOIN cls cl ON cl.cid = ca.class_id
     ORDER BY s.student_id, cl.clabel, cl.cid
  ),
  who AS MATERIALIZED (
    SELECT b.*, COALESCE(pf.full_name, pf.email) AS nm,
           NULLIF(btrim(pf.roll_number), '') AS rno,
           u.last_sign_in_at AS lsi,
           -- Real last-seen: sessions refresh for months without a new
           -- password sign-in, so last_sign_in_at alone undercounts activity.
           GREATEST(u.last_sign_in_at,
                    (SELECT max(GREATEST(ss.refreshed_at AT TIME ZONE 'UTC', ss.updated_at))
                       FROM auth.sessions ss WHERE ss.user_id = b.sid)) AS seen
      FROM base b
      JOIN profiles pf ON pf.id = b.sid
      LEFT JOIN auth.users u ON u.id = b.sid
  ),
  -- The results that count (published, not absent, not a blank paper), held
  -- inside the academic year. One row per result: dash5_counted_results
  -- repeats a result once per exam subject.
  cr AS MATERIALIZED (
    SELECT DISTINCT ON (r.result_id) r.result_id AS rid, r.exam_id AS eid,
           r.class_id AS rcid, r.student_id AS rsid, r.percentage AS pct
      FROM public.dash5_counted_results(p_inst) r
     WHERE r.exam_date BETWEEN v_ay_start AND v_ay_end
     ORDER BY r.result_id
  ),
  sc AS MATERIALIZED (SELECT cr.rsid, avg(cr.pct) AS avg_pct FROM cr GROUP BY cr.rsid),
  att AS MATERIALIZED (
    SELECT ar.student_id AS asid,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::numeric AS present,
           count(*)::numeric AS total
      FROM attendance_records ar
     WHERE ar.institution_id = p_inst AND ar.date BETWEEN v_ay_start AND v_ay_end
     GROUP BY ar.student_id
  ),
  -- Homework set to the student's class (drafts are not set), against what
  -- they handed in to THAT homework.
  hw_set AS MATERIALIZED (
    SELECT hc.class_id AS hcid, count(DISTINCT h.id)::numeric AS n
      FROM homework_assignments h
      JOIN homework_assignment_classes hc ON hc.homework_assignment_id = h.id
     WHERE h.institution_id = p_inst AND h.status IS DISTINCT FROM 'draft'
     GROUP BY hc.class_id
  ),
  hw_done AS MATERIALIZED (
    SELECT b.sid AS hsid, count(DISTINCT sub.homework_assignment_id)::numeric AS n
      FROM homework_submissions sub
      JOIN base b ON b.sid = sub.student_id
      JOIN homework_assignments h ON h.id = sub.homework_assignment_id
                                 AND h.institution_id = p_inst
                                 AND h.status IS DISTINCT FROM 'draft'
     WHERE EXISTS (SELECT 1 FROM homework_assignment_classes hc
                    WHERE hc.homework_assignment_id = sub.homework_assignment_id
                      AND hc.class_id = b.cid)
     GROUP BY b.sid
  ),
  -- Papers held in the class with counted results there (the same papers
  -- dash5_atom_rows counts), against the ones the student actually sat (a
  -- counted, non-absent result). A paper marked absent is not a paper sat; a
  -- paper still awaiting publication is neither.
  held AS MATERIALIZED (
    SELECT DISTINCT cr.rcid AS hcid, cr.eid AS heid FROM cr WHERE cr.rcid IS NOT NULL
  ),
  ex_set AS MATERIALIZED (SELECT h.hcid, count(*)::numeric AS n FROM held h GROUP BY h.hcid),
  ex_sat AS MATERIALIZED (
    SELECT b.sid AS esid, count(DISTINCT cr.eid)::numeric AS n
      FROM base b
      JOIN cr ON cr.rsid = b.sid
      JOIN held h ON h.hcid = b.cid AND h.heid = cr.eid
     GROUP BY b.sid
  ),
  j AS (
    SELECT w.sid, w.nm, w.rno, w.cid, w.clabel, w.wids,
           (w.seen IS NOT NULL AND w.seen >= now() - INTERVAL '7 days') AS act7,
           (w.lsi IS NULL) AS nev,
           round(sc.avg_pct, 1) AS sc1,
           CASE WHEN at2.total > 0 THEN round(at2.present*100.0/at2.total, 1) END AS att_pct,
           -- COALESCE inside LEAST, not around it: LEAST/GREATEST IGNORE nulls
           -- in Postgres, so LEAST(NULL, 180) is 180.
           CASE WHEN hs.n > 0 THEN round(LEAST(COALESCE(hd.n, 0), hs.n)*100.0/hs.n, 1) END AS hw_pct,
           CASE WHEN es.n > 0 THEN round(LEAST(COALESCE(ea.n, 0), es.n)*100.0/es.n, 1) END AS sub_pct
      FROM who w
      LEFT JOIN sc          ON sc.rsid = w.sid
      LEFT JOIN att at2     ON at2.asid = w.sid
      LEFT JOIN hw_set  hs  ON hs.hcid = w.cid
      LEFT JOIN hw_done hd  ON hd.hsid = w.sid
      LEFT JOIN ex_set  es  ON es.hcid = w.cid
      LEFT JOIN ex_sat  ea  ON ea.esid = w.sid
  ),
  -- "Not handing work in" is only a fact about a CHILD where handing work in is
  -- what the class does: the criterion sleeps until the class reaches 40%.
  class_hw AS MATERIALIZED (SELECT j.cid AS ccid, avg(j.hw_pct) AS m FROM j GROUP BY j.cid),
  jj AS (
    SELECT j.*, COALESCE(ch.m, 0) >= 40 AS hw_live
      FROM j LEFT JOIN class_hw ch ON ch.ccid = j.cid
  )
  SELECT j.sid, j.nm, j.rno,
         j.cid, j.clabel, j.wids[1],
         j.act7, j.nev,
         j.sc1, j.att_pct, j.hw_pct, j.sub_pct,
         -- Marks-only band. No counted result yet is NULL ("Not assessed"),
         -- not "Watch".
         CASE WHEN j.sc1 IS NULL THEN NULL
              WHEN j.sc1 >= 85 THEN 'exc'
              WHEN j.sc1 >= 72 THEN 'good'
              WHEN j.sc1 >= 60 THEN 'watch'
              ELSE 'att' END,
         -- At risk = failing marks, heavy absence, or not handing work in.
         -- A missing measure is not a signal.
         (COALESCE(j.sc1, 100) < 60
          OR COALESCE(j.att_pct, 100) < 72
          OR (j.hw_live AND COALESCE(j.hw_pct, 100) < 50)),
         j.wids
    FROM jj j;
END
$function$;

-- Restore exactly the previous grants (internal helper: postgres + service_role).
REVOKE ALL ON FUNCTION public.dash5_student_rows(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash5_student_rows(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.dash5_student_rows(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dash5_student_rows(uuid) TO service_role;

-- --------------------------------------------------------------------------
-- 2. The adoption drill (wings -> classes).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_student_tree(p_level text DEFAULT 'wings'::text, p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb;
  v_level text := lower(COALESCE(p_level, 'wings'));
BEGIN
  IF v_level NOT IN ('wings','classes') THEN
    RAISE EXCEPTION 'dash5: unknown student level %', p_level;
  END IF;
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);

  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  WITH s AS MATERIALIZED (
    SELECT * FROM public.dash5_student_rows(v_inst) x
     WHERE p_wing_id IS NULL OR p_wing_id = ANY(x.wing_ids)
  ),
  -- One row per (group, student). At wing level a student whose class is in
  -- two wings belongs to both; the total below still counts them once.
  m AS (
    SELECT g.gid AS grp_id, s.*
      FROM s
      CROSS JOIN LATERAL (
        SELECT u.wid AS gid FROM unnest(s.wing_ids) AS u(wid)
         WHERE v_level = 'wings' AND (p_wing_id IS NULL OR u.wid = p_wing_id)
        UNION ALL
        SELECT s.class_id WHERE v_level = 'classes'
      ) g
  ),
  agg AS (
    SELECT m.grp_id,
           count(*)::int students,
           round(avg(CASE WHEN m.active7 THEN 100.0 ELSE 0 END), 1) adopt_pct,
           round(avg(m.submission_pct), 1) sub_pct,
           round(avg(m.score) FILTER (WHERE m.score IS NOT NULL), 1) score_pct,
           round(avg(m.homework_pct), 1) hw_pct,
           round(avg(m.attendance_pct) FILTER (WHERE m.attendance_pct IS NOT NULL), 1) att_pct,
           count(*) FILTER (WHERE m.at_risk)::int at_risk,
           count(*) FILTER (WHERE m.never_in)::int never_in
      FROM m GROUP BY 1
  ),
  -- An active wing with nobody in it stays listed (0 students, every measure
  -- N/A) rather than vanishing.
  grp AS (
    SELECT a.* FROM agg a WHERE a.grp_id IS NOT NULL
    UNION ALL
    SELECT w.id, 0, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, 0, 0
      FROM wings w
     WHERE v_level = 'wings' AND w.institution_id = v_inst AND w.is_active IS NOT FALSE
       AND (p_wing_id IS NULL OR w.id = p_wing_id)
       AND NOT EXISTS (SELECT 1 FROM agg a WHERE a.grp_id = w.id)
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
      FROM grp g
  ),
  tot AS (
    SELECT count(*)::int students,
           round(avg(CASE WHEN s.active7 THEN 100.0 ELSE 0 END), 1) adopt_pct,
           round(avg(s.submission_pct), 1) sub_pct,
           round(avg(s.score) FILTER (WHERE s.score IS NOT NULL), 1) score_pct,
           round(avg(s.homework_pct), 1) hw_pct,
           round(avg(s.attendance_pct) FILTER (WHERE s.attendance_pct IS NOT NULL), 1) att_pct,
           count(*) FILTER (WHERE s.at_risk)::int at_risk,
           count(*) FILTER (WHERE s.never_in)::int never_in,
           count(*) FILTER (WHERE cardinality(s.wing_ids) > 1)::int multi_wing
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
       'at_risk', t.at_risk, 'never_in', t.never_in) FROM tot t),
    -- Students in a class mapped to more than one wing: they count in each
    -- wing row, so wing rows can add up to more than the total.
    'multi_wing', (SELECT t.multi_wing FROM tot t)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- --------------------------------------------------------------------------
-- 3. The adoption drill's third level: subjects inside one class.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_student_subjects(p_class_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, true);
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
    -- dash5_atom_rows returns a class once per wing it is mapped into; one row
    -- per subject here, or a class in two wings lists every subject twice.
    SELECT DISTINCT ON (x.subject_id) x.*
      FROM public.dash5_atom_rows(v_inst) x
     WHERE x.class_id = p_class_id
     ORDER BY x.subject_id, x.wing_id NULLS LAST
  ),
  roster AS MATERIALIZED (
    SELECT DISTINCT ca.user_id AS sid
      FROM class_assignments ca
     WHERE ca.class_id = p_class_id AND ca.role::text = 'student'
       AND ca.user_id IN (SELECT z.student_id FROM public.institution_student_ids(v_inst) z)
  ),
  -- Papers each rostered student actually sat in this class: a counted result
  -- (published, not absent, not a blank paper). One student sitting three
  -- papers is one head and three seats. A student no longer in the class is
  -- not a head of it.
  cr AS MATERIALIZED (
    SELECT DISTINCT r.exam_id, r.student_id, r.exam_subject_id, r.subject_key
      FROM public.dash5_counted_results(v_inst) r
     WHERE r.class_id = p_class_id
       AND r.exam_date BETWEEN v_ay_start AND v_ay_end
       AND r.student_id IN (SELECT roster.sid FROM roster)
  ),
  -- Each exam subject placed on the class's own subject the way
  -- dash5_atom_rows places it (same id first, else same name), resolved on the
  -- small distinct set so the result join stays an equality join.
  cmap AS (
    SELECT DISTINCT ON (k.exam_subject_id) k.exam_subject_id, ps.subject_id AS subj
      FROM (SELECT DISTINCT c.exam_subject_id, c.subject_key FROM cr c
             WHERE c.exam_subject_id IS NOT NULL) k
      JOIN a ps ON ps.subject_id = k.exam_subject_id OR ps.subject_key = k.subject_key
     ORDER BY k.exam_subject_id, (ps.subject_id = k.exam_subject_id) DESC, ps.subject_id
  ),
  sat AS (
    SELECT m.subj, count(DISTINCT c.student_id)::int heads,
           count(DISTINCT (c.exam_id, c.student_id))::int seats
      FROM cr c JOIN cmap m ON m.exam_subject_id = c.exam_subject_id
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
               'students_sat', COALESCE((SELECT s.heads FROM sat s WHERE s.subj = a.subject_id), 0),
               'papers', a.papers,
               -- Papers sat by rostered students against papers with counted
               -- results times the whole class roster.
               'submission_pct', CASE WHEN a.papers > 0 AND a.students > 0
                                      THEN round(COALESCE((SELECT s.seats FROM sat s
                                                            WHERE s.subj = a.subject_id), 0)
                                                 * 100.0 / (a.papers * a.students), 1) END,
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

-- --------------------------------------------------------------------------
-- 4. Score distribution.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_score_distribution(p_wing_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  WITH s AS MATERIALIZED (
    SELECT * FROM public.dash5_student_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR p_wing_id = ANY(x.wing_ids)) AND x.score IS NOT NULL
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
  -- Per wing a student counts in every wing their class is mapped into.
  cells AS (
    SELECT b.ord, wl.id wing_id, wl.name wing_name, count(s.student_id)::int n
      FROM bands b
      CROSS JOIN wl
      LEFT JOIN s ON wl.id = ANY(s.wing_ids) AND s.score >= b.lo AND s.score < b.hi
     GROUP BY 1,2,3
  ),
  -- The column total counts every student once, whatever their wings.
  tot AS (
    SELECT b.ord, count(s.student_id)::int n,
           count(s.student_id) FILTER (WHERE cardinality(s.wing_ids) = 0)::int unmapped
      FROM bands b
      LEFT JOIN s ON s.score >= b.lo AND s.score < b.hi
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'wings', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]'::jsonb) FROM wl),
    'bands', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
         'label', b.label,
         'total', t.n,
         'unmapped', t.unmapped,
         'by_wing', COALESCE((SELECT jsonb_agg(jsonb_build_object('wing_id', c.wing_id, 'n', c.n)
                                                ORDER BY c.wing_name)
                                FROM cells c WHERE c.ord = b.ord), '[]'::jsonb)
       ) ORDER BY b.ord), '[]'::jsonb)
       FROM bands b JOIN tot t ON t.ord = b.ord),
    'scored', (SELECT count(*)::int FROM s),
    'multi_wing', (SELECT count(*)::int FROM s WHERE cardinality(s.wing_ids) > 1),
    'unmapped', (SELECT count(*)::int FROM s WHERE cardinality(s.wing_ids) = 0)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- --------------------------------------------------------------------------
-- 5. Students who need attention.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_students_at_risk(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb; v_lim int := LEAST(GREATEST(COALESCE(p_limit,50),1), 200);
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);

  WITH a AS MATERIALIZED (SELECT * FROM public.dash5_student_rows(v_inst)),
  -- The class homework mean, the same gate at_risk applies: the homework
  -- reason is only a reason where the class itself hands work in (>= 40%).
  ch AS (SELECT a.class_id, avg(a.homework_pct) m FROM a GROUP BY 1),
  s AS MATERIALIZED (
    SELECT a.*, COALESCE(ch.m, 0) >= 40 AS hw_live
      FROM a LEFT JOIN ch ON ch.class_id = a.class_id
     WHERE a.at_risk
       AND (p_wing_id IS NULL OR p_wing_id = ANY(a.wing_ids))
       AND (p_class_id IS NULL OR a.class_id = p_class_id)
  ),
  ranked AS (
    -- Worst first: marks weigh most, then attendance, then work handed in.
    -- RETURNED, not just sorted on. Fill-ins for a missing measure: score 60,
    -- attendance 100, homework 0 (the page says so beside the list).
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
    -- Per wing a student counts in every wing their class is mapped into.
    'by_wing', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'wing_id', w.id, 'wing_name', w.name,
               'n', (SELECT count(*)::int FROM ranked r WHERE w.id = ANY(r.wing_ids)))
             ORDER BY (SELECT count(*) FROM ranked r WHERE w.id = ANY(r.wing_ids)) DESC, w.name)
        FROM wings w
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb),
    'unmapped', (SELECT count(*)::int FROM ranked WHERE cardinality(ranked.wing_ids) = 0),
    'multi_wing', (SELECT count(*)::int FROM ranked WHERE cardinality(ranked.wing_ids) > 1),
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
            UNION ALL SELECT 'under half the homework in'
                       WHERE r.hw_live AND COALESCE(r.homework_pct, 100) < 50
            UNION ALL SELECT 'never signed in' WHERE r.never_in) z)
      ) ORDER BY r.rank_score, r.full_name), '[]'::jsonb)
      FROM (SELECT * FROM ranked ORDER BY rank_score, full_name
             LIMIT v_lim OFFSET GREATEST(COALESCE(p_offset,0),0)) r)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- --------------------------------------------------------------------------
-- 6. One subject's student list (Subject drawer, Students tab).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_subject_roster(p_class_id uuid, p_subject_id uuid, p_limit integer DEFAULT 200, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_lim int; v_key text; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, true);
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 400);

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  -- universal_subjects holds one row per subject PER GRADE, so results are
  -- matched on the normalised name (dash5_counted_results.subject_key).
  SELECT initcap(lower(btrim(us.name))) INTO v_key
    FROM universal_subjects us WHERE us.id = p_subject_id;

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x WHERE x.class_id = p_class_id
  ),
  -- Counted results only (published, not absent, not a blank paper), one row
  -- per result.
  marks AS (
    SELECT r.student_id, round(avg(r.percentage), 1) pct, count(*)::int papers
      FROM (SELECT DISTINCT ON (c.result_id) c.result_id, c.student_id, c.percentage
              FROM public.dash5_counted_results(v_inst) c
             WHERE c.subject_key = v_key
               AND c.exam_date BETWEEN v_ay_start AND v_ay_end
               AND c.student_id IN (SELECT s.student_id FROM s)
             ORDER BY c.result_id) r
     GROUP BY 1
  ),
  j AS (
    SELECT s.student_id, s.full_name, s.roll, s.never_in,
           s.score, s.attendance_pct, s.homework_pct,
           m.pct subject_pct, COALESCE(m.papers, 0) subject_papers
      FROM s LEFT JOIN marks m ON m.student_id = s.student_id
  )
  SELECT jsonb_build_object(
    'class_id', p_class_id,
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'subject_id', p_subject_id,
    'subject_name', (SELECT us.name FROM universal_subjects us WHERE us.id = p_subject_id),
    'total', (SELECT count(*)::int FROM j),
    'scored', (SELECT count(*)::int FROM j WHERE j.subject_pct IS NOT NULL),
    'lowest',  (SELECT min(j.subject_pct) FROM j),
    'median',  (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY j.subject_pct)::numeric, 1)
                  FROM j WHERE j.subject_pct IS NOT NULL),
    'highest', (SELECT max(j.subject_pct) FROM j),
    'count', (SELECT count(*)::int FROM (SELECT 1 FROM j LIMIT v_lim) z),
    -- Unmarked students sort last, not first: a missing mark is not a zero.
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'student_id', r.student_id, 'name', r.full_name, 'roll', r.roll,
               'never_in', r.never_in, 'subject_pct', r.subject_pct,
               'subject_papers', r.subject_papers, 'score', r.score,
               'attendance_pct', r.attendance_pct, 'homework_pct', r.homework_pct) ORDER BY r.ord)
        FROM (SELECT j.*, row_number() OVER (
                       ORDER BY j.subject_pct NULLS LAST, j.full_name) ord
                FROM j ORDER BY j.subject_pct NULLS LAST, j.full_name LIMIT v_lim) r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- --------------------------------------------------------------------------
-- 7. The band donut.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_band_donut(p_wing_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR p_wing_id = ANY(x.wing_ids))
  ),
  wl AS (
    SELECT w.id, w.name FROM wings w
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
  ),
  b(band, ord) AS (VALUES ('att',1), ('watch',2), ('good',3), ('exc',4)),
  n AS (SELECT count(*) AS total FROM s)
  SELECT jsonb_build_object(
    'total', (SELECT n.total::int FROM n),
    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', wl.id, 'name', wl.name) ORDER BY wl.name)
        FROM wl), '[]'::jsonb),
    -- Marks-only bands. A student with no counted result yet is in none of
    -- them; they are counted under not_assessed instead of in "Watch".
    'bands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'band', b.band,
               'n', (SELECT count(*)::int FROM s WHERE s.band = b.band),
               'pct', CASE WHEN (SELECT n.total FROM n) > 0
                           THEN round((SELECT count(*) FROM s WHERE s.band = b.band)
                                      * 100.0 / (SELECT n.total FROM n), 0) END,
               'unmapped', (SELECT count(*)::int FROM s
                             WHERE s.band = b.band AND cardinality(s.wing_ids) = 0),
               -- Per wing a student counts in every wing their class is in.
               'by_wing', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                           'wing_id', wl.id, 'wing_name', wl.name,
                           'n', (SELECT count(*)::int FROM s
                                  WHERE s.band = b.band AND wl.id = ANY(s.wing_ids)))
                         ORDER BY wl.name)
                    FROM wl), '[]'::jsonb))
             ORDER BY b.ord)
        FROM b), '[]'::jsonb),
    'not_assessed', jsonb_build_object(
       'n', (SELECT count(*)::int FROM s WHERE s.band IS NULL),
       'pct', CASE WHEN (SELECT n.total FROM n) > 0
                   THEN round((SELECT count(*) FROM s WHERE s.band IS NULL)
                              * 100.0 / (SELECT n.total FROM n), 0) END,
       'unmapped', (SELECT count(*)::int FROM s
                     WHERE s.band IS NULL AND cardinality(s.wing_ids) = 0),
       'by_wing', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'wing_id', wl.id, 'wing_name', wl.name,
                   'n', (SELECT count(*)::int FROM s
                          WHERE s.band IS NULL AND wl.id = ANY(s.wing_ids)))
                 ORDER BY wl.name)
            FROM wl), '[]'::jsonb)),
    'multi_wing', (SELECT count(*)::int FROM s WHERE cardinality(s.wing_ids) > 1),
    'unmapped', (SELECT count(*)::int FROM s WHERE cardinality(s.wing_ids) = 0)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- --------------------------------------------------------------------------
-- 8. The donut's third level: the classes behind one band inside one wing.
--    p_band 'none' selects the students not assessed yet.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_band_classes(p_band text, p_wing_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb; v_band text;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  IF p_band NOT IN ('att','watch','good','exc','none') THEN
    RAISE EXCEPTION 'dash5: unknown band';
  END IF;
  v_band := NULLIF(p_band, 'none');

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR p_wing_id = ANY(x.wing_ids))
  )
  SELECT jsonb_build_object(
    'band', p_band,
    'wing_id', p_wing_id,
    'wing_name', (SELECT w.name FROM wings w WHERE w.id = p_wing_id),
    'in_band', (SELECT count(*)::int FROM s WHERE s.band IS NOT DISTINCT FROM v_band),
    'total', (SELECT count(*)::int FROM s),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'class_id', z.class_id, 'class_label', z.class_label,
               'n', z.n, 'of', z.of,
               'pct', CASE WHEN z.of > 0 THEN round(z.n * 100.0 / z.of, 1) END)
             ORDER BY z.n DESC, z.class_label)
        FROM (
          SELECT s.class_id, s.class_label,
                 count(*) FILTER (WHERE s.band IS NOT DISTINCT FROM v_band)::int n,
                 count(*)::int of
            FROM s
           WHERE s.class_id IS NOT NULL
           GROUP BY 1, 2
          HAVING count(*) FILTER (WHERE s.band IS NOT DISTINCT FROM v_band) > 0
        ) z), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- --------------------------------------------------------------------------
-- 9. Never signed in (drawer behind the adoption alert).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_never_signed_in(p_wing_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_lim int; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300);

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x
  ),
  n AS (SELECT * FROM s WHERE s.never_in),
  -- Per wing a student counts in every wing their class is mapped into.
  w AS (
    SELECT wg.id, wg.name,
           (SELECT count(*)::int FROM s WHERE wg.id = ANY(s.wing_ids)) students,
           (SELECT count(*)::int FROM n WHERE wg.id = ANY(n.wing_ids)) never_in,
           (SELECT wa.user_id FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = wg.id AND pf.is_active IS NOT FALSE
             ORDER BY pf.full_name LIMIT 1) coord_id,
           (SELECT COALESCE(pf.full_name, pf.email) FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = wg.id AND pf.is_active IS NOT FALSE
             ORDER BY pf.full_name LIMIT 1) coord_name
      FROM wings wg
     WHERE wg.institution_id = v_inst AND wg.is_active IS NOT FALSE
  ),
  f AS (SELECT * FROM n WHERE p_wing_id IS NULL OR p_wing_id = ANY(n.wing_ids))
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM n),
    'students', (SELECT count(*)::int FROM s),
    'filtered_total', (SELECT count(*)::int FROM f),
    'count', (SELECT count(*)::int FROM (SELECT 1 FROM f LIMIT v_lim) z),
    'unmapped', (SELECT count(*)::int FROM n WHERE cardinality(n.wing_ids) = 0),
    'multi_wing', (SELECT count(*)::int FROM n WHERE cardinality(n.wing_ids) > 1),
    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'wing_id', w.id, 'wing_name', w.name, 'students', w.students,
               'never_in', w.never_in,
               'pct', CASE WHEN w.students > 0
                           THEN round(w.never_in*100.0/w.students, 1) END,
               'coordinator_id', w.coord_id, 'coordinator', w.coord_name)
             ORDER BY w.never_in DESC, w.name) FROM w), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'student_id', r.student_id, 'name', r.full_name, 'roll', r.roll,
               'class_label', r.class_label, 'wing_id', r.wing_id) ORDER BY r.class_label, r.full_name)
        FROM (SELECT * FROM f ORDER BY f.class_label, f.full_name LIMIT v_lim) r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- --------------------------------------------------------------------------
-- 10. Per-wing never-signed-in and below-75% counts (task suggestions).
--     Its only caller sums the rows into school totals, so a student keeps ONE
--     row: their first active wing, chosen deterministically (it was arbitrary).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_student_counts(p_inst uuid)
 RETURNS TABLE(wing_id uuid, never_in integer, below_floor integer, students integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(p_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  WITH base AS (
    SELECT DISTINCT ON (s.student_id) s.student_id AS sid,
           (SELECT w.id FROM wing_class_mappings m
              JOIN wings w ON w.id = m.wing_id AND w.institution_id = p_inst
                          AND w.is_active IS NOT FALSE
             WHERE m.class_id = c.id
             ORDER BY w.display_order NULLS LAST, w.name, w.id
             LIMIT 1) AS wid
      FROM public.institution_student_ids(p_inst) s
      JOIN class_assignments ca ON ca.user_id = s.student_id AND ca.role::text = 'student'
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_inst AND c.is_active IS NOT FALSE
     ORDER BY s.student_id, c.name || COALESCE(' ' || NULLIF(c.section,''), ''), c.id
  ),
  att AS (
    SELECT ar.student_id AS asid,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::numeric p,
           count(*)::numeric n
      FROM attendance_records ar
     WHERE ar.institution_id = p_inst AND ar.date BETWEEN v_ay_start AND v_ay_end
     GROUP BY ar.student_id
  )
  SELECT b.wid,
         count(*) FILTER (WHERE u.last_sign_in_at IS NULL)::int,
         count(*) FILTER (WHERE a.n > 0 AND a.p * 100.0 / a.n < 75)::int,
         count(*)::int
    FROM base b
    LEFT JOIN auth.users u ON u.id = b.sid
    LEFT JOIN att a ON a.asid = b.sid
   GROUP BY b.wid;
END
$function$;
