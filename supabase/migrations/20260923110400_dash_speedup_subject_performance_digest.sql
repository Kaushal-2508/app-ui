-- admin_legacy: dash_school_subject_performance + dash_admin_digest (applied to prod 2026-09-23)
--
-- Loaded by: /school/command-center only (CommandCenterV5Page: Dash5SubjectPerformance
-- calls dash_school_subject_performance; InsightCards calls dash_admin_digest, which
-- calls dash_school_subject_performance again internally). The Coordinator Console
-- mounts neither; both RAISE 'not authorized' for a coordinator (unchanged).
-- dash_admin_portal_adoption is not loaded by either dashboard (its hook
-- useAdminPortalAdoption has no callers) and is left alone.
--
-- CAUSE. The planner has no statistics for the exam window
-- COALESCE(published_at::date, scheduled_date::date, created_at::date) BETWEEN ..
-- and estimated 6 exams where Alliance has 1,305 (and 77 result rows where there
-- are 19,788). On that guess it ran everything as per-row nested loops:
--   * subject performance: 20,645 index probes into final_results, 80,859 buffer
--     hits, plus initcap(lower(btrim(name))) evaluated once per RESULT row
--     (19,788 times, ~12us each on this server);
--   * digest "weakest class": ca.role::text = 'student' was estimated at 16 rows
--     of 2,459, so it probed exams (20,645x) and final_results (20,645x) again:
--     154,061 buffer hits, 230 ms.
--
-- FIX (output identical; signature, return type, grants, SECURITY DEFINER,
-- search_path, STABLE and LANGUAGE unchanged):
--   * resolve the in-scope exam ids (and, for the class query, the roster ids)
--     into arrays first, then run the heavy statement as EXECUTE .. USING joined
--     to unnest(array), so the planner sees real row counts on every call (a
--     cached generic plan would go back to guessing);
--   * sum count / sum(pct) / count(pct) per exam (per student for the class query)
--     before touching any text: avg(numeric) is exactly numeric_div(sum, N), so
--     round(sum(s) / NULLIF(sum(k), 0), 1) returns the same value and scale;
--   * normalise subject names once per subject (153 rows), not per result row.
--
-- MEASURED on prod (Alliance, school_admin, each call alone, school hours):
--   dash_school_subject_performance  385 / 522 ms  ->  65 / 44 / 51 ms
--                                    80,859 buffers -> ~1-10k buffers
--   dash_admin_digest                631 / 737 ms  ->  161 / 137 / 147 ms
--     weakest-class statement        230 ms, 154,061 buffers -> 72 ms, 1,433 buffers
--   Salci National: ssp 54-110 -> 14-27 ms; digest 118-155 -> 84-147 ms.
--   Vidyabodhini:   digest 54-81 -> 59-64 ms (planning noise at this size).
-- md5 of the full output (row order included) identical old vs new for: Alliance
-- admin; Salci National admin (default arg and explicit own institution);
-- Vidyabodhini admin (both arg forms); super admin with explicit institution;
-- an admin passing another school's id (same P0001 error); all six coordinators
-- of the three schools, and an Alliance coordinator passing Alliance explicitly
-- (same P0001 'not authorized' error). No ties at the minimum class average in
-- any tested school, so ORDER BY 2 LIMIT 1 resolves to the same class.

BEGIN;

CREATE OR REPLACE FUNCTION public.dash_school_subject_performance(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(subject_id uuid, subject_name text, school_avg numeric, results integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_exam_ids uuid[];
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  -- The graded exams in scope, resolved first. The planner has no statistics
  -- for the COALESCE(...)::date window and guessed 6 exams where Alliance has
  -- 1,305; that one guess made every join below a per-row nested loop
  -- (20,645 index probes into final_results, 80k buffer hits).
  SELECT array_agg(e.id) INTO v_exam_ids
    FROM exams e
   WHERE e.institution_id = v_inst
     AND e.status IN ('published','active','completed')
     AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
         BETWEEN v_ay_start AND v_ay_end;
  IF v_exam_ids IS NULL THEN RETURN; END IF;

  -- Dynamic, so the id list is planned as a real row count on every call; a
  -- cached generic plan would go back to guessing. Results are summed per exam
  -- and then per subject before any text is touched: avg(numeric) is exactly
  -- sum / count, so the figures are unchanged, but the name normalisation and
  -- the grouping by name now run over one row per subject, not per result.
  RETURN QUERY EXECUTE $q$
  WITH per_exam AS MATERIALIZED (
    SELECT a.exam_id,
           count(*)             AS n,
           sum(fr.percentage)   AS s,
           count(fr.percentage) AS k
      FROM unnest($1::uuid[]) AS x(exam_id)
      JOIN student_exam_attempts a ON a.exam_id = x.exam_id
      JOIN final_results fr ON fr.attempt_id = a.id
     GROUP BY a.exam_id
  ),
  res AS MATERIALIZED (
    SELECT us.id                              AS us_id,
           btrim(us.name)                     AS raw_name,
           initcap(lower(btrim(us.name)))     AS norm_name,
           t.n, t.s, t.k
      FROM (SELECT es.subject_id, sum(pe.n) AS n, sum(pe.s) AS s, sum(pe.k) AS k
              FROM per_exam pe
              JOIN exam_subjects es ON es.exam_id = pe.exam_id
             GROUP BY es.subject_id) t
      JOIN universal_subjects us ON us.id = t.subject_id
  ),
  -- The merged row still has to link somewhere, and the detail page keys on one
  -- universal_subjects id. The slice carrying the most results is the closest
  -- thing to "the" subject.
  pick AS (
    SELECT DISTINCT ON (norm_name) norm_name, us_id, raw_name
      FROM res
     ORDER BY norm_name, n DESC, us_id
  )
  SELECT pick.us_id,
         pick.raw_name,
         round(sum(res.s) / NULLIF(sum(res.k), 0), 1),
         sum(res.n)::int
    FROM res
    JOIN pick ON pick.norm_name = res.norm_name
   GROUP BY pick.us_id, pick.raw_name
   ORDER BY 3 ASC, 2
  $q$ USING v_exam_ids;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash_admin_digest(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(code text, severity text, headline text, detail text, link_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_students int; v_never int; v_active30 int;
  v_wk numeric; v_pwk numeric;
  v_subj text; v_subj_pct numeric;
  v_class text; v_class_pct numeric;
  v_unmarked int; v_classes int;
  v_low_notices int; v_notices int;
  v_exam_ids uuid[]; v_student_ids uuid[];
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  -- ---- 1. portal adoption ------------------------------------------------
  SELECT count(*),
         count(*) FILTER (WHERE u.last_sign_in_at IS NULL),
         count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')
    INTO v_students, v_never, v_active30
    FROM public.institution_student_ids(v_inst) s
    LEFT JOIN auth.users u ON u.id = s.student_id;

  IF v_students > 0 AND v_never > 0 THEN
    RETURN QUERY SELECT
      'portal_adoption',
      CASE WHEN v_never * 100.0 / v_students >= 50 THEN 'high'
           WHEN v_never * 100.0 / v_students >= 20 THEN 'medium'
           ELSE 'low' END,
      v_never || ' of ' || v_students || ' students have never signed in',
      'They cannot see homework, notices or results, so nothing else on this '
        || 'dashboard reaches them. Only ' || v_active30
        || ' signed in during the last 30 days.',
      '/school/students';
  END IF;

  -- ---- 2. weakest subject (>= 5 results, so one bad paper is not a trend) --
  SELECT subject_name, school_avg INTO v_subj, v_subj_pct
    FROM public.dash_school_subject_performance(v_inst)
   WHERE results >= 5
   ORDER BY school_avg ASC
   LIMIT 1;

  IF v_subj IS NOT NULL THEN
    RETURN QUERY SELECT
      'weakest_subject',
      CASE WHEN v_subj_pct < 50 THEN 'high'
           WHEN v_subj_pct < 65 THEN 'medium' ELSE 'low' END,
      v_subj || ' is your weakest subject school-wide at ' || v_subj_pct || '%',
      'Averaged across every graded exam this academic year.',
      '/school/analytics';
  END IF;

  -- ---- 3. weakest class ---------------------------------------------------
  -- Both sets are resolved first so the planner sees real row counts. It
  -- guessed 6 exams (the date window has no statistics) and 155 students (it
  -- cannot know one school holds most of the platform's students), and ran
  -- 20,645 probes each into exams and final_results. The exam set spans every
  -- institution, exactly as the old join to exams did; the student set is the
  -- class roster the outer join below would reach anyway.
  SELECT array_agg(e.id) INTO v_exam_ids
    FROM exams e
   WHERE e.status IN ('published','active','completed')
     AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
         BETWEEN v_ay_start AND v_ay_end;
  SELECT array_agg(DISTINCT ca.user_id) INTO v_student_ids
    FROM classes c
    JOIN class_assignments ca ON ca.class_id = c.id AND ca.role::text = 'student'
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE;

  IF v_exam_ids IS NOT NULL AND v_student_ids IS NOT NULL THEN
    -- Summed per student first; avg(numeric) is exactly sum / count, and each
    -- class_assignments row still contributes its student's results once, as
    -- the old row-level join did.
    EXECUTE $q$
      WITH ps AS MATERIALIZED (
        SELECT a.student_id,
               count(*)             AS n,
               sum(fr.percentage)   AS s,
               count(fr.percentage) AS k
          FROM unnest($3::uuid[]) AS st(id)
          JOIN student_exam_attempts a ON a.student_id = st.id
          JOIN unnest($1::uuid[]) AS ex(id) ON ex.id = a.exam_id
          JOIN final_results fr ON fr.attempt_id = a.id
         GROUP BY a.student_id
      )
      SELECT c.name || CASE WHEN coalesce(c.section,'') <> '' THEN '-' || c.section ELSE '' END,
             round(sum(ps.s) / NULLIF(sum(ps.k), 0), 1)
        FROM classes c
        JOIN class_assignments ca ON ca.class_id = c.id AND ca.role::text = 'student'
        JOIN ps ON ps.student_id = ca.user_id
       WHERE c.institution_id = $2 AND c.is_active IS NOT FALSE
       GROUP BY 1
      HAVING sum(ps.n) >= 5
       ORDER BY 2 ASC
       LIMIT 1
    $q$ INTO v_class, v_class_pct USING v_exam_ids, v_inst, v_student_ids;
  END IF;

  IF v_class IS NOT NULL AND v_class_pct < 65 THEN
    RETURN QUERY SELECT
      'weakest_class',
      CASE WHEN v_class_pct < 50 THEN 'high' ELSE 'medium' END,
      v_class || ' is your lowest-scoring class at ' || v_class_pct || '%',
      'Sitting below the 65% band across recent exams.',
      '/school/classes';
  END IF;

  -- ---- 4. attendance week over week --------------------------------------
  SELECT round(count(*) FILTER (WHERE status IN ('present','late')) * 100.0
               / NULLIF(count(*), 0), 1) INTO v_wk
    FROM attendance_records
   WHERE institution_id = v_inst AND date > v_today - 7 AND date <= v_today;
  SELECT round(count(*) FILTER (WHERE status IN ('present','late')) * 100.0
               / NULLIF(count(*), 0), 1) INTO v_pwk
    FROM attendance_records
   WHERE institution_id = v_inst AND date > v_today - 14 AND date <= v_today - 7;

  IF v_wk IS NOT NULL AND v_pwk IS NOT NULL AND abs(v_wk - v_pwk) >= 1 THEN
    RETURN QUERY SELECT
      'attendance_trend',
      CASE WHEN v_wk - v_pwk <= -3 THEN 'high'
           WHEN v_wk - v_pwk <  0  THEN 'medium' ELSE 'low' END,
      'Attendance ' || CASE WHEN v_wk > v_pwk THEN 'rose ' ELSE 'dipped ' END
        || round(abs(v_wk - v_pwk), 1) || 'pp vs last week',
      'Now ' || v_wk || '%, was ' || v_pwk || '%.',
      '/school/attendance';
  END IF;

  -- ---- 5. classes not marking attendance ---------------------------------
  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_unmarked
    FROM classes c
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND NOT EXISTS (
       SELECT 1 FROM attendance_records ar
        WHERE ar.class_id = c.id
          AND ar.date > v_today - 14 AND ar.date <= v_today);

  IF v_unmarked > 0 THEN
    RETURN QUERY SELECT
      'attendance_compliance',
      CASE WHEN v_unmarked * 100.0 / GREATEST(v_classes, 1) >= 50 THEN 'high'
           ELSE 'medium' END,
      v_unmarked || ' of ' || v_classes
        || ' classes have not marked attendance in 14 days',
      'Their attendance figures elsewhere on this page are not measuring '
        || 'anything until the register is taken.',
      '/school/attendance';
  END IF;

  -- ---- 6. notices nobody opened ------------------------------------------
  SELECT count(*), count(*) FILTER (
           WHERE n.recipient_count > 0
             AND (SELECT count(*) FROM notice_recipients r
                   WHERE r.notice_id = n.id AND r.read_at IS NOT NULL)
                 * 100.0 / n.recipient_count < 40)
    INTO v_notices, v_low_notices
    FROM notices n
   WHERE n.institution_id = v_inst
     AND n.published_at >= now() - INTERVAL '30 days';

  IF v_low_notices > 0 THEN
    RETURN QUERY SELECT
      'notice_reach',
      'medium',
      v_low_notices || ' of ' || v_notices
        || ' recent notices were read by under 40% of their audience',
      'A notice with low reach did not fail to send, it failed to land.',
      '/school/notices';
  END IF;

  RETURN;
END $function$;

COMMIT;
