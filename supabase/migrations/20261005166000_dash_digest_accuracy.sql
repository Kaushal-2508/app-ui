-- Admin dashboard accuracy pass: the Overview "Insights" cards and the Calendar card.
-- Audit: docs/admin-dashboard-audit-2026-10-05.md (R3, R4, R8, plus the digest
-- findings below). Decisions (Tushar, 2026-10-05): averages use PUBLISHED marks
-- only, blank papers (every counted mark exactly 0) are left out, real session
-- time is "seen", nothing on screen is removed.
--
-- dash_admin_digest (rule-based, no model is involved):
--   portal_adoption   "Only N signed in during the last 30 days" counted
--                     auth.users.last_sign_in_at, which only moves on a password
--                     sign-in (R3). Alliance said 570, real 802. Now real session
--                     time. "Never signed in" stays last_sign_in_at IS NULL
--                     (verified: no such student has a session).
--   weakest_subject   Number unchanged (dash_school_subject_performance, the
--                     Subjects card's own figure). Detail said "every graded exam";
--                     now states the published result and paper counts, and says
--                     when a quarter or more of them are exactly 0% (Alliance
--                     History: 164 of 188 are 0%, non-takers of an optional
--                     subject given 0 in marks-only uploads). When half or more
--                     are 0% the card is a data gap, not a teaching risk.
--   weakest_class     Counted unpublished results, absences and blank papers,
--                     dated exams by publish date, scanned every school's exams,
--                     credited a student's whole history to the class they are in
--                     now, and grouped classes by display name (R4, R8). Alliance
--                     showed Class 12 Science-B 27.5%, real 32.8%. Now
--                     dash5_counted_results in the academic year, by the class the
--                     paper was sat in. "Across recent exams" / "the 65% band"
--                     were false (whole year; 65 is not a band cut).
--   attendance_trend  Compared all rows of two weeks, so a week in which more
--                     classes took the register moved the figure. Now compares the
--                     classes that took the register in both 7-day windows.
--   attendance_compliance  Counted empty sections as "not marking": Alliance's
--                     "4 of 53" were four classes with no students (real 0 of
--                     49); Salci National 41 of 42 is really 32 of 33. Now only
--                     classes with students on the roll, and names some.
--   notice_reach      Divided by notices.recipient_count (stale: 282 vs 280 real
--                     recipients) and counted future-dated notices. Now real
--                     recipient rows, published notices only, and names the
--                     lowest-reach notice.
--   Order             Cards came back in rule order, and the page shows the first
--                     four, so a "Risk" could sit behind "Show all" under a
--                     "Working". Now Risk first, then Watch/Data gap, then Working.
--   Signature, return columns and codes unchanged.
--
-- dash_recent_events (Calendar card):
--   is_upcoming was starts_on >= today, so an event under way (started earlier,
--   ends later) read "already passed", and the 30-day look-back keyed on the start
--   dropped a long event still running. Both now use the end date.
--   The "N upcoming" badge counted upcoming rows among the p_limit returned, so it
--   could never exceed 8. New column upcoming_total = every upcoming or ongoing
--   event on the calendar. Adding a RETURNS TABLE column needs DROP + CREATE; the
--   previous grants (authenticated, service_role; no PUBLIC, no anon) are restored.

CREATE OR REPLACE FUNCTION public.dash_admin_digest(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(code text, severity text, headline text, detail text, link_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_out jsonb := '[]'::jsonb;
  v_sev text; v_txt text;
  -- 1. adoption
  v_students int; v_never int; v_active30 int;
  -- 2. weakest subject
  v_subj text; v_subj_pct numeric; v_subj_norm text;
  v_subj_n int; v_subj_zero int; v_subj_papers int;
  -- 3. weakest class
  v_class text; v_class_pct numeric; v_class_n int; v_class_zero int; v_class_papers int;
  -- 4. attendance trend
  v_wk numeric; v_pwk numeric; v_lfl int;
  -- 5. register compliance
  v_unmarked int; v_classes int; v_unmarked_names text;
  -- 6. notice reach
  v_low_notices int; v_notices int; v_worst_title text; v_worst_read int; v_worst_total int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  -- ---- 1. portal adoption ------------------------------------------------
  -- "Never signed in" is last_sign_in_at IS NULL (no such student has a
  -- session). "Used SALCI" is real session time: last_sign_in_at only moves on
  -- a password sign-in and sessions last months.
  SELECT count(*),
         count(*) FILTER (WHERE u.last_sign_in_at IS NULL),
         count(*) FILTER (WHERE GREATEST(
             u.last_sign_in_at,
             (SELECT max(GREATEST(se.refreshed_at AT TIME ZONE 'UTC', se.updated_at))
                FROM auth.sessions se WHERE se.user_id = s.student_id))
           >= now() - INTERVAL '30 days')
    INTO v_students, v_never, v_active30
    FROM public.institution_student_ids(v_inst) s
    LEFT JOIN auth.users u ON u.id = s.student_id;

  IF v_students > 0 AND v_never > 0 THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'code', 'portal_adoption',
      'severity', CASE WHEN v_never * 100.0 / v_students >= 50 THEN 'high'
                       WHEN v_never * 100.0 / v_students >= 20 THEN 'medium'
                       ELSE 'low' END,
      'headline', to_char(v_never, 'FM999,999,990') || ' of ' || to_char(v_students, 'FM999,999,990')
                  || ' students have never signed in',
      'detail', 'They cannot see homework, notices or results on SALCI until they do. '
                || to_char(v_active30, 'FM999,999,990') || ' of ' || to_char(v_students, 'FM999,999,990')
                || ' students used SALCI in the last 30 days.',
      'link_url', '/school/students'));
  END IF;

  -- ---- 2. weakest subject (>= 5 results, so one bad paper is not a trend) --
  -- The Subjects card's own figure (published, not absent, blank papers out,
  -- academic year, spellings merged), so the two never disagree.
  SELECT sp.subject_name, sp.school_avg INTO v_subj, v_subj_pct
    FROM public.dash_school_subject_performance(v_inst) sp
   WHERE sp.results >= 5
   ORDER BY sp.school_avg ASC, sp.subject_name
   LIMIT 1;

  -- Same folding dash_school_subject_performance uses, to find that subject's
  -- results again for the paper and exact-zero counts.
  IF v_subj IS NOT NULL THEN
    SELECT CASE k.b WHEN 'maths' THEN 'mathematics' WHEN 'math' THEN 'mathematics'
                    WHEN 'sst' THEN 'socialscience' WHEN 'socialsciences' THEN 'socialscience'
                    ELSE k.b END
      INTO v_subj_norm
      FROM (SELECT regexp_replace(replace(lower(btrim(v_subj)), '&', 'and'), '[^a-z0-9]+', '', 'g') AS b) k;
  END IF;

  -- ---- 3. weakest class (and the subject's counts, one pass) --------------
  -- Counted results only (dash5_counted_results: published exam and result,
  -- not absent, blank papers out), held this academic year, in an active
  -- class, credited to the class the paper was sat in. One row per result.
  WITH cr AS MATERIALIZED (
    SELECT DISTINCT ON (c.result_id)
           c.result_id, c.class_id, c.exam_id, c.exam_subject_id, c.percentage
      FROM public.dash5_counted_results(v_inst) c
      JOIN classes cl ON cl.id = c.class_id AND cl.is_active IS NOT FALSE
     WHERE c.exam_date BETWEEN v_ay_start AND v_ay_end
     ORDER BY c.result_id
  ),
  subj AS (
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE cr.percentage = 0)::int AS z,
           count(DISTINCT (cr.exam_id, cr.class_id))::int AS p
      FROM cr
      JOIN universal_subjects us ON us.id = cr.exam_subject_id
      CROSS JOIN LATERAL (
        SELECT regexp_replace(replace(lower(btrim(us.name)), '&', 'and'), '[^a-z0-9]+', '', 'g') AS b) k
     WHERE v_subj_norm IS NOT NULL
       AND (CASE k.b WHEN 'maths' THEN 'mathematics' WHEN 'math' THEN 'mathematics'
                     WHEN 'sst' THEN 'socialscience' WHEN 'socialsciences' THEN 'socialscience'
                     ELSE k.b END) = v_subj_norm
  ),
  cls AS (
    SELECT cl.name || CASE WHEN coalesce(cl.section, '') <> '' THEN '-' || cl.section ELSE '' END AS nm,
           round(avg(cr.percentage), 1) AS pct,
           count(*)::int AS n,
           count(*) FILTER (WHERE cr.percentage = 0)::int AS z,
           count(DISTINCT cr.exam_id)::int AS p
      FROM cr
      JOIN classes cl ON cl.id = cr.class_id
     GROUP BY cl.id, cl.name, cl.section
    HAVING count(*) >= 5
     ORDER BY 2 ASC, 1
     LIMIT 1
  )
  SELECT subj.n, subj.z, subj.p, cls.nm, cls.pct, cls.n, cls.z, cls.p
    INTO v_subj_n, v_subj_zero, v_subj_papers, v_class, v_class_pct, v_class_n, v_class_zero, v_class_papers
    FROM subj LEFT JOIN cls ON true;

  IF v_subj IS NOT NULL THEN
    v_sev := CASE WHEN COALESCE(v_subj_n, 0) > 0 AND v_subj_zero * 2 >= v_subj_n THEN 'medium'
                  WHEN v_subj_pct < 50 THEN 'high'
                  WHEN v_subj_pct < 65 THEN 'medium' ELSE 'low' END;
    v_txt := 'Average of ' || to_char(COALESCE(v_subj_n, 0), 'FM999,999,990') || ' published results in '
             || to_char(COALESCE(v_subj_papers, 0), 'FM999,999,990')
             || CASE WHEN v_subj_papers = 1 THEN ' paper' ELSE ' papers' END
             || ' this academic year.';
    IF COALESCE(v_subj_n, 0) > 0 AND v_subj_zero * 4 >= v_subj_n THEN
      v_txt := v_txt || ' ' || to_char(v_subj_zero, 'FM999,999,990')
               || ' of them are exactly 0%, which usually means marks were not entered or the student does not take '
               || v_subj || '.';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'code', 'weakest_subject',
      'severity', v_sev,
      'headline', v_subj || ' is your weakest subject school-wide at ' || v_subj_pct || '%',
      'detail', v_txt,
      'link_url', '/school/analytics'));
  END IF;

  IF v_class IS NOT NULL AND v_class_pct < 65 THEN
    v_sev := CASE WHEN v_class_zero * 2 >= v_class_n THEN 'medium'
                  WHEN v_class_pct < 50 THEN 'high' ELSE 'medium' END;
    v_txt := 'Average of ' || to_char(v_class_n, 'FM999,999,990') || ' published results in '
             || to_char(v_class_papers, 'FM999,999,990')
             || CASE WHEN v_class_papers = 1 THEN ' paper' ELSE ' papers' END
             || ' this academic year, below 65%.';
    IF v_class_zero * 4 >= v_class_n THEN
      v_txt := v_txt || ' ' || to_char(v_class_zero, 'FM999,999,990')
               || ' of them are exactly 0%, which usually means marks were not entered or the student does not take that subject.';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'code', 'weakest_class',
      'severity', v_sev,
      'headline', v_class || ' is your lowest-scoring class at ' || v_class_pct || '%',
      'detail', v_txt,
      'link_url', '/school/classes'));
  END IF;

  -- ---- 4. attendance week over week --------------------------------------
  -- Like for like: only classes that took the register in both 7-day windows,
  -- so more sections starting to mark does not read as a change. Leave counts
  -- in the total, not as present (20260905160000).
  WITH w AS (
    SELECT ar.class_id, (ar.date > v_today - 7) AS cur, ar.status
      FROM attendance_records ar
     WHERE ar.institution_id = v_inst
       AND ar.date > v_today - 14 AND ar.date <= v_today
  ),
  both_wk AS (
    SELECT w.class_id FROM w GROUP BY w.class_id HAVING bool_or(w.cur) AND bool_or(NOT w.cur)
  )
  SELECT round(count(*) FILTER (WHERE w.cur AND w.status IN ('present','late')) * 100.0
               / NULLIF(count(*) FILTER (WHERE w.cur), 0), 1),
         round(count(*) FILTER (WHERE NOT w.cur AND w.status IN ('present','late')) * 100.0
               / NULLIF(count(*) FILTER (WHERE NOT w.cur), 0), 1),
         count(DISTINCT w.class_id)::int
    INTO v_wk, v_pwk, v_lfl
    FROM w
   WHERE w.class_id IN (SELECT b.class_id FROM both_wk b);

  IF v_wk IS NOT NULL AND v_pwk IS NOT NULL AND abs(v_wk - v_pwk) >= 1 THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'code', 'attendance_trend',
      'severity', CASE WHEN v_wk - v_pwk <= -3 THEN 'high'
                       WHEN v_wk - v_pwk <  0  THEN 'medium' ELSE 'low' END,
      'headline', 'Attendance ' || CASE WHEN v_wk > v_pwk THEN 'rose ' ELSE 'dipped ' END
                  || round(abs(v_wk - v_pwk), 1) || ' points vs the previous 7 days',
      'detail', 'Now ' || v_wk || '% present, was ' || v_pwk || '%, in the '
                || v_lfl || CASE WHEN v_lfl = 1 THEN ' class' ELSE ' classes' END
                || ' that took the register in both weeks.',
      'link_url', '/school/attendance'));
  END IF;

  -- ---- 5. classes not taking the register --------------------------------
  -- Only classes with students on the roll (the institution_student_ids rule):
  -- an empty section has no register to take.
  WITH cls AS (
    SELECT c.id,
           c.name || CASE WHEN coalesce(c.section, '') <> '' THEN '-' || c.section ELSE '' END AS nm,
           EXISTS (SELECT 1 FROM attendance_records ar
                    WHERE ar.class_id = c.id
                      AND ar.date > v_today - 14 AND ar.date <= v_today) AS marked
      FROM classes c
     WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
       AND EXISTS (
         SELECT 1 FROM class_assignments ca
           JOIN profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE
          WHERE ca.class_id = c.id AND ca.role = 'student'
            AND EXISTS (SELECT 1 FROM user_roles ur
                         WHERE ur.user_id = ca.user_id AND ur.role::text = 'student'))
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE NOT cls.marked)::int,
         (SELECT string_agg(x.nm, ', ' ORDER BY x.nm)
            FROM (SELECT c2.nm FROM cls c2 WHERE NOT c2.marked ORDER BY c2.nm LIMIT 3) x)
    INTO v_classes, v_unmarked, v_unmarked_names
    FROM cls;

  IF v_unmarked > 0 THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'code', 'attendance_compliance',
      'severity', CASE WHEN v_unmarked * 100.0 / GREATEST(v_classes, 1) >= 50 THEN 'high'
                       ELSE 'medium' END,
      'headline', v_unmarked || ' of ' || v_classes
                  || ' classes with students have not taken the register in 14 days',
      'detail', CASE WHEN v_unmarked > 3
                     THEN 'Includes ' || v_unmarked_names || ' and ' || (v_unmarked - 3) || ' more. '
                     ELSE v_unmarked_names || '. ' END
                || 'Attendance figures on this page only cover classes that take the register.',
      'link_url', '/school/attendance'));
  END IF;

  -- ---- 6. notices nobody opened ------------------------------------------
  -- Real recipient rows (recipient_count drifts), published notices only.
  WITH n AS (
    SELECT n.id, btrim(n.title) AS title, n.published_at,
           (SELECT count(*) FROM notice_recipients r WHERE r.notice_id = n.id)::int AS total,
           (SELECT count(*) FROM notice_recipients r
             WHERE r.notice_id = n.id AND r.read_at IS NOT NULL)::int AS rd
      FROM notices n
     WHERE n.institution_id = v_inst
       AND n.published_at >= now() - INTERVAL '30 days'
       AND n.published_at <= now()
  ),
  sent AS (SELECT * FROM n WHERE n.total > 0)
  SELECT count(*)::int,
         count(*) FILTER (WHERE sent.rd * 100.0 / sent.total < 40)::int
    INTO v_notices, v_low_notices
    FROM sent;

  IF v_low_notices > 0 THEN
    SELECT left(btrim(n.title), 60), r.rd, r.total
      INTO v_worst_title, v_worst_read, v_worst_total
      FROM notices n
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS total, count(*) FILTER (WHERE x.read_at IS NOT NULL)::int AS rd
          FROM notice_recipients x WHERE x.notice_id = n.id) r
     WHERE n.institution_id = v_inst
       AND n.published_at >= now() - INTERVAL '30 days'
       AND n.published_at <= now()
       AND r.total > 0
     ORDER BY r.rd::numeric / r.total ASC, n.published_at ASC
     LIMIT 1;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'code', 'notice_reach',
      'severity', 'medium',
      'headline', v_low_notices || ' of ' || v_notices
                  || ' notices sent in the last 30 days were opened by under 40% of recipients',
      'detail', 'Lowest: "' || v_worst_title || '", opened by '
                || to_char(v_worst_read, 'FM999,999,990') || ' of ' || to_char(v_worst_total, 'FM999,999,990')
                || '. A notice counts as read once its recipient opens it on SALCI.',
      'link_url', '/school/notices'));
  END IF;

  -- Most serious first: the page shows the first four cards.
  RETURN QUERY
  SELECT t.x->>'code', t.x->>'severity', t.x->>'headline', t.x->>'detail', t.x->>'link_url'
    FROM jsonb_array_elements(v_out) WITH ORDINALITY AS t(x, ord)
   ORDER BY CASE t.x->>'severity' WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.ord;
END $function$;

DROP FUNCTION IF EXISTS public.dash_recent_events(uuid, integer);

CREATE FUNCTION public.dash_recent_events(p_institution_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(event_id uuid, title text, kind text, starts_on date, ends_on date, is_upcoming boolean, upcoming_total integer)
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

  -- An event is upcoming until its last day is over, so one under way is not
  -- "already passed". upcoming_total counts every upcoming event, not only the
  -- p_limit rows returned (the badge used to top out at the limit).
  RETURN QUERY
  WITH e AS (
    SELECT ce.id, ce.title, ce.kind, ce.starts_on, ce.ends_on,
           GREATEST(ce.starts_on, COALESCE(ce.ends_on, ce.starts_on)) AS last_day
      FROM cal_events ce
     WHERE ce.institution_id = v_inst
       AND GREATEST(ce.starts_on, COALESCE(ce.ends_on, ce.starts_on)) >= v_today - 30
  )
  SELECT e.id, e.title, e.kind, e.starts_on, e.ends_on,
         (e.last_day >= v_today) AS is_upcoming,
         (count(*) FILTER (WHERE e.last_day >= v_today) OVER ())::int AS upcoming_total
    FROM e
   ORDER BY (e.last_day >= v_today) DESC,
            CASE WHEN e.last_day >= v_today THEN e.starts_on END ASC,
            CASE WHEN e.last_day <  v_today THEN e.starts_on END DESC,
            e.id
   LIMIT LEAST(GREATEST(coalesce(p_limit, 6), 1), 30);
END $function$;

REVOKE ALL ON FUNCTION public.dash_recent_events(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash_recent_events(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.dash_recent_events(uuid, integer) TO authenticated, service_role;
