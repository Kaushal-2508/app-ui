-- Admin dashboard accuracy pass: the Academics section.
-- Audit: docs/admin-dashboard-audit-2026-10-05.md (R1, R2, R4, R8, R15 and the
-- pass-mark line). Decisions (Tushar, 2026-10-05): averages use PUBLISHED marks
-- only, blank papers (every counted mark exactly 0) are left out, every row stays
-- visible. Builds on 20261005160000_dash5_counting_rules.sql and reads results
-- ONLY through dash5_counted_results, so a paper, a subject bar and the tree all
-- count the same rows.
--
-- dash5_exam_papers (scatter, "Exam performance over time")
--   * Results from dash5_counted_results: published marks only, absentees and
--     blank papers out (R4, decision 2).
--   * No wing multiplier. The old body joined wing_class_mappings and multiplied
--     every count by k = wings x subjects, so a class in two wings showed
--     "18 of 9 appeared" (R1). The wing filter is now an EXISTS.
--   * The date is the day the paper was held (exam_date), not the publish day:
--     277 Alliance papers were plotted more than 3 days late (R8).
--   * Pass rate uses the paper's own pass mark (pass_marks / total_marks); 35% only
--     when the paper sets none. New key pass_mark_pct.
--   * The subject is mapped onto the class's own subject by name (exact id first),
--     the same rule as the tree (R2).
-- dash5_paper_detail (paper drawer)
--   * Average, median, pass rate, top, bands and the top/bottom five read the same
--     counted results. date = exam_date, so the drawer and the dot agree (R8).
--   * New keys: pass_mark_pct, no_record (roster students with no result row at
--     all), blank (the paper is left out because every mark is 0).
--   * Class and school baselines computed the way dash5_tree computes its class
--     and school averages (every counted result of the year in an active class
--     that teaches a subject), so the drawer quotes the tree's own figures (R1, R2).
--   * absent / unpublished counters unchanged.
-- dash_school_subject_performance (subject chart, school view)
--   * Counted results in the academic year: absentees no longer averaged in as 0
--     (Punjabi showed 53.7 for 64.6), unpublished and blank papers out (R15, R4).
--   * Subjects grouped by a normalised name: case, spacing and punctuation folded,
--     "&" read as "and", Maths = Mathematics, SST = Social Science.
--   * results = the counted rows behind the average.
-- dash_subject_performance (subject chart, class view)
--   * Counted results in the academic year (it had no year window and averaged
--     absentees as 0), mapped onto the class's own subjects by name, exact id
--     first: the same rule dash5_atom_rows uses, so a bar here equals the tree.
--   * school_avg is now really school-wide (same normalised subject, every grade).
--     It used to be the same subject id only, which is one grade, and the caption
--     called it "School". New keys: grade_avg / grade_sections / grade_label for
--     the comparison against the other sections of the same class group, and
--     results per subject.
-- Signatures, return shapes and grants unchanged; jsonb keys only added.

-- ---------------------------------------------------------------- papers ----
CREATE OR REPLACE FUNCTION public.dash5_exam_papers(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 400, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_from date; v_to date; v_lim int; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 400), 1), 400);

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_from := COALESCE(p_from, v_ay_start, v_today - INTERVAL '12 months')::date;
  v_to   := COALESCE(p_to, v_today)::date;

  WITH cr AS MATERIALIZED (
    -- The results that count (published, not absent, not a blank paper), on the
    -- day the paper was held. A class in two wings is still one class: the wing
    -- filter is an EXISTS, never a join that repeats the rows.
    SELECT c.exam_id, c.class_id, c.exam_subject_id, c.subject_key, c.percentage, c.exam_date
      FROM public.dash5_counted_results(v_inst) c
      JOIN classes cl ON cl.id = c.class_id AND cl.is_active IS NOT FALSE
     WHERE c.exam_date BETWEEN v_from AND v_to
       AND (p_class_id IS NULL OR c.class_id = p_class_id)
       AND (p_wing_id IS NULL OR EXISTS (
             SELECT 1 FROM wing_class_mappings m
              WHERE m.class_id = c.class_id AND m.wing_id = p_wing_id))
  ),
  sc AS (
    -- One row per paper (exam, class, subject). The pass line is the paper's own
    -- pass mark as a percentage; 35% only when the paper sets none.
    SELECT cr.exam_id, cr.class_id, cr.exam_subject_id,
           max(cr.subject_key) skey, min(cr.exam_date) d,
           count(*)::int appeared,
           round(avg(cr.percentage), 1) avg_pct,
           round(max(cr.percentage), 1) top_pct,
           round(count(*) FILTER (WHERE cr.percentage >= pm.v) * 100.0 / count(*), 1) pass_pct,
           round(max(pm.v), 1) pass_mark_pct
      FROM cr
      JOIN exams e ON e.id = cr.exam_id
      CROSS JOIN LATERAL (
        SELECT CASE WHEN e.pass_marks > 0 AND e.total_marks > 0
                    THEN LEAST(e.pass_marks * 100.0 / e.total_marks, 100)
                    ELSE 35 END v) pm
     GROUP BY cr.exam_id, cr.class_id, cr.exam_subject_id
  ),
  rost AS MATERIALIZED (
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
     WHERE ca.role::text = 'student'
       AND ca.user_id IN (SELECT z.student_id FROM public.institution_student_ids(v_inst) z)
     GROUP BY 1
  ),
  -- The class's own subject for each (class, exam subject) pair: exact id first,
  -- else the same normalised name (universal_subjects holds one row per grade).
  -- Resolved once per distinct pair, then joined on equality.
  pmap AS (
    SELECT p.class_id, p.exam_subject_id,
           (SELECT scm.subject_id
              FROM subject_class_mappings scm
              JOIN universal_subjects u2 ON u2.id = scm.subject_id
             WHERE scm.class_id = p.class_id
               AND (scm.subject_id = p.exam_subject_id
                    OR initcap(lower(btrim(u2.name))) = p.skey)
             ORDER BY (scm.subject_id = p.exam_subject_id) DESC NULLS LAST, scm.subject_id
             LIMIT 1) AS subject_id
      FROM (SELECT DISTINCT sc.class_id, sc.exam_subject_id, sc.skey FROM sc) p
  ),
  rows_all AS (
    SELECT sc.exam_id, e.title, e.exam_type::text cycle, sc.d, sc.class_id,
           COALESCE(pm.subject_id, sc.exam_subject_id) subject_id,
           COALESCE(us.name, ues.name) subject_name,
           CASE WHEN e.is_results_only THEN 'Marks only'
                WHEN e.is_offline THEN 'Offline' ELSE 'Online' END mode,
           e.total_marks,
           c.name || COALESCE(' ' || NULLIF(c.section,''), '') class_label,
           sc.appeared, sc.avg_pct, sc.pass_pct, sc.top_pct, sc.pass_mark_pct,
           COALESCE(rost.n, 0) roster
      FROM sc
      JOIN exams e ON e.id = sc.exam_id
      JOIN classes c ON c.id = sc.class_id
      LEFT JOIN pmap pm ON pm.class_id = sc.class_id
                       AND pm.exam_subject_id = sc.exam_subject_id
      LEFT JOIN universal_subjects us  ON us.id  = pm.subject_id
      LEFT JOIN universal_subjects ues ON ues.id = sc.exam_subject_id
      LEFT JOIN rost ON rost.class_id = sc.class_id
  ),
  shown AS (
    SELECT * FROM rows_all ORDER BY d DESC, class_label, exam_id LIMIT v_lim
  )
  SELECT jsonb_build_object(
    'from', v_from, 'to', v_to,
    'total', (SELECT count(*)::int FROM rows_all),
    'count', (SELECT count(*)::int FROM shown),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'exam_id', r.exam_id, 'title', r.title, 'cycle', r.cycle, 'date', r.d,
               'class_id', r.class_id, 'class_label', r.class_label,
               'subject_id', r.subject_id, 'subject_name', r.subject_name,
               'teacher', (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
                             FROM class_assignments ca
                             JOIN profiles pf ON pf.id = ca.user_id
                            WHERE ca.class_id = r.class_id AND ca.subject_id = r.subject_id
                              AND ca.role::text = 'teacher'),
               'avg_pct', r.avg_pct, 'pass_pct', r.pass_pct, 'top_pct', r.top_pct,
               'pass_mark_pct', r.pass_mark_pct,
               'appeared', r.appeared, 'roster', r.roster,
               'mode', r.mode, 'total_marks', r.total_marks,
               'band', public.dash5_band_or_null(r.avg_pct))
             ORDER BY r.d DESC, r.class_label, r.exam_id)
        FROM shown r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- ---------------------------------------------------------- paper detail ----
CREATE OR REPLACE FUNCTION public.dash5_paper_detail(p_exam_id uuid, p_class_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
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
  IF NOT EXISTS (SELECT 1 FROM exams WHERE id = p_exam_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: exam not in institution';
  END IF;
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - 365);
  v_ay_end   := COALESCE(v_ay_end, v_today);

  WITH cr AS MATERIALIZED (
    -- The counted results (published, not absent, not a blank paper), read once.
    SELECT * FROM public.dash5_counted_results(v_inst)
  ),
  r AS (
    -- Every result row on this paper, whatever its state: the counters below.
    SELECT a.student_id, fr.percentage pct, fr.is_absent, fr.is_published
      FROM student_exam_attempts a
      JOIN final_results fr ON fr.attempt_id = a.id
     WHERE a.exam_id = p_exam_id
       AND (p_class_id IS NULL OR a.class_id = p_class_id)
  ),
  sat AS (
    -- The marks that count, the rule every average on the page uses: published,
    -- not absent, and not a blank paper. One row per result.
    SELECT DISTINCT ON (c.result_id)
           c.result_id, c.student_id, c.percentage pct,
           fr.total_marks_obtained, fr.total_max_marks,
           COALESCE(pf.full_name, pf.email) nm
      FROM cr c
      JOIN final_results fr ON fr.id = c.result_id
      JOIN profiles pf ON pf.id = c.student_id
     WHERE c.exam_id = p_exam_id
       AND (p_class_id IS NULL OR c.class_id = p_class_id)
     ORDER BY c.result_id
  ),
  pm AS (
    SELECT CASE WHEN e.pass_marks > 0 AND e.total_marks > 0
                THEN LEAST(e.pass_marks * 100.0 / e.total_marks, 100)
                ELSE 35 END v
      FROM exams e WHERE e.id = p_exam_id
  ),
  roster_ids AS (
    SELECT DISTINCT ca.user_id
      FROM class_assignments ca
     WHERE ca.role::text = 'student'
       AND (p_class_id IS NULL OR ca.class_id = p_class_id)
       AND ca.user_id IN (SELECT z.student_id FROM public.institution_student_ids(v_inst) z)
  ),
  -- The two baselines, computed the way dash5_tree computes its class and school
  -- averages: every counted result of the academic year in an active class that
  -- teaches at least one subject, whatever subject it was filed under. A class in
  -- two wings is one class here (no wing join).
  yr AS (
    SELECT c.class_id, c.percentage
      FROM cr c
     WHERE c.exam_date BETWEEN v_ay_start AND v_ay_end
       AND c.class_id IN (SELECT scm.class_id
                            FROM subject_class_mappings scm
                            JOIN classes k ON k.id = scm.class_id AND k.is_active IS NOT FALSE
                           WHERE scm.institution_id = v_inst)
  ),
  cl AS (
    SELECT round(avg(yr.percentage), 1) v
      FROM yr WHERE p_class_id IS NULL OR yr.class_id = p_class_id
  ),
  sch AS (
    SELECT round(avg(yr.percentage), 1) v FROM yr
  ),
  buckets(lo, hi, label, ord) AS (
    VALUES (80::numeric, 1000::numeric, '80% and above', 1),
           (65, 80, '65 to 79%', 2), (50, 65, '50 to 64%', 3),
           (35, 50, '35 to 49%', 4), (-1, 35, 'Below 35%', 5)
  )
  SELECT jsonb_build_object(
    'exam_id', e.id,
    'title', e.title,
    -- The day the paper was held, the same expression dash5_counted_results uses,
    -- so the drawer and the dot it was opened from show one date.
    'date', (COALESCE(
               CASE WHEN e.scheduled_date BETWEEN e.created_at - INTERVAL '400 days'
                                              AND e.created_at + INTERVAL '400 days'
                    THEN e.scheduled_date END,
               e.start_time, e.published_at, e.created_at)
             AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date,
    'status', e.status::text,
    'mode', CASE WHEN e.is_results_only THEN 'Marks only'
                 WHEN e.is_offline THEN 'Offline' ELSE 'Online' END,
    'exam_type', e.exam_type::text,
    'total_marks', e.total_marks,
    'pass_marks', e.pass_marks,
    'pass_mark_pct', (SELECT round(v, 1) FROM pm),
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'subjects', (SELECT string_agg(DISTINCT us.name, ', ')
                   FROM exam_subjects es
                   JOIN universal_subjects us ON us.id = es.subject_id
                  WHERE es.exam_id = e.id),
    -- The class's own teacher for the paper's subject, matched by name as well as
    -- id (one universal_subjects row per grade).
    'teacher', (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
                  FROM exam_subjects es
                  JOIN universal_subjects us ON us.id = es.subject_id
                  JOIN class_assignments ca ON ca.class_id = p_class_id
                                           AND ca.role::text = 'teacher'
                  JOIN universal_subjects u2 ON u2.id = ca.subject_id
                  JOIN profiles pf ON pf.id = ca.user_id
                 WHERE es.exam_id = e.id
                   AND (ca.subject_id = es.subject_id
                        OR initcap(lower(btrim(u2.name))) = initcap(lower(btrim(us.name))))),
    'roster', (SELECT count(*)::int FROM roster_ids),
    'appeared', (SELECT count(*)::int FROM sat),
    'absent', (SELECT count(*)::int FROM r WHERE COALESCE(r.is_absent, false)),
    'unpublished', (SELECT count(*)::int FROM r WHERE r.is_published IS NOT TRUE),
    -- Roster students with no result row at all on this paper: neither a mark,
    -- an absence nor an unpublished entry.
    'no_record', (SELECT count(*)::int FROM roster_ids ri
                   WHERE NOT EXISTS (SELECT 1 FROM r WHERE r.student_id = ri.user_id)),
    -- Left out of every average: published marks exist and every one is 0.
    'blank', (SELECT count(*) > 0 AND max(r.pct) = 0 FROM r
               WHERE r.is_published IS TRUE AND COALESCE(r.is_absent, false) = false
                 AND r.pct IS NOT NULL),
    'avg_pct', (SELECT round(avg(sat.pct), 1) FROM sat),
    'median_pct', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sat.pct)::numeric, 1) FROM sat),
    'pass_pct', (SELECT CASE WHEN count(*) > 0
                   THEN round(count(*) FILTER (WHERE sat.pct >= (SELECT v FROM pm))*100.0/count(*), 1) END
                   FROM sat),
    'top_pct', (SELECT round(max(sat.pct), 1) FROM sat),
    'class_avg_pct', (SELECT v FROM cl),
    'school_avg_pct', (SELECT v FROM sch),
    'bands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'label', b.label,
               'n', (SELECT count(*)::int FROM sat WHERE sat.pct >= b.lo AND sat.pct < b.hi))
             ORDER BY b.ord) FROM buckets b), '[]'::jsonb),
    'bottom', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', x.nm, 'pct', round(x.pct,1),
               'obtained', x.total_marks_obtained, 'max', x.total_max_marks) ORDER BY x.pct)
        FROM (SELECT * FROM sat ORDER BY sat.pct, sat.nm LIMIT 5) x), '[]'::jsonb),
    'top', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', x.nm, 'pct', round(x.pct,1),
               'obtained', x.total_marks_obtained, 'max', x.total_max_marks) ORDER BY x.pct DESC)
        FROM (SELECT * FROM sat ORDER BY sat.pct DESC, sat.nm LIMIT 5) x), '[]'::jsonb)
  ) INTO v_out
  FROM exams e WHERE e.id = p_exam_id;

  RETURN v_out;
END
$function$;

-- ------------------------------------------------ subjects, school view ----
CREATE OR REPLACE FUNCTION public.dash_school_subject_performance(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(subject_id uuid, subject_name text, school_avg numeric, results integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  WITH per_id AS MATERIALIZED (
    -- Counted results only: published, not absent, not a blank paper, held this
    -- academic year, in a class that is still active (the tree's roster rule).
    -- Summed per subject id before any text is touched.
    SELECT c.exam_subject_id AS sid, count(*) AS n, sum(c.percentage) AS s
      FROM public.dash5_counted_results(v_inst) c
      JOIN classes cl ON cl.id = c.class_id AND cl.is_active IS NOT FALSE
     WHERE c.exam_date BETWEEN v_ay_start AND v_ay_end
       AND c.exam_subject_id IS NOT NULL
     GROUP BY c.exam_subject_id
  ),
  res AS MATERIALIZED (
    -- One subject, one bar: case, spacing and punctuation folded, "&" read as
    -- "and", and the two abbreviations this platform actually holds spelled out.
    SELECT us.id AS us_id, btrim(us.name) AS raw_name, p.n, p.s,
           CASE k.base
             WHEN 'maths' THEN 'mathematics'
             WHEN 'math'  THEN 'mathematics'
             WHEN 'sst'   THEN 'socialscience'
             WHEN 'socialsciences' THEN 'socialscience'
             ELSE k.base END AS norm_name
      FROM per_id p
      JOIN universal_subjects us ON us.id = p.sid
      CROSS JOIN LATERAL (
        SELECT regexp_replace(replace(lower(btrim(us.name)), '&', 'and'), '[^a-z0-9]+', '', 'g') AS base) k
  ),
  -- The merged bar links to the id carrying the most results. It is named in full
  -- for the two abbreviations, else after the spelling carrying the most results
  -- across all its grade rows (one "Maths" row must not out-name ten
  -- "Mathematics" rows).
  pick AS (
    SELECT DISTINCT ON (res.norm_name) res.norm_name, res.us_id
      FROM res
     ORDER BY res.norm_name, res.n DESC, res.us_id
  ),
  spelt AS (
    SELECT DISTINCT ON (t.norm_name) t.norm_name,
           CASE t.norm_name WHEN 'mathematics' THEN 'Mathematics'
                            WHEN 'socialscience' THEN 'Social Science'
                            ELSE t.raw_name END AS raw_name
      FROM (SELECT res.norm_name, res.raw_name, sum(res.n) AS n
              FROM res GROUP BY res.norm_name, res.raw_name) t
     ORDER BY t.norm_name, t.n DESC, t.raw_name
  )
  SELECT pick.us_id,
         spelt.raw_name,
         round(sum(res.s) / NULLIF(sum(res.n), 0), 1),
         sum(res.n)::int
    FROM res
    JOIN pick  ON pick.norm_name  = res.norm_name
    JOIN spelt ON spelt.norm_name = res.norm_name
   GROUP BY pick.us_id, spelt.raw_name
   ORDER BY 3 ASC, 2;
END
$function$;

-- ------------------------------------------------- subjects, class view ----
CREATE OR REPLACE FUNCTION public.dash_subject_performance(p_class_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_rows jsonb; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_group uuid; v_group_label text; v_sections int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  SELECT c.class_group_id, cg.name INTO v_group, v_group_label
    FROM classes c LEFT JOIN class_groups cg ON cg.id = c.class_group_id
   WHERE c.id = p_class_id;
  SELECT count(*)::int INTO v_sections
    FROM classes c
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND (c.id = p_class_id OR (v_group IS NOT NULL AND c.class_group_id = v_group));

  WITH cr AS MATERIALIZED (
    SELECT c.class_id, c.exam_subject_id, c.subject_key, c.percentage
      FROM public.dash5_counted_results(v_inst) c
      JOIN classes cl ON cl.id = c.class_id AND cl.is_active IS NOT FALSE
     WHERE c.exam_date BETWEEN v_ay_start AND v_ay_end
  ),
  peers AS (
    -- This class and the other active sections of its class group.
    SELECT c.id
      FROM classes c
     WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
       AND (c.id = p_class_id OR (v_group IS NOT NULL AND c.class_group_id = v_group))
  ),
  pmap AS (
    -- Each (class, exam subject) pair onto the class's OWN subject: exact id
    -- first, else the same normalised name. The rule dash5_atom_rows uses, so a
    -- bar here is the number the tree shows for the same class and subject.
    -- Resolved once per distinct pair, then joined on equality.
    SELECT p.class_id, p.exam_subject_id, ms.subject_id, ms.skey
      FROM (SELECT DISTINCT cr.class_id, cr.exam_subject_id, cr.subject_key
              FROM cr JOIN peers pe ON pe.id = cr.class_id) p
      CROSS JOIN LATERAL (
        SELECT scm.subject_id, initcap(lower(btrim(u2.name))) skey
          FROM subject_class_mappings scm
          JOIN universal_subjects u2 ON u2.id = scm.subject_id
         WHERE scm.class_id = p.class_id
           AND (scm.subject_id = p.exam_subject_id
                OR initcap(lower(btrim(u2.name))) = p.subject_key)
         ORDER BY (scm.subject_id = p.exam_subject_id) DESC NULLS LAST, scm.subject_id
         LIMIT 1) ms
  ),
  mapped AS (
    SELECT cr.class_id, pm.subject_id, pm.skey, cr.percentage
      FROM cr
      JOIN pmap pm ON pm.class_id = cr.class_id
                  AND pm.exam_subject_id = cr.exam_subject_id
  ),
  school AS (
    -- School-wide, every grade: the same normalised subject name the school view
    -- of the chart groups by.
    SELECT k.norm, count(*) n, avg(cr.percentage) v
      FROM cr
      JOIN universal_subjects us ON us.id = cr.exam_subject_id
      CROSS JOIN LATERAL (
        SELECT CASE b.base WHEN 'maths' THEN 'mathematics' WHEN 'math' THEN 'mathematics'
                           WHEN 'sst' THEN 'socialscience' WHEN 'socialsciences' THEN 'socialscience'
                           ELSE b.base END norm
          FROM (SELECT regexp_replace(replace(lower(btrim(us.name)), '&', 'and'), '[^a-z0-9]+', '', 'g') base) b) k
     GROUP BY k.norm
  ),
  subj AS (
    SELECT DISTINCT us.id subject_id, us.name subject_name, initcap(lower(btrim(us.name))) skey,
           CASE b.base WHEN 'maths' THEN 'mathematics' WHEN 'math' THEN 'mathematics'
                       WHEN 'sst' THEN 'socialscience' WHEN 'socialsciences' THEN 'socialscience'
                       ELSE b.base END norm
      FROM subject_class_mappings scm
      JOIN universal_subjects us ON us.id = scm.subject_id
      CROSS JOIN LATERAL (
        SELECT regexp_replace(replace(lower(btrim(us.name)), '&', 'and'), '[^a-z0-9]+', '', 'g') base) b
     WHERE scm.class_id = p_class_id
  ),
  agg AS (
    SELECT s.subject_id, s.subject_name,
           (SELECT round(avg(m.percentage), 1) FROM mapped m
             WHERE m.class_id = p_class_id AND m.subject_id = s.subject_id) class_avg,
           (SELECT count(*)::int FROM mapped m
             WHERE m.class_id = p_class_id AND m.subject_id = s.subject_id) results,
           (SELECT round(avg(m.percentage), 1) FROM mapped m WHERE m.skey = s.skey) grade_avg,
           (SELECT count(DISTINCT m.class_id)::int FROM mapped m WHERE m.skey = s.skey) grade_sections,
           (SELECT round(sc.v, 1) FROM school sc WHERE sc.norm = s.norm) school_avg
      FROM subj s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subject_id', a.subject_id, 'subject_name', a.subject_name,
           'class_avg', a.class_avg, 'school_avg', a.school_avg,
           'grade_avg', a.grade_avg, 'grade_sections', a.grade_sections,
           'results', a.results)
           ORDER BY a.class_avg ASC, a.subject_name), '[]'::jsonb)
    INTO v_rows
    FROM agg a
   WHERE a.class_avg IS NOT NULL;

  RETURN jsonb_build_object(
    'has_data', jsonb_array_length(v_rows) > 0,
    'subjects', v_rows,
    'grade_label', v_group_label,
    'grade_sections', v_sections);
END $function$;
