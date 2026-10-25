-- Undo of the 2026-10-05 admin dashboard accuracy pass (dbd7231f), on Tushar's instruction
-- 2026-10-07: he asked that day to fix the dashboard's VALUES only, and the pass also changed
-- meanings and copy across the page. Every function the pass replaced goes back to the body
-- that was LIVE before it (pg_get_functiondef dumps taken by the audit session before its
-- first change, each proven to differ from what the pass wrote); the five helpers it added
-- are dropped. Two functions changed their result columns, so they are dropped and recreated
-- with their earlier grants. The migrations 20261005160000..166000 stay as the record.
-- Not undone: the proctoring client change (useProctoring.ts), on Tushar's choice.

DROP FUNCTION public.dash5_student_rows(uuid);

CREATE OR REPLACE FUNCTION public.dash5_student_rows(p_inst uuid)
 RETURNS TABLE(student_id uuid, full_name text, roll text, class_id uuid, class_label text, wing_id uuid, active7 boolean, never_in boolean, score numeric, attendance_pct numeric, homework_pct numeric, submission_pct numeric, band text, at_risk boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.dash5_student_rows(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dash5_student_rows(uuid) TO service_role;

DROP FUNCTION public.dash_recent_events(uuid,integer);

CREATE OR REPLACE FUNCTION public.dash_recent_events(p_institution_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(event_id uuid, title text, kind text, starts_on date, ends_on date, is_upcoming boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  RETURN QUERY
  SELECT e.id, e.title, e.kind, e.starts_on, e.ends_on,
         (e.starts_on >= v_today) AS is_upcoming
    FROM cal_events e
   WHERE e.institution_id = v_inst
     AND e.starts_on >= v_today - INTERVAL '30 days'
   ORDER BY (e.starts_on >= v_today) DESC,
            CASE WHEN e.starts_on >= v_today THEN e.starts_on END ASC,
            CASE WHEN e.starts_on <  v_today THEN e.starts_on END DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 6), 1), 30);
END $function$;

REVOKE ALL ON FUNCTION public.dash_recent_events(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dash_recent_events(uuid, integer) TO authenticated, service_role;

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

CREATE OR REPLACE FUNCTION public.dash_admin_roster_counts(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_students int; v_students_new int;
  v_staff int; v_classes int; v_wings int;
  v_s_present int; v_s_total int; v_s_absent int; v_s_leave int; v_classes_marked int;
  v_t_present int; v_t_total int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*) INTO v_students
    FROM public.institution_student_ids(v_inst);

  SELECT count(*) INTO v_students_new
    FROM public.institution_student_ids(v_inst) s
    JOIN public.profiles p ON p.id = s.student_id
   WHERE p.created_at >= (v_today - INTERVAL '30 days');

  SELECT count(DISTINCT p.id) INTO v_staff
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND ur.role::text IN ('teacher','coordinator','school_admin','super_school_admin','employee');

  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_wings
    FROM wings WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  -- One scan for the whole attendance headline: present, absent, on leave, the
  -- marked total, and how many classes have taken a register at all.
  SELECT count(*) FILTER (WHERE status IN ('present','late')),
         count(*),
         count(*) FILTER (WHERE status = 'absent'),
         count(*) FILTER (WHERE status = 'leave'),
         count(DISTINCT class_id)
    INTO v_s_present, v_s_total, v_s_absent, v_s_leave, v_classes_marked
    FROM attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_t_present, v_t_total
    FROM staff_attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  RETURN jsonb_build_object(
    'students', jsonb_build_object('count', v_students, 'new_30d', v_students_new),
    'staff',    jsonb_build_object('count', v_staff),
    'classes',  jsonb_build_object('count', v_classes, 'wings', v_wings,
                                   'marked_today', v_classes_marked),
    'students_present', jsonb_build_object(
       'present', v_s_present, 'total', v_s_total, 'marked', v_s_total > 0,
       'absent', v_s_absent, 'on_leave', v_s_leave,
       'pct', CASE WHEN v_s_total > 0 THEN round(v_s_present*100.0/v_s_total, 1) END),
    'staff_present', jsonb_build_object(
       'present', v_t_present, 'total', v_t_total, 'marked', v_t_total > 0,
       'pct', CASE WHEN v_t_total > 0 THEN round(v_t_present*100.0/v_t_total, 1) END)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.dash_current_academic_year(p_institution_id uuid)
 RETURNS TABLE(start_date date, end_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ay.starts_on::date, ay.ends_on::date
  FROM cal_academic_years ay
  WHERE ay.institution_id = p_institution_id
  ORDER BY (CURRENT_DATE BETWEEN ay.starts_on::date AND ay.ends_on::date) DESC,
           ay.is_active DESC,
           ay.starts_on::date DESC
  LIMIT 1;
$function$;

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

CREATE OR REPLACE FUNCTION public.dash_subject_performance(p_class_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  WITH res AS (
    SELECT a.class_id, es.subject_id, us.name AS subject_name, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
  ),
  class_avg AS (
    SELECT subject_id, subject_name, round(avg(percentage),1) AS class_avg
    FROM res WHERE class_id = p_class_id GROUP BY subject_id, subject_name
  ),
  school_avg AS (
    SELECT subject_id, round(avg(percentage),1) AS school_avg FROM res GROUP BY subject_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'subject_id', c.subject_id, 'subject_name', c.subject_name,
           'class_avg', c.class_avg, 'school_avg', s.school_avg) ORDER BY c.class_avg ASC), '[]'::jsonb)
    INTO v_rows
  FROM class_avg c LEFT JOIN school_avg s USING (subject_id);

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $function$;

CREATE OR REPLACE FUNCTION public.dash5_assign_context(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_pace numeric; v_scope text; v_label text; v_sublabel text;
  v_wing uuid; v_tid uuid; v_tname text; v_trole text; v_exact boolean := true;
  v_full text;
  v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);

  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  -- Pace is how much of the year has gone, not a hardcoded 74%. A school three
  -- weeks into the session is not "behind" for having covered a fifth of the
  -- book, and a fixed line would tell it that it is.
  v_pace := round(LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0) * 100, 1);

  v_wing := p_wing_id;
  IF v_wing IS NULL AND p_class_id IS NOT NULL THEN
    SELECT m.wing_id INTO v_wing FROM wing_class_mappings m WHERE m.class_id = p_class_id LIMIT 1;
  END IF;

  /* ---- scope + label ---- */
  -- Everything this function emits is plain ASCII on purpose. Prod SQL is
  -- applied through scripts/run-sql.ps1, and PowerShell 5.1 mangles non-ASCII
  -- in a request body, so a middot baked into a label here reaches the database
  -- as mojibake. The drawer composes its own separator on the client.
  IF p_class_id IS NOT NULL AND p_subject_id IS NOT NULL THEN
    v_scope := 'subject';
    SELECT us.name, c.name || COALESCE(' ' || NULLIF(c.section,''), '')
      INTO v_label, v_sublabel
      FROM classes c, universal_subjects us
     WHERE c.id = p_class_id AND us.id = p_subject_id;
  ELSIF p_class_id IS NOT NULL THEN
    v_scope := 'class';
    SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '') INTO v_label
      FROM classes c WHERE c.id = p_class_id;
  ELSIF v_wing IS NOT NULL THEN
    v_scope := 'wing';
    SELECT w.name INTO v_label FROM wings w WHERE w.id = v_wing;
  ELSE
    v_scope := 'school';
    SELECT i.name INTO v_label FROM institutions i WHERE i.id = v_inst;
  END IF;

  -- What a task title calls this scope. A subject on its own reads as
  -- "Bring Painting back to the pace line", which is true of no particular
  -- class; the class has to be in the sentence.
  v_full := v_label || COALESCE(' in ' || v_sublabel, '');

  /* ---- owner, narrowest first, falling back rather than failing ---- */
  IF v_scope = 'subject' THEN
    SELECT ca.user_id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.class_id = p_class_id AND ca.subject_id = p_subject_id
       AND ca.role::text = 'teacher' AND pf.is_active IS NOT FALSE
     ORDER BY pf.full_name LIMIT 1;
    v_trole := 'Subject teacher';
  END IF;

  IF v_tid IS NULL AND p_class_id IS NOT NULL THEN
    IF v_scope = 'subject' THEN v_exact := false; END IF;
    SELECT ca.user_id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.class_id = p_class_id AND ca.subject_id IS NULL
       AND ca.role::text = 'teacher' AND pf.is_active IS NOT FALSE
     ORDER BY pf.full_name LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'Class teacher'; END IF;
  END IF;

  IF v_tid IS NULL AND v_wing IS NOT NULL THEN
    IF v_scope <> 'wing' THEN v_exact := false; END IF;
    SELECT wa.user_id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM wing_assignments wa
      JOIN profiles pf ON pf.id = wa.user_id
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
     WHERE wa.wing_id = v_wing AND pf.is_active IS NOT FALSE
     ORDER BY pf.full_name LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'Wing coordinator'; END IF;
  END IF;

  IF v_tid IS NULL THEN
    v_exact := false;
    SELECT pf.id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM profiles pf
      JOIN user_roles ur ON ur.user_id = pf.id
     WHERE pf.institution_id = v_inst AND pf.is_active IS NOT FALSE
       AND ur.role::text IN ('school_admin','super_school_admin')
     ORDER BY pf.full_name LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'School admin'; END IF;
  END IF;

  /* ---- the figures the ask has to stand on ---- */
  WITH a AS MATERIALIZED (
    SELECT x.* FROM public.dash5_atom_rows(v_inst) x
     WHERE (v_wing IS NULL OR p_class_id IS NOT NULL OR x.wing_id = v_wing)
       AND (p_class_id IS NULL OR x.class_id = p_class_id)
       AND (p_subject_id IS NULL OR x.subject_id = p_subject_id)
  ),
  g AS (
    SELECT count(*)::int pairs,
           count(*) FILTER (WHERE a.papers = 0)::int pairs_no_paper,
           COALESCE(sum(a.chapters),0)::int chapters,
           COALESCE(sum(a.chapters_done),0)::int chapters_done,
           COALESCE(sum(a.chapters_partial),0)::int chapters_partial,
           COALESCE(sum(a.lessons_taught),0)::int lt,
           COALESCE(sum(a.lessons_planned),0)::int lp,
           COALESCE(sum(a.papers),0)::int papers,
           COALESCE(sum(a.pending_grading),0)::int pending,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) acc_num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) acc_den,
           COALESCE(sum(a.hw_slots),0)::int hw_slots,
           COALESCE(sum(a.hw_submitted),0)::int hw_done
      FROM a
  ),
  -- Attendance and the head count are per-CLASS figures, so they are summed
  -- over distinct classes rather than over atoms: a class with nine subjects
  -- would otherwise weigh nine times as much as a class with one. Summing
  -- DISTINCT students would be worse still, since two classes of thirty would
  -- collapse to thirty.
  k AS (
    SELECT COALESCE(sum(p.att_present),0)::numeric present,
           COALESCE(sum(p.att_total),0)::numeric total,
           COALESCE(sum(p.students),0)::int students,
           count(*)::int classes
      FROM (SELECT DISTINCT a.class_id, a.students, a.att_present, a.att_total FROM a) p
  ),
  m AS (
    SELECT g.*, k.students, k.classes,
           CASE WHEN g.chapters > 0
                THEN round((g.chapters_done*2 + g.chapters_partial)*100.0/(g.chapters*2),1) END cov,
           CASE WHEN g.acc_den > 0 THEN round(g.acc_num/g.acc_den,1) END acc,
           CASE WHEN g.hw_slots > 0 THEN round(g.hw_done*100.0/g.hw_slots,1) END hw,
           CASE WHEN k.total > 0 THEN round(k.present*100.0/k.total,1) END att
      FROM g, k
  )
  SELECT jsonb_build_object(
    'scope', v_scope,
    'label', v_label,
    'sublabel', v_sublabel,
    'full_label', v_full,
    'pace_pct', v_pace,
    'target', jsonb_build_object(
      'id', v_tid, 'name', v_tname, 'role', v_trole, 'exact', v_exact),
    'stats', jsonb_build_array(
      jsonb_build_object('label', 'Average score', 'value', m.acc, 'unit', '%'),
      jsonb_build_object('label', 'Coverage',      'value', m.cov, 'unit', '%'),
      jsonb_build_object('label', 'Attendance',    'value', m.att, 'unit', '%')),
    'facts', jsonb_build_object(
      'pairs', m.pairs, 'pairs_no_paper', m.pairs_no_paper,
      'chapters', m.chapters, 'chapters_done', m.chapters_done,
      'chapters_partial', m.chapters_partial,
      'lessons_taught', m.lt, 'lessons_planned', m.lp,
      'papers', m.papers, 'pending_grading', m.pending,
      'homework_pct', m.hw, 'students', m.students, 'classes', m.classes,
      'coverage_pct', m.cov, 'accuracy_pct', m.acc, 'attendance_pct', m.att),

    -- Suggestions are written against THESE figures, so a wing that is on pace
    -- is not offered a catch-up task it does not need. Every one of them is
    -- suppressed when the condition behind it is absent.
    'suggestions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'title', s.title, 'detail', s.detail, 'priority', s.priority,
               'task_type', s.ttype, 'due_days', s.due_days) ORDER BY s.priority, s.title), '[]'::jsonb)
        FROM (
          SELECT 1 priority, 'academic_content'::task_type ttype, 7 due_days,
                 'Bring ' || v_full || ' back to the ' || v_pace || '% pace line' title,
                 'Coverage is ' || m.cov || '%, which is ' || round(v_pace - m.cov, 1)
                   || ' points behind where the year has got to. '
                   || (m.chapters - m.chapters_done - m.chapters_partial)
                   || ' chapters have not been started.' detail
           WHERE m.cov IS NOT NULL AND m.cov < v_pace - 3

          UNION ALL
          SELECT 2, 'academic_content'::task_type, 10,
                 'Finish the ' || m.chapters_partial || ' partly-done chapter'
                   || CASE WHEN m.chapters_partial = 1 THEN '' ELSE 's' END || ' in ' || v_label,
                 'A partly-done chapter counts as half a finished one, so closing these is the cheapest coverage available.'
           WHERE m.chapters_partial > 0

          UNION ALL
          SELECT 1, 'exam_related'::task_type, 5,
                 'Conduct a first paper in ' || m.pairs_no_paper || ' subject'
                   || CASE WHEN m.pairs_no_paper = 1 THEN '' ELSE 's' END,
                 m.pairs_no_paper || ' of ' || m.pairs || ' subject-class pairs have had no paper this year, so they are unmeasured in every score on the dashboard.'
           WHERE m.pairs_no_paper > 0

          UNION ALL
          SELECT 2, 'exam_related'::task_type, 4,
                 'Publish results for ' || m.pending || ' paper'
                   || CASE WHEN m.pending = 1 THEN '' ELSE 's' END,
                 'Marks are entered but not published, so students and parents cannot see them and the averages here do not count them.'
           WHERE m.pending > 0

          UNION ALL
          SELECT 1, 'student_support'::task_type, 5,
                 'Attendance plan for ' || v_full,
                 'Attendance is ' || m.att || '%, below the 75% floor board eligibility needs.'
           WHERE m.att IS NOT NULL AND m.att < 75

          UNION ALL
          SELECT 2, 'academic_content'::task_type, 7,
                 'Raise homework submission in ' || v_full,
                 'Submission is running at ' || m.hw || '% of what has been set.'
           WHERE m.hw IS NOT NULL AND m.hw < 60

          UNION ALL
          SELECT 1, 'academic_content'::task_type, 7,
                 'Remedial plan for ' || v_full,
                 'The average score is ' || m.acc || '%, which is below the 50% line.'
           WHERE m.acc IS NOT NULL AND m.acc < 50
        ) s)
  ) INTO v_out FROM m;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_atom_rows(p_inst uuid)
 RETURNS TABLE(class_id uuid, subject_id uuid, subject_key text, wing_id uuid, class_group_id uuid, students integer, chapters integer, chapters_done integer, chapters_partial integer, lessons_planned integer, lessons_taught integer, papers integer, wk_done integer, wk_planned integer, pending_grading integer, attempts integer, acc numeric, hw_slots integer, hw_submitted integer, att_present integer, att_total integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text; v_today date; v_monday date; v_ay_start date; v_ay_end date;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_today  := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  v_monday := v_today - (extract(isodow FROM v_today)::int - 1);
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(p_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  WITH cls AS (
    SELECT c.id, c.class_group_id, m.wing_id
      FROM classes c
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE c.institution_id = p_inst AND c.is_active IS NOT FALSE
  ),
  prs AS (
    SELECT DISTINCT scm.class_id, scm.subject_id, cl.class_group_id, cl.wing_id
      FROM subject_class_mappings scm
      JOIN cls cl ON cl.id = scm.class_id
     WHERE scm.institution_id = p_inst
  ),
  roster AS (
    -- The one definition of a student. Never hand-count class_assignments.
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
      JOIN cls cl ON cl.id = ca.class_id
     WHERE ca.role::text = 'student'
       AND ca.user_id IN (SELECT s.student_id FROM public.institution_student_ids(p_inst) s)
     GROUP BY 1
  ),
  cg_subj AS (SELECT DISTINCT p.class_group_id, p.subject_id FROM prs p WHERE p.class_group_id IS NOT NULL),
  -- Chapter denominator, the rule dash_syllabus_coverage_build already uses:
  -- class-group mapped chapters when the subject has any, else every active
  -- chapter of the subject (institution-scoped or global).
  chapset AS (
    SELECT cs.class_group_id, cs.subject_id, st.id AS chapter_id
      FROM cg_subj cs
      JOIN syllabus_topics st
        ON st.is_active AND st.subject_id = cs.subject_id
       AND (st.institution_id IS NULL OR st.institution_id = p_inst)
       AND ( EXISTS (SELECT 1 FROM topic_class_mappings tcm
                      WHERE tcm.class_group_id = cs.class_group_id AND tcm.topic_id = st.id)
             OR NOT EXISTS (
               SELECT 1 FROM topic_class_mappings t2
                 JOIN syllabus_topics s2 ON s2.id = t2.topic_id
                WHERE t2.class_group_id = cs.class_group_id AND s2.is_active
                  AND s2.subject_id = cs.subject_id
                  AND (s2.institution_id IS NULL OR s2.institution_id = p_inst)) )
  ),
  chaptot AS (SELECT c.class_group_id, c.subject_id, count(*)::int total FROM chapset c GROUP BY 1,2),
  prog AS (
    SELECT e.class_id, e.subject_id, e.topic_id,
           bool_or(e.action = 'completed') done,
           bool_or(e.action = 'partial')   part
      FROM syllabus_progress_events e
     WHERE e.institution_id = p_inst
     GROUP BY 1,2,3
  ),
  chapstate AS (
    SELECT p.class_id, p.subject_id,
           count(*) FILTER (WHERE pr.done)::int done,
           count(*) FILTER (WHERE pr.part AND NOT pr.done)::int part
      FROM prs p
      JOIN chapset cs ON cs.class_group_id = p.class_group_id AND cs.subject_id = p.subject_id
      LEFT JOIN prog pr ON pr.class_id = p.class_id AND pr.subject_id = p.subject_id
                       AND pr.topic_id = cs.chapter_id
     GROUP BY 1,2
  ),
  lessons AS (
    SELECT lp.class_id, lp.subject_id,
           count(*)::int planned,
           count(*) FILTER (WHERE lp.status = 'done')::int taught
      FROM tt_lesson_plans lp
     WHERE lp.institution_id = p_inst AND lp.session_type = 'teaching'
     GROUP BY 1,2
  ),
  ex AS (
    SELECT ec.class_id, es.subject_id, e.id exam_id, e.status,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) d,
           e.scheduled_date::date sd
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = p_inst
  ),
  papers AS (
    SELECT x.class_id, x.subject_id,
           count(DISTINCT x.exam_id) FILTER (
             WHERE x.status IN ('published','completed') AND x.d BETWEEN v_ay_start AND v_ay_end)::int papers,
           count(DISTINCT x.exam_id) FILTER (
             WHERE x.status IN ('published','completed') AND x.d BETWEEN v_monday AND v_today)::int wk_done,
           -- Held, plus the ones the calendar promised and the class did not
           -- sit. NOT "scheduled this week": most papers here carry no
           -- scheduled_date at all, so that denominator produced 14 held out of
           -- 5 planned. The skipped ones are the number worth acting on.
           (count(DISTINCT x.exam_id) FILTER (
              WHERE x.status IN ('published','completed') AND x.d BETWEEN v_monday AND v_today)
            + count(DISTINCT x.exam_id) FILTER (
              WHERE x.sd BETWEEN v_monday AND v_today
                AND x.status NOT IN ('published','completed')))::int wk_planned
      FROM ex x
     GROUP BY 1,2
  ),
  -- Pending grading is not a status in this schema. A paper is outstanding
  -- while any of its results is still unpublished, which is what is owed.
  pend AS (
    SELECT a.class_id, es.subject_id, count(DISTINCT e.id)::int pending
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = p_inst AND fr.is_published IS NOT TRUE
     GROUP BY 1,2
  ),
  scores AS (
    -- Absent sitters are excluded: a zero for not turning up measures the
    -- register, not the teaching. The reference counts absentees separately.
    SELECT a.class_id, es.subject_id, count(*)::int attempts, avg(fr.percentage) acc
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = p_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
       AND COALESCE(fr.is_absent, false) = false
     GROUP BY 1,2
  ),
  hw AS (
    SELECT hc.class_id, hs.subject_id,
           count(DISTINCT h.id)::int assigned,
           count(DISTINCT sub.id)::int submitted
      FROM homework_assignments h
      JOIN homework_assignment_classes  hc ON hc.homework_assignment_id = h.id
      JOIN homework_assignment_subjects hs ON hs.homework_assignment_id = h.id
      LEFT JOIN homework_submissions sub ON sub.homework_assignment_id = h.id
     WHERE h.institution_id = p_inst
     GROUP BY 1,2
  ),
  att AS (
    SELECT ar.class_id,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::int present,
           count(*)::int total
      FROM attendance_records ar
     WHERE ar.institution_id = p_inst AND ar.date BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  )
  SELECT p.class_id, p.subject_id, initcap(lower(btrim(us0.name))), p.wing_id, p.class_group_id,
         COALESCE(r.n, 0),
         COALESCE(ct.total, 0), COALESCE(cs2.done, 0), COALESCE(cs2.part, 0),
         COALESCE(l.planned, 0), COALESCE(l.taught, 0),
         COALESCE(pp.papers, 0), COALESCE(pp.wk_done, 0), COALESCE(pp.wk_planned, 0),
         COALESCE(pd.pending, 0),
         COALESCE(sc.attempts, 0), sc.acc,
         COALESCE(h.assigned, 0) * COALESCE(r.n, 0), COALESCE(h.submitted, 0),
         a2.present, a2.total
    FROM prs p
    JOIN universal_subjects us0 ON us0.id = p.subject_id
    LEFT JOIN roster    r   ON r.class_id = p.class_id
    LEFT JOIN chaptot   ct  ON ct.class_group_id = p.class_group_id AND ct.subject_id = p.subject_id
    LEFT JOIN chapstate cs2 ON cs2.class_id = p.class_id AND cs2.subject_id = p.subject_id
    LEFT JOIN lessons   l   ON l.class_id = p.class_id AND l.subject_id = p.subject_id
    LEFT JOIN papers    pp  ON pp.class_id = p.class_id AND pp.subject_id = p.subject_id
    LEFT JOIN pend      pd  ON pd.class_id = p.class_id AND pd.subject_id = p.subject_id
    LEFT JOIN scores    sc  ON sc.class_id = p.class_id AND sc.subject_id = p.subject_id
    LEFT JOIN hw        h   ON h.class_id = p.class_id AND h.subject_id = p.subject_id
    LEFT JOIN att       a2  ON a2.class_id = p.class_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_attendance_by_wing(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

  WITH d AS (
    -- Days the school actually took a register. Calendar days would draw
    -- Sundays and holidays as a collapse to zero.
    SELECT DISTINCT ar.date FROM attendance_records ar
     WHERE ar.institution_id = v_inst
       AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings wm
             WHERE wm.class_id = ar.class_id AND wm.wing_id = v_wing))
     ORDER BY ar.date DESC LIMIT v_n
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
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', d.date,
        'student_pct',   CASE WHEN k.students > 0 THEN round(s.present*100.0/k.students, 1) END,
        'staff_pct',     CASE WHEN k.teachers > 0 THEN round(i.present*100.0/k.teachers, 1) END,
        -- *_total is the ROLL. *_present and *_marked are what the card needs
        -- to say why a day is low: 465 present of 1545 on the roll, but only
        -- 485 marked, is a register that was never taken.
        'student_total',   COALESCE(k.students, 0),
        'student_present', COALESCE(s.present, 0),
        'student_marked',  COALESCE(s.marked, 0),
        'staff_total',     COALESCE(k.teachers, 0),
        'staff_present',   COALESCE(i.present, 0),
        'staff_marked',    COALESCE(i.marked, 0)
      ) ORDER BY d.date)
      FROM d
      LEFT JOIN stu  s ON s.date = d.date
      LEFT JOIN ins  i ON i.date = d.date
      LEFT JOIN roll k ON k.date = d.date), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_band_classes(p_band text, p_wing_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
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
     WHERE (p_wing_id IS NULL OR x.wing_id = p_wing_id)
  ),
  b(band, ord) AS (VALUES ('att',1), ('watch',2), ('good',3), ('exc',4))
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM s),
    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) ORDER BY w.name)
        FROM wings w
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb),
    'bands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'band', b.band,
               'n', (SELECT count(*)::int FROM s WHERE s.band = b.band),
               'pct', CASE WHEN (SELECT count(*) FROM s) > 0
                           THEN round((SELECT count(*) FROM s WHERE s.band = b.band)
                                      * 100.0 / (SELECT count(*) FROM s), 0) END,
               'by_wing', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                           'wing_id', w.id, 'wing_name', w.name,
                           'n', (SELECT count(*)::int FROM s
                                  WHERE s.band = b.band AND s.wing_id = w.id))
                         ORDER BY w.name)
                    FROM wings w
                   WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb))
             ORDER BY b.ord)
        FROM b), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

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

CREATE OR REPLACE FUNCTION public.dash5_communication(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  WITH n AS (
    SELECT nt.* FROM notices nt
     WHERE nt.institution_id = v_inst
       AND COALESCE(nt.published_at::date, nt.created_at::date) BETWEEN v_ay_start AND v_ay_end
  ),
  -- Opened and acknowledged are real columns on notice_recipients, so the
  -- reference's "Acknowledged" bar is answerable here after all; only the push
  -- channel is not.
  nr AS (
    SELECT count(*)::int total,
           count(*) FILTER (WHERE r.read_at IS NOT NULL)::int opened,
           count(*) FILTER (WHERE r.acknowledged_at IS NOT NULL)::int acked,
           count(*) FILTER (WHERE nq.requires_acknowledgement)::int ack_due
      FROM notice_recipients r JOIN n nq ON nq.id = r.notice_id
  ),
  p AS (
    SELECT ps.*,
           -- Slots offered: the window divided by the slot length. Without this
           -- denominator "146 booked" says nothing about whether the meeting
           -- filled up.
           CASE WHEN ps.start_time IS NOT NULL AND ps.end_time IS NOT NULL
                     AND COALESCE(ps.slot_duration_minutes, 0) > 0
                THEN GREATEST(floor(EXTRACT(EPOCH FROM (ps.end_time - ps.start_time)) / 60
                                    / ps.slot_duration_minutes)::int, 0) END slots
      FROM ptm_schedules ps
     WHERE ps.institution_id = v_inst
       AND ps.scheduled_date BETWEEN v_today AND v_today + 30
  ),
  bk AS (
    SELECT b.ptm_id, count(*)::int n,
           count(*) FILTER (WHERE b.feedback IS NOT NULL OR b.rating IS NOT NULL)::int fed
      FROM ptm_bookings b JOIN p ON p.id = b.ptm_id
     GROUP BY 1
  ),
  bt AS (
    SELECT COALESCE(sum(bk.n), 0)::int booked, COALESCE(sum(bk.fed), 0)::int fed FROM bk
  ),
  pt AS (SELECT COALESCE(sum(p.slots), 0)::int slots, count(*)::int meetings FROM p)
  SELECT jsonb_build_object(
    'channels_live', false,
    'circulars', jsonb_build_object(
      'total', (SELECT count(*)::int FROM n),
      'requiring_ack', (SELECT count(*)::int FROM n WHERE n.requires_acknowledgement),
      'recipients', (SELECT COALESCE(sum(n.recipient_count), 0)::int FROM n),
      'reached', (SELECT total FROM nr),
      'opened', (SELECT opened FROM nr),
      'acknowledged', (SELECT acked FROM nr),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'type', r.type::text,
                 'published_at', COALESCE(r.published_at, r.created_at),
                 'recipients', r.recipient_count,
                 'opened', (SELECT count(*)::int FROM notice_recipients x
                             WHERE x.notice_id = r.id AND x.read_at IS NOT NULL),
                 'requires_ack', r.requires_acknowledgement)
               ORDER BY COALESCE(r.published_at, r.created_at) DESC)
          FROM (SELECT * FROM n
                 ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT 6) r), '[]'::jsonb)),
    'ptm', jsonb_build_object(
      'total', (SELECT meetings FROM pt),
      'slots', (SELECT slots FROM pt),
      'bookings', (SELECT booked FROM bt),
      'feedback', (SELECT fed FROM bt),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'date', r.scheduled_date,
                 'status', r.status::text, 'slots', r.slots,
                 'bookings', COALESCE((SELECT bk.n FROM bk WHERE bk.ptm_id = r.id), 0))
               ORDER BY r.scheduled_date)
          FROM (SELECT * FROM p ORDER BY p.scheduled_date LIMIT 6) r), '[]'::jsonb)),

    -- `unit` tells the card whether a bar is a rate to draw against 100 or a
    -- count to scale against its neighbours. Mixing the two silently is how a
    -- 4-count bar ends up looking longer than an 88% one.
    'reach', jsonb_build_array(
      jsonb_build_object('label', 'Circulars published', 'unit', 'count',
                         'value', (SELECT count(*)::int FROM n)),
      jsonb_build_object('label', 'People the circulars reached', 'unit', 'count',
                         'value', (SELECT total FROM nr)),
      jsonb_build_object('label', 'Opened', 'unit', 'pct',
                         'value', (SELECT CASE WHEN total > 0
                                     THEN round(opened*100.0/total, 1) END FROM nr),
                         'of', (SELECT total FROM nr)),
      jsonb_build_object('label', 'Acknowledged', 'unit', 'pct',
                         'value', (SELECT CASE WHEN ack_due > 0
                                     THEN round(acked*100.0/ack_due, 1) END FROM nr),
                         'of', (SELECT ack_due FROM nr)),
      jsonb_build_object('label', 'Meetings in the next 30 days', 'unit', 'count',
                         'value', (SELECT meetings FROM pt)),
      jsonb_build_object('label', 'PTM slots booked', 'unit', 'pct',
                         'value', (SELECT CASE WHEN pt.slots > 0
                                     THEN round(bt.booked*100.0/pt.slots, 1) END
                                     FROM pt, bt),
                         'of', (SELECT slots FROM pt),
                         'n', (SELECT booked FROM bt)),
      jsonb_build_object('label', 'PTM feedback left', 'unit', 'pct',
                         'value', (SELECT CASE WHEN booked > 0
                                     THEN round(fed*100.0/booked, 1) END FROM bt),
                         'of', (SELECT booked FROM bt)))
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

  -- ev is estimated at ~5 rows (the COALESCE date range has no statistics, so
  -- the planner applies its 0.5% default) when it is really ~1,600. The old
  -- body joined a separately aggregated "sc" back to ev and to "rost" on that
  -- estimate, which became nested loops: 1.47M join-filter comparisons plus
  -- the roster aggregate re-run once per paper (loops=931). Here the score
  -- aggregate is a LATERAL per ev row (index lookups on idx_sea_exam_class and
  -- the final_results attempt_id index, the right plan at any row count) and
  -- the roster is materialized once.
  WITH ev AS MATERIALIZED (
    SELECT e.id exam_id, e.title, e.exam_type::text cycle,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) d,
           ec.class_id, es.subject_id,
           CASE WHEN e.is_results_only THEN 'Marks only'
                WHEN e.is_offline THEN 'Offline' ELSE 'Online' END mode,
           e.total_marks,
           -- How many ev rows share this (exam, class). The old sc joined every
           -- one of them to the attempts, so each result was counted k times
           -- (k > 1 when a class sits in two wings or an exam has two subjects).
           -- Kept so "appeared" is unchanged.
           count(*) OVER (PARTITION BY e.id, ec.class_id)::int k
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN classes c ON c.id = ec.class_id AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ec.class_id
      LEFT JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_from AND v_to
       AND (p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR ec.class_id = p_class_id)
  ),
  rost AS MATERIALIZED (
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
     WHERE ca.role::text = 'student'
       AND ca.user_id IN (SELECT z.student_id FROM public.institution_student_ids(v_inst) z)
     GROUP BY 1
  ),
  rows_all AS (
    SELECT DISTINCT ON (ev.exam_id, ev.class_id, ev.subject_id)
           ev.exam_id, ev.title, ev.cycle, ev.d, ev.class_id, ev.subject_id, ev.mode, ev.total_marks,
           c.name || COALESCE(' ' || NULLIF(c.section,''), '') class_label,
           us.name subject_name,
           sc.appeared, sc.avg_pct, sc.pass_pct, sc.top_pct,
           COALESCE(rost.n, 0) roster,
           (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
              FROM class_assignments ca
              JOIN profiles pf ON pf.id = ca.user_id
             WHERE ca.class_id = ev.class_id AND ca.subject_id = ev.subject_id
               AND ca.role::text = 'teacher') teacher
      FROM ev
      JOIN classes c ON c.id = ev.class_id
      LEFT JOIN universal_subjects us ON us.id = ev.subject_id
      CROSS JOIN LATERAL (
        SELECT count(*)::int appeared,
               round(avg(fr.percentage), 1) avg_pct,
               round(count(*) FILTER (WHERE fr.percentage >= 35)*100.0/NULLIF(count(*),0), 1) pass_pct,
               round(max(fr.percentage), 1) top_pct
          FROM student_exam_attempts a
          JOIN final_results fr ON fr.attempt_id = a.id
          CROSS JOIN generate_series(1, ev.k) kk
         WHERE a.exam_id = ev.exam_id AND a.class_id = ev.class_id
           AND COALESCE(fr.is_absent, false) = false
      ) sc
      LEFT JOIN rost ON rost.class_id = ev.class_id
     WHERE sc.avg_pct IS NOT NULL
  )
  SELECT jsonb_build_object(
    'from', v_from, 'to', v_to,
    'total', (SELECT count(*)::int FROM rows_all),
    'count', (SELECT count(*)::int FROM (SELECT 1 FROM rows_all LIMIT v_lim) z),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'exam_id', r.exam_id, 'title', r.title, 'cycle', r.cycle, 'date', r.d,
               'class_id', r.class_id, 'class_label', r.class_label,
               'subject_id', r.subject_id, 'subject_name', r.subject_name,
               'teacher', r.teacher,
               'avg_pct', r.avg_pct, 'pass_pct', r.pass_pct, 'top_pct', r.top_pct,
               'appeared', r.appeared, 'roster', r.roster,
               'mode', r.mode, 'total_marks', r.total_marks,
               'band', public.dash5_band(r.avg_pct)) ORDER BY r.d DESC, r.class_label)
        FROM (SELECT * FROM rows_all ORDER BY d DESC, class_label LIMIT v_lim) r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_exam_pipeline(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_gone numeric; v_out jsonb; v_key text;
  v_atom_end date;
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
  -- The paper window dash5_atom_rows counts "papers" in. Its end defaults to
  -- today, NOT today + 1 like this function's pace window below.
  v_atom_end := COALESCE(v_ay_end, v_today)::date;
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  v_gone := LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0);

  SELECT initcap(lower(btrim(us.name))) INTO v_key
    FROM universal_subjects us WHERE us.id = p_subject_id;

  -- This used to read dash5_atom_rows(v_inst) and keep two of its 21 columns
  -- (papers, pending_grading). That call computes every atom column for every
  -- class-subject pair of the school (chapters, lessons, homework, attendance,
  -- scores) and was ~90% of this function's time. The three pieces it needs
  -- are reproduced below with the atom's definitions: the pair set (prs,
  -- joined to universal_subjects), "papers" and "pend". KEEP IN STEP with
  -- dash5_atom_rows: if its prs / papers / pend change, change them here too.
  WITH prs AS MATERIALIZED (
    SELECT DISTINCT scm.class_id, scm.subject_id, cl.class_group_id, cl.wing_id,
           initcap(lower(btrim(us0.name))) subject_key
      FROM subject_class_mappings scm
      JOIN (SELECT c.id, c.class_group_id, m.wing_id
              FROM classes c
              LEFT JOIN wing_class_mappings m ON m.class_id = c.id
             WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE) cl
        ON cl.id = scm.class_id
      JOIN universal_subjects us0 ON us0.id = scm.subject_id
     WHERE scm.institution_id = v_inst
  ),
  a0 AS MATERIALIZED (
    SELECT p.class_id, p.subject_id
      FROM prs p
     WHERE (p_wing_id IS NULL OR p.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR p.class_id = p_class_id)
       AND (v_key IS NULL OR p.subject_key = v_key)
  ),
  -- pp is the atom's "papers" over the whole school. The date window stays
  -- inside FILTER, as in the atom, so the exams scan is estimated from
  -- institution_id alone.
  pp AS MATERIALIZED (
    SELECT ec.class_id, es.subject_id,
           count(DISTINCT e.id) FILTER (
             WHERE e.status IN ('published','completed')
               AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                   BETWEEN v_ay_start AND v_atom_end)::int papers
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = v_inst
     GROUP BY 1,2
  ),
  -- pd is the atom's "pend": exams with a result still unpublished, per
  -- (attempt class, subject). It starts from the unpublished results (about
  -- 14% of final_results) rather than from the school's attempts: reached
  -- from the attempt side, a cached generic plan (what a pooled connection
  -- runs after five calls) probes final_results once per attempt, 20.6K
  -- probes and ~90ms on Alliance. open_res has no parameters, so its plan
  -- never changes. It is platform-wide, but the unpublished backlog is small;
  -- see the partial-index note in the migration header if it grows.
  open_res AS MATERIALIZED (
    SELECT DISTINCT a.exam_id, a.class_id
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
     WHERE fr.is_published IS NOT TRUE
  ),
  pd AS MATERIALIZED (
    SELECT o.class_id, es.subject_id, count(DISTINCT e.id)::int pending
      FROM open_res o
      JOIN exams e ON e.id = o.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = v_inst
     GROUP BY 1,2
  ),
  per_pair AS (
    SELECT x.papers, x.pending_grading,
           CASE WHEN x.papers > 0
                THEN GREATEST(round(x.papers / v_gone)::int, x.papers)
                ELSE 1 END planned
      FROM (SELECT COALESCE(pp.papers, 0) papers, COALESCE(pd.pending, 0) pending_grading
              FROM a0
              LEFT JOIN pp ON pp.class_id = a0.class_id AND pp.subject_id = a0.subject_id
              LEFT JOIN pd ON pd.class_id = a0.class_id AND pd.subject_id = a0.subject_id) x
  ),
  agg AS (
    SELECT COALESCE(sum(papers), 0)::int held,
           COALESCE(sum(planned), 0)::int planned,
           COALESCE(sum(pending_grading), 0)::int pending,
           count(*) FILTER (WHERE papers = 0)::int pairs_with_none,
           count(*)::int pairs
      FROM per_pair
  ),
  -- Every exam in scope, one row per exam, classified by where it sits. The
  -- DISTINCT matters: an exam covering four classes would otherwise be counted
  -- four times against a plan that counts it once. Only the three statuses
  -- split counts are read; published and completed papers (~92% of Alliance's
  -- exams) are filtered out up front instead of being joined and dropped.
  ex AS (
    SELECT DISTINCT e.id, e.status::text st
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN classes c ON c.id = ec.class_id AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ec.class_id
      LEFT JOIN exam_subjects es ON es.exam_id = e.id
      LEFT JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = v_inst
       AND e.status::text IN ('draft','ready','active')
       AND (p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR ec.class_id = p_class_id)
       AND (v_key IS NULL OR initcap(lower(btrim(us.name))) = v_key)
  ),
  split AS (
    SELECT count(*) FILTER (WHERE ex.st = 'draft')::int in_draft,
           -- "ready" and "active" are written and dated but not yet sat.
           count(*) FILTER (WHERE ex.st IN ('ready','active'))::int on_calendar
      FROM ex
  )
  SELECT jsonb_build_object(
    'year_elapsed_pct', round(v_gone * 100, 1),
    'held', g.held, 'planned', g.planned,
    'remaining', GREATEST(g.planned - g.held, 0),
    'pending_publication', g.pending,
    'pairs', g.pairs, 'pairs_with_no_paper', g.pairs_with_none,
    'on_pace', CASE WHEN g.planned > 0 THEN round(g.held * 100.0 / g.planned, 1) END,

    -- The four-way split the reference draws. results_out is a subtraction
    -- rather than its own count because "held" and "pending" come from the same
    -- atom and must add back up to it exactly.
    'held_results_out', GREATEST(g.held - g.pending, 0),
    'held_results_pending', LEAST(g.pending, g.held),
    'on_calendar', sp.on_calendar,
    'in_draft', sp.in_draft,
    -- What is left once everything above is accounted for: papers the pace
    -- implies that nobody has written yet, even as a draft.
    'not_written', GREATEST(g.planned - g.held - sp.on_calendar - sp.in_draft, 0),

    -- Kept for callers written against the previous shape.
    'drafted', sp.in_draft,
    'unscheduled', GREATEST(g.planned - g.held - sp.in_draft, 0)
  ) INTO v_out
  FROM agg g, split sp;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_needs_by_wing(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb; v_pace numeric; v_wing uuid;
  v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  v_wing := public.dash5_caller_wing(v_inst);

  -- Pace is the share of the year gone, not a fixed 74%. Every other card on
  -- this page already works that way; this one was the last holdout, and a
  -- school three weeks into the session was being told its classes were behind.
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;
  v_pace := round(LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0) * 100, 1);

  WITH a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  s AS MATERIALIZED (SELECT * FROM public.dash5_student_rows(v_inst)),
  cls AS (
    SELECT a.class_id, a.wing_id,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done, sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*) FILTER (WHERE a.papers = 0)::int no_paper,
           sum(a.pending_grading)::int pending,
           max(a.students)::int students
      FROM a GROUP BY 1,2
  ),
  per_wing AS (
    SELECT w.id wing_id, w.name wing_name,
           count(*) FILTER (WHERE c.ch > 0
             AND (c.done*2 + c.part)*100.0/(c.ch*2) < v_pace)::int behind,
           count(*) FILTER (WHERE c.den > 0 AND c.num/c.den < 70)::int weak,
           COALESCE(sum(c.no_paper), 0)::int no_paper,
           COALESCE(sum(c.pending), 0)::int pending,
           count(c.class_id)::int classes,
           COALESCE(sum(c.students), 0)::int students,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id AND s.never_in) never_in,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id
              AND COALESCE(s.attendance_pct, 100) < 75) chronic,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id AND s.at_risk) at_risk,
           (SELECT wa.user_id FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = w.id ORDER BY pf.full_name LIMIT 1) coord_id,
           (SELECT COALESCE(pf.full_name, pf.email) FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = w.id ORDER BY pf.full_name LIMIT 1) coord_name
      FROM wings w
      LEFT JOIN cls c ON c.wing_id = w.id
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
     GROUP BY w.id, w.name
  ),
  items AS (
    -- `cta` is the words on the link, `goto` is where it lands. They were the
    -- same field before, so every row read "Open" whatever it was about.
    SELECT p.wing_id, p.wing_name, i.sev, i.n,
           i.n || ' ' || i.title AS title, i.detail, i.cta, i.goto
      FROM per_wing p
      CROSS JOIN LATERAL (VALUES
        ('High',   p.behind,   'classes behind the pace line',
                   'Coverage is the leading indicator: a class behind now is a class revising in the exam week.',
                   'Open syllabus', 'academics'),
        ('High',   p.weak,     'classes averaging below 70%',
                   'Sustained across more than one cycle this is a teaching-support question, not a student-effort one.',
                   'Open performance', 'overview'),
        ('High',   p.chronic,  'students below the 75% attendance floor',
                   'Board eligibility risk.',
                   'Open absentees', 'attendance'),
        ('Medium', p.no_paper, 'subject-class pairs with no paper this year',
                   'Nothing to grade means nothing to measure. These are invisible in every score above.',
                   'Open exams', 'academics'),
        ('Medium', p.never_in, 'students have never signed in',
                   'Nothing they do is measured until they do.',
                   'Open adoption', 'students'),
        ('Medium', p.at_risk,  'students flagged as needing attention',
                   'Failing marks or heavy absence.',
                   'Open the list', 'students'),
        ('Medium', p.pending,  'papers written but not yet published',
                   'Results cannot reach parents until these close.',
                   'Open exams', 'academics')
      ) AS i(sev, n, title, detail, cta, goto)
     WHERE i.n > 0
  ),
  wing_json AS (
    SELECT p.*,
           (SELECT count(*)::int FROM items i WHERE i.wing_id = p.wing_id) cnt,
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
    'wings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'wing_id', w.wing_id, 'wing_name', w.wing_name,
        'coordinator_id', w.coord_id, 'coordinator', w.coord_name,
        'classes', w.classes, 'students', w.students,
        'high', (SELECT count(*)::int FROM items i
                  WHERE i.wing_id = w.wing_id AND i.sev = 'High'),
        'count', w.cnt, 'items', w.items) ORDER BY w.cnt DESC, w.wing_name)
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
  w AS (
    SELECT wg.id, wg.name,
           (SELECT count(*)::int FROM s WHERE s.wing_id = wg.id) students,
           (SELECT count(*)::int FROM n WHERE n.wing_id = wg.id) never_in,
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
  f AS (SELECT * FROM n WHERE p_wing_id IS NULL OR n.wing_id = p_wing_id)
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM n),
    'students', (SELECT count(*)::int FROM s),
    'filtered_total', (SELECT count(*)::int FROM f),
    'count', (SELECT count(*)::int FROM (SELECT 1 FROM f LIMIT v_lim) z),
    'unmapped', (SELECT count(*)::int FROM n WHERE n.wing_id IS NULL),
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

CREATE OR REPLACE FUNCTION public.dash5_paper_detail(p_exam_id uuid, p_class_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, true);
  IF NOT EXISTS (SELECT 1 FROM exams WHERE id = p_exam_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: exam not in institution';
  END IF;

  WITH r AS (
    SELECT a.student_id, fr.percentage pct, fr.is_absent,
           fr.total_marks_obtained, fr.total_max_marks, fr.is_published,
           COALESCE(pf.full_name, pf.email) nm
      FROM student_exam_attempts a
      JOIN final_results fr ON fr.attempt_id = a.id
      JOIN profiles pf ON pf.id = a.student_id
     WHERE a.exam_id = p_exam_id
       AND (p_class_id IS NULL OR a.class_id = p_class_id)
  ),
  sat AS (SELECT * FROM r WHERE COALESCE(r.is_absent, false) = false AND r.pct IS NOT NULL),
  roster AS (
    SELECT count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
     WHERE ca.role::text = 'student'
       AND (p_class_id IS NULL OR ca.class_id = p_class_id)
       AND ca.user_id IN (SELECT z.student_id FROM public.institution_student_ids(v_inst) z)
  ),
  -- The two baselines. A paper's 42% means nothing on its own; against a class
  -- that averages 64% and a school that averages 58% it means something.
  atoms AS MATERIALIZED (SELECT x.* FROM public.dash5_atom_rows(v_inst) x),
  cl AS (
    SELECT CASE WHEN sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL) > 0
                THEN round(sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL)
                         / sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL), 1) END v
      FROM atoms a WHERE p_class_id IS NULL OR a.class_id = p_class_id
  ),
  sch AS (
    SELECT CASE WHEN sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL) > 0
                THEN round(sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL)
                         / sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL), 1) END v
      FROM atoms a
  ),
  buckets(lo, hi, label, ord) AS (
    VALUES (80::numeric, 1000::numeric, '80% and above', 1),
           (65, 80, '65 to 79%', 2), (50, 65, '50 to 64%', 3),
           (35, 50, '35 to 49%', 4), (-1, 35, 'Below 35%', 5)
  )
  SELECT jsonb_build_object(
    'exam_id', e.id,
    'title', e.title,
    'date', COALESCE(e.scheduled_date::date, e.published_at::date, e.created_at::date),
    'status', e.status::text,
    'mode', CASE WHEN e.is_results_only THEN 'Marks only'
                 WHEN e.is_offline THEN 'Offline' ELSE 'Online' END,
    'exam_type', e.exam_type::text,
    'total_marks', e.total_marks,
    'pass_marks', e.pass_marks,
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'subjects', COALESCE((SELECT string_agg(DISTINCT us.name, ', ')
                            FROM exam_subjects es
                            JOIN universal_subjects us ON us.id = es.subject_id
                           WHERE es.exam_id = e.id), null),
    'teacher', (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
                  FROM exam_subjects es
                  JOIN class_assignments ca ON ca.subject_id = es.subject_id
                                           AND ca.class_id = p_class_id
                                           AND ca.role::text = 'teacher'
                  JOIN profiles pf ON pf.id = ca.user_id
                 WHERE es.exam_id = e.id),
    'roster', (SELECT n FROM roster),
    'appeared', (SELECT count(*)::int FROM sat),
    'absent', (SELECT count(*)::int FROM r WHERE COALESCE(r.is_absent, false)),
    'unpublished', (SELECT count(*)::int FROM r WHERE r.is_published IS NOT TRUE),
    'avg_pct', (SELECT round(avg(sat.pct), 1) FROM sat),
    'median_pct', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sat.pct)::numeric, 1) FROM sat),
    'pass_pct', (SELECT CASE WHEN count(*) > 0
                   THEN round(count(*) FILTER (WHERE sat.pct >= 35)*100.0/count(*), 1) END FROM sat),
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
        FROM (SELECT * FROM sat ORDER BY sat.pct LIMIT 5) x), '[]'::jsonb),
    'top', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', x.nm, 'pct', round(x.pct,1),
               'obtained', x.total_marks_obtained, 'max', x.total_max_marks) ORDER BY x.pct DESC)
        FROM (SELECT * FROM sat ORDER BY sat.pct DESC LIMIT 5) x), '[]'::jsonb)
  ) INTO v_out
  FROM exams e WHERE e.id = p_exam_id;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_report_core(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_name text; v_out jsonb;
  v_ay_start date; v_ay_end date; v_year text;
  v_pipe jsonb; v_teach jsonb; v_att_days int;
  c_att_days constant int := 100;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  SELECT name, COALESCE(timezone, 'Asia/Kolkata') INTO v_name, v_tz
    FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_year := CASE
    WHEN v_ay_start IS NULL THEN 'Academic year'
    ELSE 'Academic Year ' || to_char(v_ay_start, 'YYYY') || ' to '
         || to_char(COALESCE(v_ay_end, v_ay_start + INTERVAL '1 year'), 'YYYY')
  END;

  -- School days the register was actually taken on, which is what the
  -- attendance footnote claims to be counting.
  SELECT count(DISTINCT ar.date)::int INTO v_att_days
    FROM attendance_records ar
   WHERE ar.institution_id = v_inst AND ar.date > v_today - c_att_days;

  v_pipe  := public.dash5_exam_pipeline(NULL, NULL, NULL, v_inst);
  v_teach := public.dash5_teacher_activity(NULL, v_inst);

  WITH
  a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  -- Roster size and attendance are CLASS facts (dash5_tree says the same);
  -- summing them per atom would multiply them by the subject count.
  pc AS (SELECT DISTINCT x.class_id, x.wing_id, x.students, x.att_present, x.att_total FROM a x),
  -- Class teacher: a class_assignments row with NO subject, as every other
  -- dash5 function resolves it.
  ct AS (
    SELECT ca.class_id, string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ') nm
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.subject_id IS NULL AND ca.role::text = 'teacher'
       AND pf.is_active IS NOT FALSE
     GROUP BY 1
  ),
  wagg AS (
    SELECT x.wing_id,
           count(*)::int subject_pairs, count(DISTINCT x.subject_key)::int subject_count,
           sum(x.chapters)::int chapters, sum(x.chapters_done)::int chapters_done,
           sum(x.chapters_partial)::int chapters_partial,
           sum(x.lessons_planned)::int lessons_planned, sum(x.lessons_taught)::int lessons_taught,
           sum(x.papers)::int papers, sum(x.wk_done)::int wk_done, sum(x.wk_planned)::int wk_planned,
           sum(x.attempts)::int attempts,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den,
           sum(x.hw_slots)::int hw_slots, sum(x.hw_submitted)::int hw_submitted
      FROM a x GROUP BY x.wing_id
  ),
  wros AS (
    SELECT p.wing_id, count(*)::int class_count, sum(p.students)::int students,
           sum(p.att_present)::int att_present, sum(p.att_total)::int att_total
      FROM pc p GROUP BY p.wing_id
  ),
  cagg AS (
    SELECT x.class_id,
           sum(x.chapters)::int chapters, sum(x.chapters_done)::int chapters_done,
           sum(x.chapters_partial)::int chapters_partial,
           sum(x.papers)::int papers,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den
      FROM a x GROUP BY x.class_id
  ),
  -- One row per distinct subject, the same weighting the tree uses elsewhere.
  sagg AS (
    SELECT x.subject_key, max(s.name) nm,
           count(DISTINCT x.class_id)::int classes,
           sum(x.papers)::int papers, sum(x.attempts)::int attempts,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den,
           sum(x.chapters)::int chapters, sum(x.chapters_done)::int chapters_done,
           sum(x.chapters_partial)::int chapters_partial
      FROM a x LEFT JOIN subjects s ON s.id = x.subject_id
     GROUP BY x.subject_key
  ),
  sch AS (
    SELECT (SELECT COALESCE(sum(p.students), 0)::int FROM pc p) students,
           (SELECT count(*)::int FROM pc p) class_count,
           (SELECT COALESCE(sum(p.att_present), 0)::int FROM pc p) att_present,
           (SELECT COALESCE(sum(p.att_total), 0)::int FROM pc p) att_total,
           count(*)::int subject_pairs, count(DISTINCT x.subject_key)::int subject_count,
           COALESCE(sum(x.chapters), 0)::int chapters,
           COALESCE(sum(x.chapters_done), 0)::int chapters_done,
           COALESCE(sum(x.chapters_partial), 0)::int chapters_partial,
           COALESCE(sum(x.lessons_planned), 0)::int lessons_planned,
           COALESCE(sum(x.lessons_taught), 0)::int lessons_taught,
           COALESCE(sum(x.papers), 0)::int papers,
           COALESCE(sum(x.wk_done), 0)::int wk_done,
           COALESCE(sum(x.wk_planned), 0)::int wk_planned,
           COALESCE(sum(x.attempts), 0)::int attempts,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den,
           COALESCE(sum(x.hw_slots), 0)::int hw_slots,
           COALESCE(sum(x.hw_submitted), 0)::int hw_submitted,
           count(*) FILTER (WHERE x.papers = 0)::int pairs_no_paper
      FROM a x
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'school', v_name, 'year', v_year,
      'asOf', to_char(v_today, 'DD Mon YYYY'),
      'yearGone', (v_pipe ->> 'year_elapsed_pct')::numeric,
      'attDays', COALESCE(v_att_days, 0)),

    'school', (
      SELECT jsonb_build_object(
        'students', s.students, 'classCount', s.class_count,
        'subjectPairs', s.subject_pairs, 'subjectCount', s.subject_count,
        'pairsNoPaper', s.pairs_no_paper,
        'attendance', CASE WHEN s.att_total > 0 THEN round(s.att_present * 100.0 / s.att_total, 1) END,
        'syllabus', CASE WHEN s.chapters > 0
          THEN round((s.chapters_done * 2 + s.chapters_partial) * 100.0 / (s.chapters * 2), 1) END,
        'lessonsTaught', s.lessons_taught, 'lessonsPlanned', s.lessons_planned,
        'lessonPct', CASE WHEN s.lessons_planned > 0
          THEN round(s.lessons_taught * 100.0 / s.lessons_planned, 1) END,
        'papers', s.papers,
        'papersPlanned',   COALESCE((v_pipe ->> 'planned')::int, 0),
        'papersPublished', COALESCE((v_pipe ->> 'held_results_out')::int, 0),
        'pendingGrading',  COALESCE((v_pipe ->> 'held_results_pending')::int, 0),
        'papersScheduled', COALESCE((v_pipe ->> 'on_calendar')::int, 0),
        'papersDraft',     COALESCE((v_pipe ->> 'in_draft')::int, 0),
        'wkDone', s.wk_done, 'wkPlanned', s.wk_planned,
        'accuracy', CASE WHEN s.acc_den > 0 THEN round(s.acc_num / s.acc_den, 1) END,
        'attempts', s.attempts,
        'homework', CASE WHEN s.hw_slots > 0 THEN round(s.hw_submitted * 100.0 / s.hw_slots, 1) END,
        'chapters', s.chapters, 'chaptersDone', s.chapters_done,
        'chaptersPartial', s.chapters_partial,
        'band', public.dash5_band(CASE WHEN s.acc_den > 0 THEN round(s.acc_num / s.acc_den, 1) END)
      ) FROM sch s),

    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wg.id, 'name', wg.name,
        -- The sub-line under a wing name: the school's own description when
        -- it set one, otherwise the range of classes mapped to the wing.
        'span', COALESCE(NULLIF(btrim(wg.description), ''), (
          SELECT CASE WHEN min(c2.name) = max(c2.name) THEN min(c2.name)
                      ELSE min(c2.name) || ' to ' || max(c2.name) END
            FROM wing_class_mappings m2
            JOIN classes c2 ON c2.id = m2.class_id
           WHERE m2.wing_id = wg.id), ''),
        'head', COALESCE((
          SELECT string_agg(COALESCE(pf.full_name, pf.email), ', ')
            FROM wing_assignments wa
            JOIN profiles pf ON pf.id = wa.user_id
            JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
           WHERE wa.wing_id = wg.id AND pf.is_active IS NOT FALSE), 'No coordinator assigned'),
        'students', COALESCE(k.students, 0), 'classCount', COALESCE(k.class_count, 0),
        'subjectPairs', COALESCE(g.subject_pairs, 0), 'subjectCount', COALESCE(g.subject_count, 0),
        'attendance', CASE WHEN k.att_total > 0 THEN round(k.att_present * 100.0 / k.att_total, 1) END,
        'syllabus', CASE WHEN g.chapters > 0
          THEN round((g.chapters_done * 2 + g.chapters_partial) * 100.0 / (g.chapters * 2), 1) END,
        'lessonsTaught', COALESCE(g.lessons_taught, 0),
        'lessonsPlanned', COALESCE(g.lessons_planned, 0),
        'lessonPct', CASE WHEN g.lessons_planned > 0
          THEN round(g.lessons_taught * 100.0 / g.lessons_planned, 1) END,
        'papers', COALESCE(g.papers, 0),
        'papersPlanned',   COALESCE((wp.p ->> 'planned')::int, 0),
        'papersPublished', COALESCE((wp.p ->> 'held_results_out')::int, 0),
        'pendingGrading',  COALESCE((wp.p ->> 'held_results_pending')::int, 0),
        'papersScheduled', COALESCE((wp.p ->> 'on_calendar')::int, 0),
        'papersDraft',     COALESCE((wp.p ->> 'in_draft')::int, 0),
        'wkDone', COALESCE(g.wk_done, 0), 'wkPlanned', COALESCE(g.wk_planned, 0),
        'accuracy', CASE WHEN g.acc_den > 0 THEN round(g.acc_num / g.acc_den, 1) END,
        'attempts', COALESCE(g.attempts, 0),
        'homework', CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted * 100.0 / g.hw_slots, 1) END,
        'chapters', COALESCE(g.chapters, 0), 'chaptersDone', COALESCE(g.chapters_done, 0),
        'chaptersPartial', COALESCE(g.chapters_partial, 0),
        'band', public.dash5_band(CASE WHEN g.acc_den > 0 THEN round(g.acc_num / g.acc_den, 1) END),
        'classes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', c.id,
            'code', c.name || COALESCE(' ' || NULLIF(c.section, ''), ''),
            'teacherName', COALESCE(ct.nm, 'No class teacher'),
            'students', COALESCE(p.students, 0),
            'attendance', CASE WHEN p.att_total > 0
              THEN round(p.att_present * 100.0 / p.att_total, 1) END,
            'syllabus', CASE WHEN cg.chapters > 0
              THEN round((cg.chapters_done * 2 + cg.chapters_partial) * 100.0 / (cg.chapters * 2), 1) END,
            'chapters', COALESCE(cg.chapters, 0), 'chaptersDone', COALESCE(cg.chapters_done, 0),
            'chaptersPartial', COALESCE(cg.chapters_partial, 0),
            'papers', COALESCE(cg.papers, 0),
            'accuracy', CASE WHEN cg.acc_den > 0 THEN round(cg.acc_num / cg.acc_den, 1) END,
            'band', public.dash5_band(CASE WHEN cg.acc_den > 0 THEN round(cg.acc_num / cg.acc_den, 1) END))
            ORDER BY c.name, c.section)
            FROM pc p
            JOIN classes c ON c.id = p.class_id
            LEFT JOIN cagg cg ON cg.class_id = p.class_id
            LEFT JOIN ct ON ct.class_id = p.class_id
           WHERE p.wing_id = wg.id), '[]'::jsonb))
        ORDER BY wg.display_order NULLS LAST, wg.name)
        FROM wings wg
        LEFT JOIN wagg g ON g.wing_id = wg.id
        LEFT JOIN wros k ON k.wing_id = wg.id
        LEFT JOIN LATERAL (SELECT public.dash5_exam_pipeline(wg.id, NULL, NULL, v_inst) p) wp ON true
       WHERE wg.institution_id = v_inst AND wg.is_active IS NOT FALSE), '[]'::jsonb),

    'subjRollup', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', COALESCE(g.nm, initcap(g.subject_key)),
        'attempts', g.attempts, 'papers', g.papers, 'classes', g.classes,
        'acc', CASE WHEN g.acc_den > 0 THEN round(g.acc_num / g.acc_den, 1) END,
        'cov', CASE WHEN g.chapters > 0
          THEN round((g.chapters_done * 2 + g.chapters_partial) * 100.0 / (g.chapters * 2), 1) END)
        ORDER BY COALESCE(g.nm, g.subject_key))
        FROM sagg g), '[]'::jsonb),

    'teachers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', e ->> 'name', 'wingId', e ->> 'wing_id',
        'classes', COALESCE((e ->> 'classes')::int, 0),
        'subjects', COALESCE(e ->> 'subject_names', ''),
        'tests', COALESCE((e ->> 'tests')::int, 0),
        'hwGiven', COALESCE((e ->> 'homework_given')::int, 0),
        'lessons', COALESCE((e ->> 'lessons')::int, 0),
        'avgScore', (e ->> 'avg_score')::numeric,
        'lastSeen', (e ->> 'last_seen_days')::int,
        'level', e ->> 'level'))
        FROM jsonb_array_elements(COALESCE(v_teach -> 'rows', '[]'::jsonb)) e), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_school_wide_needs(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_proc int; v_proc_high int; v_issues int; v_issue_days int;
  v_leave int; v_leave_days int; v_staff_leave int; v_unpub int;
  v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*)::int, COALESCE(sum(ps.high_severity_events), 0)::int
    INTO v_proc, v_proc_high
    FROM proctoring_sessions ps
    JOIN student_exam_attempts a ON a.id = ps.attempt_id
    JOIN exams e ON e.id = a.exam_id
   WHERE e.institution_id = v_inst
     AND ps.requires_review IS TRUE
     AND COALESCE(ps.review_status, 'pending') = 'pending';

  SELECT count(*)::int,
         COALESCE(max((v_today - ri.created_at::date)), 0)::int
    INTO v_issues, v_issue_days
    FROM reported_issues ri
   WHERE ri.institution_id = v_inst
     AND ri.status::text NOT IN ('resolved', 'closed');

  SELECT count(*)::int, COALESCE(max((v_today - lr.created_at::date)), 0)::int
    INTO v_leave, v_leave_days
    FROM leave_requests lr
   WHERE lr.institution_id = v_inst AND lr.status::text = 'pending';

  SELECT count(*)::int INTO v_staff_leave
    FROM staff_leave_requests sl
   WHERE sl.institution_id = v_inst AND sl.status::text = 'pending';

  SELECT count(DISTINCT e.id)::int INTO v_unpub
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
   WHERE e.institution_id = v_inst AND fr.is_published IS NOT TRUE;

  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'severity', x.sev, 'title', x.t, 'detail', x.s,
               'cta', x.cta, 'goto', x.go) ORDER BY x.ord)
        FROM (
          SELECT 1 ord, 'High' sev,
                 v_proc || ' proctoring session' || CASE WHEN v_proc = 1 THEN '' ELSE 's' END
                   || ' flagged for review' t,
                 CASE WHEN v_proc_high > 0
                      THEN v_proc_high || ' high-severity events across them, such as tab switches or a second face in frame.'
                      ELSE 'Flagged by the proctor but not yet looked at.' END s,
                 'Review' cta, 'sec-academics' go
           WHERE v_proc > 0

          UNION ALL
          SELECT 2, CASE WHEN v_unpub > 6 THEN 'High' ELSE 'Medium' END,
                 v_unpub || ' paper' || CASE WHEN v_unpub = 1 THEN '' ELSE 's' END
                   || ' marked but not published',
                 'Students and parents cannot see these marks, and no report counts them.',
                 'Publish', 'sec-academics'
           WHERE v_unpub > 0

          UNION ALL
          SELECT 3, 'Medium',
                 v_issues || ' open platform issue' || CASE WHEN v_issues = 1 THEN '' ELSE 's' END,
                 CASE WHEN v_issue_days > 0
                      THEN 'Raised from inside the school. Oldest open ' || v_issue_days || ' days.'
                      ELSE 'Raised from inside the school, all opened today.' END,
                 'Triage', 'sec-needs'
           WHERE v_issues > 0

          UNION ALL
          SELECT 4, 'Medium',
                 v_leave || ' student leave request'
                   || CASE WHEN v_leave = 1 THEN '' ELSE 's' END || ' awaiting a decision',
                 CASE WHEN v_leave_days > 0
                      THEN 'Oldest submitted ' || v_leave_days || ' days ago. Until they are decided the register counts these students absent.'
                      ELSE 'All submitted today.' END,
                 'Approve', 'sec-attendance'
           WHERE v_leave > 0

          UNION ALL
          SELECT 5, 'Medium',
                 v_staff_leave || ' staff leave request'
                   || CASE WHEN v_staff_leave = 1 THEN '' ELSE 's' END || ' awaiting a decision',
                 'Each one approved without a substitution leaves a class unattended.',
                 'Approve', 'sec-teachers'
           WHERE v_staff_leave > 0
        ) x), '[]'::jsonb),
    'counts', jsonb_build_object(
      'proctoring', v_proc, 'issues', v_issues, 'student_leave', v_leave,
      'staff_leave', v_staff_leave, 'unpublished_papers', v_unpub)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

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
    SELECT DISTINCT ON (s.student_id) s.student_id, m.wing_id
      FROM public.institution_student_ids(p_inst) s
      JOIN class_assignments ca ON ca.user_id = s.student_id AND ca.role::text = 'student'
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_inst AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     ORDER BY s.student_id, c.name
  ),
  att AS (
    SELECT ar.student_id,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::numeric p,
           count(*)::numeric n
      FROM attendance_records ar
     WHERE ar.institution_id = p_inst AND ar.date BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  )
  SELECT b.wing_id,
         count(*) FILTER (WHERE u.last_sign_in_at IS NULL)::int,
         count(*) FILTER (WHERE a.n > 0 AND a.p * 100.0 / a.n < 75)::int,
         count(*)::int
    FROM base b
    LEFT JOIN auth.users u ON u.id = b.student_id
    LEFT JOIN att a ON a.student_id = b.student_id
   GROUP BY b.wing_id;
END
$function$;

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

CREATE OR REPLACE FUNCTION public.dash5_subject_chapters(p_class_id uuid, p_subject_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_cg uuid; v_rows jsonb; v_stats jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, true);
  SELECT c.class_group_id INTO v_cg FROM classes c
   WHERE c.id = p_class_id AND c.institution_id = v_inst;
  IF NOT FOUND THEN RAISE EXCEPTION 'dash5: class not in institution'; END IF;

  WITH chapset AS (
    SELECT st.id, st.topic_name, st.chapter_number, st.display_order
      FROM syllabus_topics st
     WHERE st.is_active AND st.subject_id = p_subject_id
       AND (st.institution_id IS NULL OR st.institution_id = v_inst)
       AND ( EXISTS (SELECT 1 FROM topic_class_mappings tcm
                      WHERE tcm.class_group_id = v_cg AND tcm.topic_id = st.id)
             OR NOT EXISTS (
               SELECT 1 FROM topic_class_mappings t2
                 JOIN syllabus_topics s2 ON s2.id = t2.topic_id
                WHERE t2.class_group_id = v_cg AND s2.is_active AND s2.subject_id = p_subject_id
                  AND (s2.institution_id IS NULL OR s2.institution_id = v_inst)) )
  ),
  prog AS (
    SELECT e.topic_id,
           bool_or(e.action = 'completed') done,
           bool_or(e.action = 'partial')   part,
           max(e.date) last_on
      FROM syllabus_progress_events e
     WHERE e.institution_id = v_inst AND e.class_id = p_class_id AND e.subject_id = p_subject_id
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'topic_id', c.id, 'name', c.topic_name, 'chapter_number', c.chapter_number,
           'state', CASE WHEN p.done THEN 'done' WHEN p.part THEN 'partial' ELSE 'none' END,
           'last_logged_on', p.last_on
         ) ORDER BY COALESCE(c.display_order, 9999), c.chapter_number NULLS LAST, c.topic_name), '[]'::jsonb)
    INTO v_rows
    FROM chapset c LEFT JOIN prog p ON p.topic_id = c.id;

  -- The figures the drawer needs beside the chapter list: this subject's own
  -- performance, and the class it sits in, so the note can say "N points below
  -- the class" instead of leaving the reader to work it out.
  WITH a AS MATERIALIZED (
    SELECT x.* FROM public.dash5_atom_rows(v_inst) x WHERE x.class_id = p_class_id
  ),
  me AS (SELECT * FROM a WHERE a.subject_id = p_subject_id),
  cl AS (
    SELECT sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*)::int pairs,
           count(*) FILTER (WHERE a.papers > 0)::int assessed
      FROM a
  )
  SELECT jsonb_build_object(
    'accuracy', (SELECT round(me.acc, 1) FROM me),
    'attempts', (SELECT me.attempts FROM me),
    'papers', (SELECT me.papers FROM me),
    'students', (SELECT me.students FROM me),
    'lessons_taught', (SELECT me.lessons_taught FROM me),
    'lessons_planned', (SELECT me.lessons_planned FROM me),
    'homework_pct', (SELECT CASE WHEN me.hw_slots > 0
                        THEN round(me.hw_submitted*100.0/me.hw_slots, 1) END FROM me),
    'pending_grading', (SELECT me.pending_grading FROM me),
    'class_accuracy', (SELECT CASE WHEN cl.den > 0 THEN round(cl.num/cl.den, 1) END FROM cl),
    'class_subjects', (SELECT cl.pairs FROM cl),
    'class_subjects_assessed', (SELECT cl.assessed FROM cl),
    'teacher', (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
                  FROM class_assignments ca
                  JOIN profiles pf ON pf.id = ca.user_id
                 WHERE ca.class_id = p_class_id AND ca.subject_id = p_subject_id
                   AND ca.role::text = 'teacher')
  ) INTO v_stats;

  RETURN jsonb_build_object(
    'class_id', p_class_id, 'subject_id', p_subject_id,
    'subject_name', (SELECT us.name FROM universal_subjects us WHERE us.id = p_subject_id),
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'stats', v_stats,
    'chapters', v_rows);
END
$function$;

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

  -- universal_subjects holds one row per subject PER GRADE, so matching on the
  -- id alone would miss papers filed against a sibling row of the same subject.
  SELECT initcap(lower(btrim(us.name))) INTO v_key
    FROM universal_subjects us WHERE us.id = p_subject_id;

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x WHERE x.class_id = p_class_id
  ),
  marks AS (
    SELECT a.student_id, round(avg(fr.percentage), 1) pct, count(*)::int papers
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
      JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
       AND COALESCE(fr.is_absent, false) = false
       AND initcap(lower(btrim(us.name))) = v_key
       AND a.student_id IN (SELECT s.student_id FROM s)
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

CREATE OR REPLACE FUNCTION public.dash5_task_suggestions(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb; v_pace numeric := 74;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  sc AS MATERIALIZED (SELECT * FROM public.dash5_student_counts(v_inst)),
  cls AS (
    SELECT a.class_id, a.wing_id,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done, sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*) FILTER (WHERE a.papers = 0)::int no_paper,
           sum(a.pending_grading)::int pending
      FROM a GROUP BY 1,2
  ),
  labelled AS (
    SELECT c.*, cl.name || COALESCE(' ' || NULLIF(cl.section,''), '') label,
           CASE WHEN c.den > 0 THEN c.num/c.den END acc,
           CASE WHEN c.ch > 0 THEN (c.done*2+c.part)*100.0/(c.ch*2) END cov
      FROM cls c JOIN classes cl ON cl.id = c.class_id
  ),
  raw AS (
    (SELECT 'weakest_class' code, 1 priority, 'academic_content'::task_type ttype, 3 due_days,
            'Remedial plan for ' || l.label title,
            round(l.acc)::text || '% average, ' || round(COALESCE(l.cov,0))::text
              || '% syllabus coverage. Lowest in the school.' detail,
            public.resolve_flag_assignee(v_inst, 'class', l.class_id::text) assignee
       FROM labelled l WHERE l.acc IS NOT NULL ORDER BY l.acc LIMIT 1)

    UNION ALL
    SELECT 'pace_' || w.id::text, 1, 'academic_content'::task_type, 7,
           'Bring ' || n.cnt || ' class' || CASE WHEN n.cnt = 1 THEN '' ELSE 'es' END
             || ' in ' || w.name || ' back to the ' || v_pace || '% pace line',
           'Coverage is the leading indicator: a class behind now is a class revising in the exam week.',
           COALESCE((SELECT wa.user_id FROM wing_assignments wa WHERE wa.wing_id = w.id LIMIT 1),
                    public.resolve_flag_assignee(v_inst, 'institution', v_inst::text))
      FROM wings w
      JOIN LATERAL (SELECT count(*)::int cnt FROM labelled l
                     WHERE l.wing_id = w.id AND l.cov IS NOT NULL AND l.cov < v_pace) n ON true
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE AND n.cnt > 0

    UNION ALL
    SELECT 'no_paper', 2, 'exam_related'::task_type, 5,
           'Schedule papers for ' || x.n || ' subject-class pairs with nothing set',
           'They are excluded from every average on the dashboard, so the school figure rests on '
             || 'thinner evidence than it looks.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(no_paper)::int n FROM cls) x WHERE x.n > 0

    UNION ALL
    SELECT 'pending_results', 2, 'exam_related'::task_type, 4,
           'Publish results for ' || x.n || ' papers already written',
           'Parents and students cannot be told anything until these close.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(pending)::int n FROM cls) x WHERE x.n > 0

    UNION ALL
    SELECT 'never_in', 2, 'student_support'::task_type, 10,
           'Onboard ' || x.n || ' students who have never signed in',
           'Nothing they do is measured until they do.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(never_in)::int n FROM sc) x WHERE x.n > 0

    UNION ALL
    SELECT 'attendance_floor', 1, 'student_support'::task_type, 5,
           'Contact families of ' || x.n || ' students below the 75% attendance floor',
           'Board eligibility risk.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(below_floor)::int n FROM sc) x WHERE x.n > 0
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM raw),
    'high', (SELECT count(*)::int FROM raw WHERE priority = 1),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'code', r.code, 'title', r.title, 'detail', r.detail,
        'priority', r.priority, 'task_type', r.ttype, 'due_days', r.due_days,
        'assignee_id', r.assignee,
        'assignee_name', (SELECT COALESCE(pf.full_name, pf.email) FROM profiles pf WHERE pf.id = r.assignee)
      ) ORDER BY r.priority, r.title) FROM raw r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

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

CREATE OR REPLACE FUNCTION public.dash5_tree_targets(p_level text DEFAULT 'wings'::text, p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_level text; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  v_level := CASE WHEN p_level IN ('wings','classes','subjects') THEN p_level ELSE 'wings' END;

  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  WITH
  -- Every live teacher target, with its current period resolved. A target whose
  -- window does not contain today has no open period and drops out here.
  tg AS (
    SELECT t.owner_id AS teacher_id, t.metric,
           (op->>'target_value')::int   AS target_value,
           (op->>'achieved_value')::int AS achieved_value,
           (op->>'period_start')::date  AS period_start,
           (op->>'period_end')::date    AS period_end
      FROM teacher_targets t
      CROSS JOIN LATERAL public.tgt_open_period(t.id) op
     WHERE t.institution_id = v_inst
       AND t.scope = 'teacher'
       AND t.status = 'active'
       AND op IS NOT NULL
  ),
  -- One row per teacher per metric. A teacher holding two live targets on the
  -- same metric (an admin direct one plus a wing split) is a case the targets
  -- feature deliberately allows, so both are summed rather than one picked.
  per_teacher AS MATERIALIZED (
    SELECT teacher_id, metric,
           sum(target_value)::int   AS target_value,
           sum(achieved_value)::int AS achieved_value,
           min(period_start)        AS period_start,
           max(period_end)          AS period_end
      FROM tg GROUP BY 1, 2
  ),
  -- Which teachers belong to which row at the level being drawn.
  map AS MATERIALIZED (
    SELECT DISTINCT
           CASE v_level
             WHEN 'wings'    THEN m.wing_id
             WHEN 'classes'  THEN ca.class_id
             ELSE ca.subject_id
           END AS row_id,
           ca.user_id AS teacher_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id
                    AND c.institution_id = v_inst
                    AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ca.class_id
     WHERE ca.role::text = 'teacher'
       AND (v_level <> 'classes'  OR p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (v_level <> 'subjects' OR ca.class_id = p_class_id)
       AND (v_level <> 'subjects' OR ca.subject_id IS NOT NULL)
  ),
  -- Fallback numerator: this year's publications, for a teacher with no target.
  -- MATERIALIZED is load-bearing (2026-09-23). Referenced once, this CTE used
  -- to be inlined into "joined"; the planner estimates "map" at 1 row, so it
  -- put the inlined subquery on the inner side of a nested loop and rescanned
  -- it for every map row, re-running both tgt_count_* calls per rescan.
  -- Alliance, wings level: 119 rescans, ~4,800 calls of each function instead
  -- of 86, 1.65s. Materialized, each teacher is counted exactly once. Only
  -- teachers that can reach a row are counted: "joined" drops NULL row_ids,
  -- so a teacher seen only there never contributed anything.
  yr AS MATERIALIZED (
    SELECT u.teacher_id,
           public.tgt_count_exams_published(u.teacher_id, v_inst, v_ay_start, v_today) AS exams_ytd,
           public.tgt_count_homework_published(u.teacher_id, v_inst, v_ay_start, v_today, v_tz) AS hw_ytd
      FROM (SELECT DISTINCT map.teacher_id FROM map WHERE map.row_id IS NOT NULL) u
  ),
  joined AS MATERIALIZED (
    SELECT map.row_id, map.teacher_id,
           COALESCE(e.target_value, 0)   AS e_target,
           COALESCE(e.achieved_value, 0) AS e_done,
           COALESCE(h.target_value, 0)   AS h_target,
           COALESCE(h.achieved_value, 0) AS h_done,
           (e.teacher_id IS NOT NULL)    AS e_has,
           (h.teacher_id IS NOT NULL)    AS h_has,
           yr.exams_ytd, yr.hw_ytd
      FROM map
      LEFT JOIN per_teacher e ON e.teacher_id = map.teacher_id AND e.metric = 'exams_published'
      LEFT JOIN per_teacher h ON h.teacher_id = map.teacher_id AND h.metric = 'homework_published'
      LEFT JOIN yr ON yr.teacher_id = map.teacher_id
     WHERE map.row_id IS NOT NULL
  ),
  -- Each teacher counted ONCE per row, even when they teach the row twice.
  agg AS (
    SELECT j.row_id,
           sum(j.e_target)::int e_target,
           -- With a target, the period figure. Without one, the year's total,
           -- which is what "done / 0" is meant to say.
           sum(CASE WHEN j.e_has THEN j.e_done ELSE COALESCE(j.exams_ytd, 0) END)::int e_done,
           sum(j.h_target)::int h_target,
           sum(CASE WHEN j.h_has THEN j.h_done ELSE COALESCE(j.hw_ytd, 0) END)::int h_done,
           count(*) FILTER (WHERE j.e_has)::int e_teachers,
           count(*) FILTER (WHERE j.h_has)::int h_teachers,
           -- Always carried, target or not, so the cell can keep a sense of
           -- scale on its second line either way.
           sum(COALESCE(j.exams_ytd, 0))::int e_ytd,
           sum(COALESCE(j.hw_ytd, 0))::int h_ytd,
           count(*)::int teachers
      FROM joined j GROUP BY 1
  ),
  -- The footer counts every teacher in scope exactly once, so it is NOT the
  -- sum of the rows above it whenever a teacher appears in more than one.
  tot AS (
    SELECT sum(z.e_target)::int e_target, sum(z.e_done)::int e_done,
           sum(z.h_target)::int h_target, sum(z.h_done)::int h_done,
           sum(z.e_ytd)::int e_ytd, sum(z.h_ytd)::int h_ytd,
           count(*) FILTER (WHERE z.e_has)::int e_teachers,
           count(*) FILTER (WHERE z.h_has)::int h_teachers,
           count(*)::int teachers
      FROM (
        SELECT DISTINCT ON (j.teacher_id)
               j.teacher_id, j.e_target, j.h_target, j.e_has, j.h_has,
               COALESCE(j.exams_ytd, 0) e_ytd, COALESCE(j.hw_ytd, 0) h_ytd,
               CASE WHEN j.e_has THEN j.e_done ELSE COALESCE(j.exams_ytd, 0) END e_done,
               CASE WHEN j.h_has THEN j.h_done ELSE COALESCE(j.hw_ytd, 0) END h_done
          FROM joined j ORDER BY j.teacher_id
      ) z
  )
  SELECT jsonb_build_object(
    'level', v_level,
    'has_targets', (SELECT count(*) > 0 FROM per_teacher),
    'period', (SELECT jsonb_build_object('start', min(period_start), 'end', max(period_end))
                 FROM per_teacher),
    'rows', COALESCE((
      SELECT jsonb_object_agg(a.row_id::text, jsonb_build_object(
               'exams', jsonb_build_object('done', a.e_done, 'target', a.e_target,
                                           'ytd', a.e_ytd, 'teachers', a.e_teachers),
               'homework', jsonb_build_object('done', a.h_done, 'target', a.h_target,
                                              'ytd', a.h_ytd, 'teachers', a.h_teachers),
               'teachers', a.teachers))
        FROM agg a), '{}'::jsonb),
    'total', COALESCE((
      SELECT jsonb_build_object(
               'exams', jsonb_build_object('done', t.e_done, 'target', t.e_target,
                                           'ytd', t.e_ytd, 'teachers', t.e_teachers),
               'homework', jsonb_build_object('done', t.h_done, 'target', t.h_target,
                                              'ytd', t.h_ytd, 'teachers', t.h_teachers),
               'teachers', t.teachers)
        FROM tot t), '{}'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_tree(p_level text DEFAULT 'wings'::text, p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_monday date;
  v_ay_start date; v_ay_end date; v_out jsonb;
  v_level text := lower(COALESCE(p_level, 'wings'));
BEGIN
  IF v_level NOT IN ('wings','classes','subjects') THEN
    RAISE EXCEPTION 'dash5: unknown level %', p_level;
  END IF;

  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today  := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  v_monday := v_today - (extract(isodow FROM v_today)::int - 1);
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);

  -- A filter may only narrow, and only inside the caller's own institution.
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;
  IF v_level = 'subjects' AND p_class_id IS NULL THEN
    RAISE EXCEPTION 'dash5: the subject level needs a class';
  END IF;

  -- MATERIALIZED so the atom is computed exactly once per request, whatever the
  -- planner would otherwise do with a set-returning function referenced twice.
  WITH a AS MATERIALIZED (
    SELECT * FROM public.dash5_atom_rows(v_inst) x
     WHERE (v_level = 'wings')
        OR (v_level = 'classes'  AND (p_wing_id IS NULL OR x.wing_id = p_wing_id))
        OR (v_level = 'subjects' AND x.class_id = p_class_id)
  ),
  -- Roster size and attendance are CLASS facts. Summing them per atom would
  -- multiply them by however many subjects the class happens to teach.
  pc AS (SELECT DISTINCT a.class_id, a.wing_id, a.students, a.att_present, a.att_total FROM a),
  wing_rows AS (
    SELECT wg.id, wg.name,
           COALESCE(k.class_count,0) class_count, COALESCE(k.students,0) students,
           COALESCE(g.subject_pairs,0) subject_pairs, COALESCE(g.subject_count,0) subject_count,
           CASE WHEN k.att_total > 0 THEN round(k.att_present*100.0/k.att_total,1) END att_pct,
           CASE WHEN g.chapters > 0
                THEN round((g.chapters_done*2+g.chapters_partial)*100.0/(g.chapters*2),1) END syl_pct,
           COALESCE(g.chapters,0) chapters, COALESCE(g.chapters_done,0) chapters_done,
           COALESCE(g.chapters_partial,0) chapters_partial,
           COALESCE(g.lessons_taught,0) lt, COALESCE(g.lessons_planned,0) lp,
           COALESCE(g.papers,0) papers, COALESCE(g.wk_done,0) wk_done, COALESCE(g.wk_planned,0) wk_planned,
           CASE WHEN g.acc_den > 0 THEN round(g.acc_num/g.acc_den,1) END accuracy,
           COALESCE(g.attempts,0) attempts,
           CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted*100.0/g.hw_slots,1) END hw_pct,
           (SELECT string_agg(COALESCE(pf.full_name, pf.email), ', ')
              FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = wg.id AND pf.is_active IS NOT FALSE) head
      FROM wings wg
      LEFT JOIN (
        SELECT a.wing_id,
               count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
               sum(a.chapters)::int chapters, sum(a.chapters_done)::int chapters_done,
               sum(a.chapters_partial)::int chapters_partial,
               sum(a.lessons_planned)::int lessons_planned, sum(a.lessons_taught)::int lessons_taught,
               sum(a.papers)::int papers, sum(a.wk_done)::int wk_done, sum(a.wk_planned)::int wk_planned,
               sum(a.attempts)::int attempts,
               sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) acc_num,
               sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) acc_den,
               sum(a.hw_slots)::int hw_slots, sum(a.hw_submitted)::int hw_submitted
          FROM a GROUP BY a.wing_id) g ON g.wing_id = wg.id
      LEFT JOIN (
        SELECT pc.wing_id, count(*)::int class_count, sum(pc.students)::int students,
               sum(pc.att_present)::int att_present, sum(pc.att_total)::int att_total
          FROM pc GROUP BY pc.wing_id) k ON k.wing_id = wg.id
     WHERE wg.institution_id = v_inst AND wg.is_active IS NOT FALSE
  ),
  class_rows AS (
    SELECT c.id, c.name || COALESCE(' ' || NULLIF(c.section,''), '') label,
           pc.students,
           g.subject_pairs, g.subject_count,
           CASE WHEN pc.att_total > 0 THEN round(pc.att_present*100.0/pc.att_total,1) END att_pct,
           CASE WHEN g.chapters > 0
                THEN round((g.chapters_done*2+g.chapters_partial)*100.0/(g.chapters*2),1) END syl_pct,
           COALESCE(g.chapters,0) chapters, COALESCE(g.chapters_done,0) chapters_done,
           COALESCE(g.chapters_partial,0) chapters_partial,
           g.lessons_taught lt, g.lessons_planned lp,
           g.papers, g.wk_done, g.wk_planned,
           CASE WHEN g.acc_den > 0 THEN round(g.acc_num/g.acc_den,1) END accuracy,
           g.attempts,
           CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted*100.0/g.hw_slots,1) END hw_pct,
           (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
              FROM class_assignments ca
              JOIN profiles pf ON pf.id = ca.user_id
             WHERE ca.class_id = c.id AND ca.role::text = 'teacher'
               AND ca.subject_id IS NULL) teacher
      FROM pc
      JOIN classes c ON c.id = pc.class_id
      JOIN (
        SELECT a.class_id,
               count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
               sum(a.chapters)::int chapters, sum(a.chapters_done)::int chapters_done,
               sum(a.chapters_partial)::int chapters_partial,
               sum(a.lessons_planned)::int lessons_planned, sum(a.lessons_taught)::int lessons_taught,
               sum(a.papers)::int papers, sum(a.wk_done)::int wk_done, sum(a.wk_planned)::int wk_planned,
               sum(a.attempts)::int attempts,
               sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) acc_num,
               sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) acc_den,
               sum(a.hw_slots)::int hw_slots, sum(a.hw_submitted)::int hw_submitted
          FROM a GROUP BY a.class_id) g ON g.class_id = pc.class_id
  ),
  subject_rows AS (
    SELECT a.subject_id id, us.name subject_name, a.students,
           a.chapters, a.chapters_done, a.chapters_partial, a.pending_grading,
           CASE WHEN a.att_total > 0 THEN round(a.att_present*100.0/a.att_total,1) END att_pct,
           CASE WHEN a.chapters > 0
                THEN round((a.chapters_done*2+a.chapters_partial)*100.0/(a.chapters*2),1) END syl_pct,
           a.lessons_taught lt, a.lessons_planned lp,
           a.papers, a.wk_done, a.wk_planned, a.attempts, round(a.acc,1) accuracy,
           CASE WHEN a.hw_slots > 0 THEN round(a.hw_submitted*100.0/a.hw_slots,1) END hw_pct,
           (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
              FROM class_assignments ca
              JOIN profiles pf ON pf.id = ca.user_id
             WHERE ca.class_id = a.class_id AND ca.subject_id = a.subject_id
               AND ca.role::text = 'teacher') teacher
      FROM a JOIN universal_subjects us ON us.id = a.subject_id
  ),
  tot AS (
    SELECT (SELECT count(*)::int FROM pc) class_count,
           (SELECT COALESCE(sum(pc.students),0)::int FROM pc) students,
           (SELECT COALESCE(sum(pc.att_present),0)::int FROM pc) att_present,
           (SELECT COALESCE(sum(pc.att_total),0)::int FROM pc) att_total,
           count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
           COALESCE(sum(a.chapters),0)::int chapters,
           COALESCE(sum(a.chapters_done),0)::int chapters_done,
           COALESCE(sum(a.chapters_partial),0)::int chapters_partial,
           COALESCE(sum(a.lessons_planned),0)::int lp, COALESCE(sum(a.lessons_taught),0)::int lt,
           COALESCE(sum(a.papers),0)::int papers, COALESCE(sum(a.wk_done),0)::int wk_done,
           COALESCE(sum(a.wk_planned),0)::int wk_planned,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) acc_num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) acc_den,
           COALESCE(sum(a.hw_slots),0)::int hw_slots, COALESCE(sum(a.hw_submitted),0)::int hw_submitted
      FROM a
  )
  SELECT jsonb_build_object(
    'level', v_level,
    'scope', jsonb_build_object(
      'week_start', v_monday, 'today', v_today,
      'ay_start', v_ay_start, 'ay_end', v_ay_end,
      'wing_id', p_wing_id,
      'wing_name', (SELECT w.name FROM wings w WHERE w.id = p_wing_id),
      'class_id', p_class_id,
      'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                        FROM classes c WHERE c.id = p_class_id)),
    'rows', CASE v_level
      WHEN 'wings' THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'sub', r.head,
          'class_count', r.class_count, 'students', r.students,
          'subject_pairs', r.subject_pairs, 'subject_count', r.subject_count,
          'attendance_pct', r.att_pct, 'syllabus_pct', r.syl_pct,
          'chapters', r.chapters, 'chapters_done', r.chapters_done,
          'chapters_partial', r.chapters_partial,
          'lessons_taught', r.lt, 'lessons_planned', r.lp,
          'papers', r.papers, 'wk_done', r.wk_done, 'wk_planned', r.wk_planned,
          'accuracy', r.accuracy, 'attempts', r.attempts, 'homework_pct', r.hw_pct,
          'composite', round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END),1),
          'band', public.dash5_band(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END))
        ) ORDER BY r.name), '[]'::jsonb) FROM wing_rows r)
      WHEN 'classes' THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.label, 'sub', r.teacher,
          'students', r.students,
          'subject_pairs', r.subject_pairs, 'subject_count', r.subject_count,
          'attendance_pct', r.att_pct, 'syllabus_pct', r.syl_pct,
          'chapters', r.chapters, 'chapters_done', r.chapters_done,
          'chapters_partial', r.chapters_partial,
          'lessons_taught', r.lt, 'lessons_planned', r.lp,
          'papers', r.papers, 'wk_done', r.wk_done, 'wk_planned', r.wk_planned,
          'accuracy', r.accuracy, 'attempts', r.attempts, 'homework_pct', r.hw_pct,
          'composite', round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END),1),
          'band', public.dash5_band(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END))
        ) ORDER BY r.label), '[]'::jsonb) FROM class_rows r)
      ELSE (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.subject_name, 'teacher', r.teacher,
          'students', r.students,
          'chapters', r.chapters, 'chapters_done', r.chapters_done,
          'chapters_partial', r.chapters_partial, 'pending_grading', r.pending_grading,
          'attendance_pct', r.att_pct, 'syllabus_pct', r.syl_pct,
          'lessons_taught', r.lt, 'lessons_planned', r.lp,
          'papers', r.papers, 'wk_done', r.wk_done, 'wk_planned', r.wk_planned,
          'accuracy', r.accuracy, 'attempts', r.attempts, 'homework_pct', r.hw_pct,
          -- A subject nobody has examined is "not assessed", never a zero.
          'composite', CASE WHEN r.accuracy IS NOT NULL THEN
             round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
               CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END),1) END,
          'band', CASE WHEN r.accuracy IS NOT NULL THEN
             public.dash5_band(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
               CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END)) END
        ) ORDER BY r.subject_name), '[]'::jsonb) FROM subject_rows r)
    END,
    'total', (SELECT jsonb_build_object(
      'class_count', t.class_count, 'students', t.students,
      'chapters', t.chapters, 'chapters_done', t.chapters_done,
      'chapters_partial', t.chapters_partial,
      'subject_pairs', t.subject_pairs, 'subject_count', t.subject_count,
      'attendance_pct', CASE WHEN t.att_total > 0 THEN round(t.att_present*100.0/t.att_total,1) END,
      'syllabus_pct',   CASE WHEN t.chapters > 0
         THEN round((t.chapters_done*2+t.chapters_partial)*100.0/(t.chapters*2),1) END,
      'lessons_taught', t.lt, 'lessons_planned', t.lp,
      'papers', t.papers, 'wk_done', t.wk_done, 'wk_planned', t.wk_planned,
      'accuracy', CASE WHEN t.acc_den > 0 THEN round(t.acc_num/t.acc_den,1) END,
      'homework_pct', CASE WHEN t.hw_slots > 0 THEN round(t.hw_submitted*100.0/t.hw_slots,1) END,
      'band', public.dash5_band(public.dash5_composite(
         CASE WHEN t.acc_den > 0 THEN t.acc_num/t.acc_den END,
         CASE WHEN t.chapters > 0 THEN (t.chapters_done*2+t.chapters_partial)*100.0/(t.chapters*2) END,
         CASE WHEN t.att_total > 0 THEN t.att_present*100.0/t.att_total END,
         CASE WHEN t.lp > 0 THEN t.lt*100.0/t.lp END))
    ) FROM tot t)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.resolve_flag_assignee(p_institution_id uuid, p_subject_type text, p_subject_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_class uuid;
BEGIN
  IF p_subject_type = 'class' THEN
    BEGIN v_class := p_subject_key::uuid; EXCEPTION WHEN others THEN v_class := NULL; END;
  ELSIF p_subject_type = 'student' THEN
    SELECT ca.class_id INTO v_class FROM class_assignments ca
      WHERE ca.user_id = p_subject_key::uuid AND ca.role='student' LIMIT 1;
  ELSIF p_subject_type = 'exam' THEN
    SELECT ec.class_id INTO v_class FROM exam_classes ec WHERE ec.exam_id = p_subject_key::uuid LIMIT 1;
  END IF;

  IF v_class IS NOT NULL THEN
    SELECT ca.user_id INTO v_uid FROM class_assignments ca
      WHERE ca.class_id = v_class AND ca.role='teacher' AND ca.subject_id IS NULL LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
    SELECT wa.user_id INTO v_uid FROM wing_class_mappings m
      JOIN wing_assignments wa ON wa.wing_id = m.wing_id
      WHERE m.class_id = v_class LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  IF p_subject_type = 'subject' THEN
    SELECT ca.user_id INTO v_uid FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_institution_id
      WHERE ca.role='teacher' AND ca.subject_id = p_subject_key::uuid LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  -- fallback: a school_admin (the principal)
  SELECT ur.user_id INTO v_uid FROM user_roles ur
    WHERE ur.institution_id = p_institution_id AND ur.role = 'school_admin' LIMIT 1;
  RETURN v_uid;
END $function$;

DROP FUNCTION public.dash5_attendance_school_days(uuid,uuid,date);

DROP FUNCTION public.dash5_band_or_null(numeric);

DROP FUNCTION public.dash5_composite(numeric,numeric,numeric,numeric,numeric);

DROP FUNCTION public.dash5_counted_results(uuid);

DROP FUNCTION public.dash5_year_pace(uuid);
