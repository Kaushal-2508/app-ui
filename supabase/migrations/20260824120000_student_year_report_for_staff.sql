-- Admin / teacher access to a student's year report.
--
-- WHY THIS EXISTS: student_year_report() derives everything from auth.uid(), so
-- /school/student/:studentId (StudentPerformancePage) had no way to show or
-- download the new report for another user. 20260817120000 deliberately shipped
-- WITHOUT a p_student_id parameter, noting that an on-behalf-of path needed a
-- real authorisation design rather than a convenience argument. This is that
-- design.
--
-- SHAPE: the whole report body moves into ONE internal implementation taking a
-- uid, and both public RPCs become thin authorised wrappers over it. The two
-- callers therefore cannot drift - a student and their teacher are guaranteed to
-- be looking at identical numbers, which is the entire point of the report.
--
-- AUTHORISATION: the wrapper uses can_edit_student_details(actor, student), the
-- house scope-strict staff predicate, NOT can_view_student_details. The latter
-- grants ANY teacher in the institution access to ANY student, which is too
-- loose for a downloadable record of a named child's marks. can_edit_student_details
-- resolves to:
--     super_admin                             -> allowed
--     school_admin / super_school_admin       -> same institution only
--     student_manager override                -> same institution only
--     coordinator                             -> same institution AND wing-scoped
--                                                to one of the student's classes
--     teacher                                 -> same institution AND actually
--                                                teaches one of their classes
-- The client route guard on /school/student/:studentId is NOT a boundary; this
-- check is the boundary.
--
-- NOTE this NARROWS access compared with today's page, which reads by id and
-- lets any teacher in the institution look at any student. That is deliberate.
--
-- The implementation function is SECURITY DEFINER (it must read across RLS) but
-- is revoked from every client role, so it is reachable ONLY through the two
-- wrappers, which run as the definer and therefore bypass that revoke.

CREATE OR REPLACE FUNCTION public._student_year_report_impl(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := p_uid;
  v_inst      uuid;
  v_tz        text;
  v_today     date;
  v_ay_code   text;
  v_from      date;
  v_to        date;
  v_synthetic boolean := false;
  v_out       jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'no student'; END IF;

  v_inst := public.get_user_institution(v_uid);
  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT ay.code, ay.starts_on, LEAST(ay.ends_on, v_today)
    INTO v_ay_code, v_from, v_to
  FROM cal_academic_years ay
  WHERE ay.institution_id = v_inst
  ORDER BY (v_today BETWEEN ay.starts_on AND ay.ends_on) DESC, ay.is_active DESC, ay.starts_on DESC
  LIMIT 1;

  -- Only 5 of 31 institutions with students have a cal_academic_years row, so
  -- fall back to a trailing year and TELL the reader that is what happened
  -- rather than inventing a "2026-27" label.
  IF v_from IS NULL THEN
    v_from := (v_today - INTERVAL '1 year')::date;
    v_to := v_today;
    v_synthetic := true;
  END IF;

  WITH my_exams AS (
    -- One row per exam. Grouped so a re-attempt or a duplicated exam_subjects
    -- row can never weight a single test twice.
    SELECT e.id AS exam_id,
           (array_agg(a.class_id ORDER BY a.id))[1] AS class_id,
           e.title, e.exam_type,
           avg(fr.percentage)           AS my_pct,
           max(fr.total_marks_obtained) AS obtained,
           max(fr.total_max_marks)      AS out_of,
           bool_or(fr.is_pass)          AS is_pass,
           count(*) FILTER (WHERE fr.is_pass IS NULL) AS pass_unknown,
           max(COALESCE(e.published_at::date, e.scheduled_date::date,
                        a.submitted_at::date, fr.created_at::date)) AS exam_date
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE a.student_id = v_uid AND fr.is_published = true
    GROUP BY e.id
    HAVING max(COALESCE(e.published_at::date, e.scheduled_date::date,
                        a.submitted_at::date, fr.created_at::date)) BETWEEN v_from AND v_to
    ORDER BY exam_date DESC
    LIMIT 200                                   -- §23 bound
  ),
  cohort AS (
    -- Everyone who sat the SAME exam in the SAME section. Aggregates only.
    SELECT m.exam_id, a.student_id, fr.percentage
    FROM my_exams m
    JOIN student_exam_attempts a ON a.exam_id = m.exam_id AND a.class_id = m.class_id
    JOIN final_results fr ON fr.attempt_id = a.id AND fr.is_published = true
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
  ),
  per_exam AS (
    SELECT c.exam_id,
           round(avg(c.percentage), 1)      AS class_avg,
           max(c.percentage)                AS class_high,
           count(DISTINCT c.student_id)     AS n_students
    FROM cohort c
    GROUP BY c.exam_id
  ),
  peer_avg AS (
    -- One average per classmate across the same exams: the basis for percentile
    -- and the distribution.
    SELECT c.student_id, avg(c.percentage) AS avg_pct
    FROM cohort c
    GROUP BY c.student_id
  ),
  me AS (
    SELECT avg(my_pct) AS my_avg,
           count(*)                                   AS n_assessments,
           count(*) FILTER (WHERE is_pass)            AS pass_count,
           sum(pass_unknown)                          AS pass_unknown,
           round(stddev_samp(my_pct)::numeric, 1)     AS sd
    FROM my_exams
  ),
  subj AS (
    SELECT initcap(lower(btrim(us.name))) AS subject,
           round(avg(m.my_pct), 1)        AS student_avg,
           count(DISTINCT m.exam_id)      AS n_tests
    FROM my_exams m
    JOIN exam_subjects es ON es.exam_id = m.exam_id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE btrim(COALESCE(us.name, '')) <> ''
    GROUP BY 1
  ),
  subj_cohort AS (
    SELECT initcap(lower(btrim(us.name))) AS subject, c.student_id,
           avg(c.percentage) AS pct
    FROM cohort c
    JOIN exam_subjects es ON es.exam_id = c.exam_id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE btrim(COALESCE(us.name, '')) <> ''
    GROUP BY 1, 2
  ),
  subj_cls AS (
    SELECT subject, round(avg(pct), 1) AS class_avg, round(max(pct), 1) AS class_high,
           count(DISTINCT student_id) AS n_students
    FROM subj_cohort GROUP BY subject
  ),
  chap AS (
    SELECT et.exam_id, st.id AS chapter_id, st.topic_name AS chapter,
           st.chapter_number, st.display_order,
           initcap(lower(btrim(us.name))) AS subject
    FROM my_exams m
    JOIN exam_topics et ON et.exam_id = m.exam_id
    JOIN syllabus_topics st ON st.id = et.topic_id AND st.is_active
    LEFT JOIN universal_subjects us ON us.id = st.subject_id
    WHERE btrim(COALESCE(st.topic_name, '')) <> ''
  ),
  chap_mine AS (
    SELECT ch.chapter_id, ch.chapter, ch.subject, ch.chapter_number, ch.display_order,
           round(avg(m.my_pct), 1)   AS student_avg,
           count(DISTINCT m.exam_id) AS n_tests
    FROM chap ch JOIN my_exams m ON m.exam_id = ch.exam_id
    GROUP BY 1,2,3,4,5
  ),
  chap_cls AS (
    SELECT ch.chapter_id, round(avg(c.percentage), 1) AS class_avg,
           count(DISTINCT c.student_id) AS n_students
    FROM chap ch JOIN cohort c ON c.exam_id = ch.exam_id
    GROUP BY 1
  ),
  hol AS (
    SELECT DISTINCT d::date AS day
    FROM cal_events ce
    CROSS JOIN LATERAL generate_series(ce.starts_on::date, ce.ends_on::date, INTERVAL '1 day') d
    WHERE ce.institution_id = v_inst AND ce.kind = 'holiday'
      AND ce.starts_on::date <= v_to AND ce.ends_on::date >= v_from
      AND d::date BETWEEN v_from AND v_to
  ),
  att AS (
    SELECT CASE WHEN h.day IS NOT NULL THEN 'holiday' ELSE ar.status END AS status
    FROM attendance_records ar
    LEFT JOIN hol h ON h.day = ar.date
    WHERE ar.student_id = v_uid AND ar.date BETWEEN v_from AND v_to
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'academic_year', v_ay_code,
      'from', to_char(v_from, 'YYYY-MM-DD'),
      'to', to_char(v_to, 'YYYY-MM-DD'),
      'window_is_synthetic', v_synthetic,
      'generated_at', to_char((now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata')), 'YYYY-MM-DD"T"HH24:MI:SS'),
      'timezone', COALESCE(v_tz, 'Asia/Kolkata')
    ),
    'snapshot', (
      SELECT jsonb_build_object(
        'n_assessments', COALESCE(me.n_assessments, 0),
        'my_avg', round(me.my_avg, 1),
        'pass_count', COALESCE(me.pass_count, 0),
        'pass_unknown', COALESCE(me.pass_unknown, 0),
        -- Lower spread = steadier. NULL below 3 tests: a "consistency" number
        -- off two data points is noise wearing a percentage sign.
        'consistency', CASE WHEN me.n_assessments >= 3 AND me.sd IS NOT NULL
                            THEN GREATEST(0, round(100 - me.sd * 2.5))::int END,
        'class_avg', (SELECT CASE WHEN count(DISTINCT student_id) >= 3
                                  THEN round(avg(avg_pct), 1) END FROM peer_avg)
      ) FROM me
    ),
    'standing', (
      SELECT jsonb_build_object(
        'cohort_n', n,
        'percentile', CASE WHEN n >= 5 THEN pct END,
        'ahead_of',   CASE WHEN n >= 5 THEN ahead END,
        'peers',      CASE WHEN n >= 5 THEN n - 1 END,
        'topper_avg', CASE WHEN n >= 5 THEN top END,
        'histogram',  CASE WHEN n >= 5 THEN hist END
      )
      FROM (
        SELECT (SELECT count(DISTINCT student_id) FROM peer_avg) AS n,
               -- cume_dist must be computed over the WHOLE cohort and only then
               -- filtered to the caller. Filtering first leaves the window with
               -- one row, which always yields 1.0 (i.e. a bogus 100th
               -- percentile). Caught in prod testing: ahead_of said 1 of 9.
               (SELECT r.cd FROM (
                  SELECT student_id, round(cume_dist() OVER (ORDER BY avg_pct) * 100) AS cd
                  FROM peer_avg
                ) r WHERE r.student_id = v_uid) AS pct,
               -- Counted explicitly: cume_dist counts ties as <= and would
               -- over-report how many classmates the student is ahead of.
               (SELECT count(*) FROM peer_avg p
                 WHERE p.avg_pct < (SELECT avg_pct FROM peer_avg WHERE student_id = v_uid)) AS ahead,
               (SELECT round(max(avg_pct), 1) FROM peer_avg) AS top,
               (SELECT jsonb_agg(jsonb_build_object('bin', b.label, 'count', b.c) ORDER BY b.lo)
                  FROM (
                    SELECT lo, label, count(p.student_id) AS c
                    FROM (VALUES (0,'0-49'),(50,'50-59'),(60,'60-69'),(70,'70-79'),(80,'80-89'),(90,'90-100')) AS v(lo,label)
                    LEFT JOIN peer_avg p
                      ON (CASE WHEN p.avg_pct < 50 THEN 0
                               WHEN p.avg_pct < 60 THEN 50
                               WHEN p.avg_pct < 70 THEN 60
                               WHEN p.avg_pct < 80 THEN 70
                               WHEN p.avg_pct < 90 THEN 80
                               ELSE 90 END) = v.lo
                    GROUP BY lo, label
                  ) b) AS hist
      ) q
    ),
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'exam_id', m.exam_id, 'title', m.title, 'exam_type', m.exam_type,
               'exam_date', m.exam_date, 'my_pct', round(m.my_pct, 1),
               'obtained', m.obtained, 'out_of', m.out_of, 'is_pass', m.is_pass,
               'class_avg', CASE WHEN pe.n_students >= 3 THEN pe.class_avg END,
               'n_students', COALESCE(pe.n_students, 0)
             ) ORDER BY m.exam_date ASC)
      FROM my_exams m LEFT JOIN per_exam pe ON pe.exam_id = m.exam_id
    ), '[]'::jsonb),
    'subjects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'subject', s.subject, 'student_avg', s.student_avg, 'n_tests', s.n_tests,
               'class_avg',  CASE WHEN c.n_students >= 3 THEN c.class_avg END,
               'class_high', CASE WHEN c.n_students >= 5 THEN c.class_high END,
               'n_students', COALESCE(c.n_students, 0)
             ) ORDER BY (s.student_avg - COALESCE(c.class_avg, s.student_avg)) ASC, s.subject)
      FROM subj s LEFT JOIN subj_cls c USING (subject)
    ), '[]'::jsonb),
    'chapters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'chapter_id', cm.chapter_id, 'chapter', cm.chapter, 'subject', cm.subject,
               'chapter_number', cm.chapter_number,
               'student_avg', cm.student_avg, 'n_tests', cm.n_tests,
               'class_avg', CASE WHEN cc.n_students >= 3 THEN cc.class_avg END,
               'n_students', COALESCE(cc.n_students, 0)
             ) ORDER BY cm.chapter_number NULLS LAST, cm.display_order, cm.chapter)
      FROM chap_mine cm LEFT JOIN chap_cls cc USING (chapter_id)
    ), '[]'::jsonb),
    'attendance', (
      SELECT jsonb_build_object(
        'present', p, 'absent', ab, 'excused', ex, 'holiday', ho,
        'graded_days', p + ab,
        'percentage', CASE WHEN (p + ab) > 0 THEN round(p * 100.0 / (p + ab), 1) END
      ) FROM (
        SELECT count(*) FILTER (WHERE status = 'present')            AS p,
               count(*) FILTER (WHERE status = 'absent')             AS ab,
               count(*) FILTER (WHERE status IN ('sick','casual'))   AS ex,
               (SELECT count(*) FROM hol)                            AS ho
        FROM att
      ) x
    ),
    'engagement', (
      SELECT jsonb_build_object(
        'points', COALESCE(sum(bd.points), 0),
        'badge_count', count(*),
        'badges', COALESCE(jsonb_agg(jsonb_build_object(
                    'name', bd.name, 'icon', bd.icon_name, 'tier', bd.tier,
                    'earned_at', ub.earned_at
                  ) ORDER BY ub.earned_at DESC) FILTER (WHERE bd.id IS NOT NULL), '[]'::jsonb)
      )
      FROM user_badges ub JOIN badge_definitions bd ON bd.id = ub.badge_id
      WHERE ub.user_id = v_uid
    ),
    'coverage', (
      SELECT jsonb_build_object(
        'n_results', (SELECT count(*) FROM my_exams),
        'n_no_subject', (SELECT count(*) FROM my_exams m
                          WHERE NOT EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id = m.exam_id)),
        'n_no_chapter', (SELECT count(*) FROM my_exams m
                          WHERE NOT EXISTS (SELECT 1 FROM exam_topics et WHERE et.exam_id = m.exam_id))
      )
    )
  ) INTO v_out;

  RETURN v_out;
END $$;;


-- Self-serve: unchanged signature and behaviour, now a wrapper.
CREATE OR REPLACE FUNCTION public.student_year_report()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._student_year_report_impl(auth.uid());
END $$;

-- Staff, on behalf of one named student.
CREATE OR REPLACE FUNCTION public.student_year_report_for(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;

  -- Deliberately NOT can_view_student_details: see the header.
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;

  RETURN public._student_year_report_impl(p_student_id);
END $$;

-- Grants (CLAUDE.md §11: BOTH revokes are required - revoking anon alone leaves
-- PUBLIC:EXECUTE behind, and PUBLIC still includes anon).
--
-- The implementation is reachable only via the wrappers.
REVOKE ALL ON FUNCTION public._student_year_report_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_year_report_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._student_year_report_impl(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.student_year_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_year_report() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_year_report() TO authenticated;

REVOKE ALL ON FUNCTION public.student_year_report_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_year_report_for(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_year_report_for(uuid) TO authenticated;
