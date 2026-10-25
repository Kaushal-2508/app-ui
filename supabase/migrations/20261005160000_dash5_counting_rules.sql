-- Admin dashboard accuracy pass, part 1: the shared counting rules.
-- Audit: docs/admin-dashboard-audit-2026-10-05.md. Decisions (Tushar,
-- 2026-10-05): averages use PUBLISHED marks only; a paper in which every
-- student who sat scored exactly 0 is left out (marks never entered, not a
-- result); the performance badge skips a missing input instead of scoring it
-- 0 and judges syllabus coverage against the share of the year gone.
--
-- Every dashboard average must read results through dash5_counted_results, so
-- the definition of "a result that counts" lives in exactly one place. Additive:
-- nothing calls these until the dash5_* functions are repointed.

-- 1. The academic year containing the SCHOOL's today, not the UTC one
--    (CLAUDE.md 24). Same signature, owner and grants.
CREATE OR REPLACE FUNCTION public.dash_current_academic_year(p_institution_id uuid)
RETURNS TABLE(start_date date, end_date date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ay.starts_on::date, ay.ends_on::date
    FROM cal_academic_years ay
   WHERE ay.institution_id = p_institution_id
   ORDER BY ((now() AT TIME ZONE COALESCE(
               (SELECT i.timezone FROM institutions i WHERE i.id = p_institution_id),
               'Asia/Kolkata'))::date
             BETWEEN ay.starts_on::date AND ay.ends_on::date) DESC,
            ay.is_active DESC,
            ay.starts_on::date DESC
   LIMIT 1;
$$;

-- 2. Share of the academic year gone, in percent (floor 8, ceiling 100).
--    The formula dash5_needs_by_wing already used; now one copy.
CREATE OR REPLACE FUNCTION public.dash5_year_pace(p_inst uuid)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tz text; v_today date; v_s date; v_e date;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_s, v_e FROM public.dash_current_academic_year(p_inst);
  v_s := COALESCE(v_s, v_today - INTERVAL '12 months')::date;
  v_e := COALESCE(v_e, v_today + INTERVAL '1 day')::date;
  RETURN round(LEAST(GREATEST(
    (v_today - v_s)::numeric / NULLIF((v_e - v_s)::numeric, 0), 0.08), 1.0) * 100, 1);
END;
$$;

-- 3. The results every dashboard average counts. One row per final result:
--    * the exam is published or completed, and the RESULT is published
--      (marks still awaiting publication are not counted anywhere);
--    * the student was not marked absent, and a percentage exists;
--    * the (exam, class) paper is not blank: if every counted result of that
--      paper in that class is exactly 0, the whole paper is left out (on
--      2026-10-05 these were uploads whose marks were never entered);
--    * exam_date is the day the paper was held, in school time: the scheduled
--      date when it is plausible (within 400 days of creation), else the start
--      time, else the publish time, else creation. Publish dates were used
--      before and placed late uploads in the wrong month.
--    exam_subject_id / subject_key come from exam_subjects; callers map them
--    onto a class's own subject by normalised name (universal_subjects has one
--    row per grade, so an exact id match dropped real results).
CREATE OR REPLACE FUNCTION public.dash5_counted_results(p_inst uuid)
RETURNS TABLE(result_id uuid, attempt_id uuid, exam_id uuid, class_id uuid, student_id uuid,
              exam_subject_id uuid, subject_key text, percentage numeric, exam_date date)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH tz AS (
    SELECT COALESCE((SELECT i.timezone FROM institutions i WHERE i.id = p_inst), 'Asia/Kolkata') AS z
  ),
  -- Per-exam attributes computed once per exam, not once per result: the
  -- time-zone conversion and name normalisation per result row cost ~0.6 s
  -- at Alliance.
  ex AS MATERIALIZED (
    SELECT e.id AS eid, es.subject_id AS subj, initcap(lower(btrim(us.name))) AS skey,
           (COALESCE(
              CASE WHEN e.scheduled_date BETWEEN e.created_at - INTERVAL '400 days'
                                             AND e.created_at + INTERVAL '400 days'
                   THEN e.scheduled_date END,
              e.start_time, e.published_at, e.created_at)
            AT TIME ZONE (SELECT z FROM tz))::date AS d
      FROM exams e
      LEFT JOIN exam_subjects es ON es.exam_id = e.id
      LEFT JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = p_inst
       AND e.status IN ('published', 'completed')
  ),
  r AS MATERIALIZED (
    SELECT fr.id AS rid, fr.attempt_id AS aid, a.exam_id AS eid, a.class_id AS cid,
           a.student_id AS sid, fr.percentage AS pct
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
     WHERE a.exam_id IN (SELECT DISTINCT x.eid FROM ex x)
       AND fr.is_published IS TRUE
       AND COALESCE(fr.is_absent, false) = false
       AND fr.percentage IS NOT NULL
  ),
  blank AS (
    SELECT r.eid, r.cid FROM r GROUP BY r.eid, r.cid HAVING max(r.pct) = 0
  )
  SELECT r.rid, r.aid, r.eid, r.cid, r.sid, x.subj, x.skey, r.pct, x.d
    FROM r
    JOIN ex x ON x.eid = r.eid
   WHERE NOT EXISTS (SELECT 1 FROM blank b
                      WHERE b.eid = r.eid AND b.cid IS NOT DISTINCT FROM r.cid);
$$;

-- 4. The performance composite, fair version (5 arguments; the old 4-argument
--    one stays for callers not yet moved). Each input is 0 to 100:
--      average score 45%, syllabus coverage 25%, attendance 15%, lessons 15%.
--    * A MISSING input (NULL: nothing measured) is skipped and the weights of
--      the inputs that exist are rescaled to 100%. A real 0 still counts as 0.
--    * Coverage is judged against the share of the year gone: on pace or
--      ahead scores 100, half the pace scores 50.
--    * Nothing measured at all returns NULL, which the page shows as
--      "Not assessed" (BandPill already renders a null band that way).
CREATE OR REPLACE FUNCTION public.dash5_composite(
  p_accuracy numeric, p_syllabus numeric, p_attendance numeric, p_lesson_pct numeric, p_pace numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN count(x.v) = 0 THEN NULL
              ELSE sum(x.w * x.v) / sum(x.w) FILTER (WHERE x.v IS NOT NULL) END
    FROM (VALUES
      (0.45::numeric, p_accuracy),
      (0.25::numeric, CASE WHEN p_syllabus IS NULL THEN NULL
                           WHEN p_pace IS NULL OR p_pace <= 0 THEN p_syllabus
                           ELSE LEAST(p_syllabus / p_pace, 1) * 100 END),
      (0.15::numeric, p_attendance),
      (0.15::numeric, p_lesson_pct)
    ) AS x(w, v);
$$;

-- 5. The band for a composite, NULL when nothing was measured (the old
--    dash5_band maps NULL to 'att', so an empty class read "Attention").
CREATE OR REPLACE FUNCTION public.dash5_band_or_null(p_score numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_score IS NULL THEN NULL ELSE public.dash5_band(p_score) END;
$$;

-- Internal helpers: callable only from the SECURITY DEFINER dash5_* functions.
REVOKE ALL ON FUNCTION public.dash5_year_pace(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash5_year_pace(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.dash5_year_pace(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.dash5_counted_results(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash5_counted_results(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.dash5_counted_results(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.dash5_composite(numeric, numeric, numeric, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash5_composite(numeric, numeric, numeric, numeric, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.dash5_band_or_null(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash5_band_or_null(numeric) FROM anon;
