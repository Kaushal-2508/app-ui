-- Teacher dashboard — Phase 3: spec 2.5, 2.6, 2.7, 2.8
--
-- All five functions aggregate server-side and resolve scope through
-- dash_resolve_scoped_pairs() (Phase 1). No client-side filtering is used as a
-- security boundary anywhere.
--
-- SOURCE SUBSTITUTION, stated plainly
-- -----------------------------------
-- Spec 2.5 named concept_mastery + student_topic_performance. Both hold ZERO
-- rows in prod and nothing anywhere writes to either (verified 2026-08-18), so
-- a literal build renders a permanently empty card. Weak chapters are computed
-- instead from exam_questions.tags (6,977 of 8,602 questions tagged) joined
-- through teacher_overrides -> student_answers -> attempts -> exams, restricted
-- to exams the teacher CREATED. That is live, current, and genuinely their own.
--
-- Spec 2.8 asked for no "on track / behind schedule" language, because no
-- per-chapter due date exists. dash_teacher_syllabus_coverage returns coverage %
-- and the age of the last log only. Do not add pacing language without real
-- target dates.

-- ===========================================================================
-- A. student_activity_daily — the login/activity spine for spec 2.7
--
-- auth.users.last_sign_in_at is last-only and misses token refresh, so it
-- undercounts daily-active badly. auth.refresh_tokens is the real daily signal
-- and backfills ~7 months. Neither is client-queryable, hence this rollup.
--
-- Deliberately a SEPARATE table, not an activity_type on user_activity_log:
-- student_streak() and the badge evaluator scan user_activity_log WITHOUT an
-- activity_type filter, so adding 'login' there would silently inflate every
-- shipped student streak badge.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.student_activity_daily (
  student_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  activity_date  date NOT NULL,
  source         text NOT NULL DEFAULT 'refresh_token',
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, activity_date)
);

-- Every FK indexed in the same migration (§23).
CREATE INDEX IF NOT EXISTS student_activity_daily_inst_date_idx
  ON public.student_activity_daily (institution_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS student_activity_daily_date_idx
  ON public.student_activity_daily (activity_date DESC);

ALTER TABLE public.student_activity_daily ENABLE ROW LEVEL SECURITY;

-- No teacher-facing policy: teachers read this ONLY through the aggregate RPC
-- below, which never returns a student-level activity row.
DROP POLICY IF EXISTS student_activity_daily_self ON public.student_activity_daily;
CREATE POLICY student_activity_daily_self ON public.student_activity_daily
  FOR SELECT USING (student_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.student_activity_daily FROM anon;

CREATE OR REPLACE FUNCTION public.snapshot_student_activity_daily(_days integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.student_activity_daily (student_id, institution_id, activity_date, source)
  -- auth.refresh_tokens.user_id is character varying, NOT uuid (Supabase quirk),
  -- so the join to profiles must cast or it fails with a type mismatch.
  SELECT DISTINCT rt.user_id::uuid, p.institution_id, (rt.updated_at)::date, 'refresh_token'
    FROM auth.refresh_tokens rt
    JOIN public.profiles p ON p.id = rt.user_id::uuid
    JOIN public.user_roles ur ON ur.user_id = rt.user_id::uuid AND ur.role = 'student'
   WHERE rt.updated_at >= (now() - make_interval(days => _days))
     AND rt.user_id IS NOT NULL
  ON CONFLICT (student_id, activity_date) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.snapshot_student_activity_daily(integer) FROM PUBLIC, anon, authenticated;

-- Backfill everything auth.refresh_tokens still holds (~7 months), then keep it
-- warm daily at 00:20 — before the 00:30 and 00:45 badge jobs.
SELECT public.snapshot_student_activity_daily(400);

SELECT cron.schedule('student-activity-daily', '20 0 * * *',
                     'SELECT public.snapshot_student_activity_daily(3);')
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'student-activity-daily');

-- ===========================================================================
-- B. Spec 2.5 — weak chapters across every subject the teacher teaches
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.dash_teacher_weak_chapters(p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);   -- clamp: no caller-widened window

  WITH graded AS (
    SELECT lower(btrim(t.tag))          AS tag,
           us.name                      AS subject_name,
           a.student_id,
           tov.final_marks::numeric     AS got,
           tov.max_marks::numeric       AS possible
      FROM teacher_overrides tov
      JOIN student_answers sa            ON sa.id = tov.answer_id
      JOIN student_exam_attempts a       ON a.id = sa.attempt_id
      JOIN exam_questions q              ON q.id = sa.question_id
      JOIN exam_sections sec             ON sec.id = q.section_id
      JOIN exams e                       ON e.id = sec.exam_id AND e.created_by = v_uid
      JOIN exam_subjects esx             ON esx.exam_id = e.id
      JOIN universal_subjects us         ON us.id = esx.subject_id
      CROSS JOIN LATERAL unnest(COALESCE(q.tags, ARRAY[]::text[])) AS t(tag)
     WHERE tov.max_marks > 0 AND btrim(COALESCE(t.tag,'')) <> ''
  ),
  per_student AS (
    SELECT tag, subject_name, student_id,
           sum(got) / NULLIF(sum(possible), 0) * 100 AS pct
      FROM graded GROUP BY tag, subject_name, student_id
  ),
  per_tag AS (
    SELECT tag, subject_name,
           round(avg(pct), 1)                                    AS mastery_pct,
           count(*)                                              AS students,
           count(*) FILTER (WHERE pct < 50)                      AS below_50
      FROM per_student GROUP BY tag, subject_name
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY mastery_pct ASC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'tag',          tag,
             'subject_name', subject_name,
             'mastery_pct',  mastery_pct,
             'students',     students,
             'below_50',     below_50
           ) AS x, mastery_pct
      FROM per_tag
     -- Minimum evidence: a "weak chapter" off 2 responses is noise, not a signal.
     WHERE students >= 5 AND mastery_pct < 70
     ORDER BY mastery_pct ASC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'chapters', v_rows);
END $function$;

-- ===========================================================================
-- C. Spec 2.6 — students who need attention, ONE unified list
--
-- Four independent signals; severity is how many are true, not which.
--   HIGH   >= 3 signals   MEDIUM = 2   WATCH = 1
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.dash_teacher_students_attention(p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_pc uuid[]; v_ps uuid[]; v_classes uuid[]; v_rows jsonb;
  v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_scoped_pairs() p;
  IF v_pc IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'students', '[]'::jsonb);
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_classes FROM unnest(v_pc) AS x;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH roster AS (
    SELECT DISTINCT ca.user_id AS student_id, ca.class_id
      FROM class_assignments ca
     WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes)
       AND ca.user_id IN (SELECT r.student_id
                            FROM public.teacher_roster_student_ids(v_uid, v_classes) r)
  ),
  -- Signal 1: performance band, restricted to the teacher's own (class,subject).
  perf AS (
    SELECT a.student_id, round(avg(fr.percentage), 1) AS pct
      FROM student_exam_attempts a
      JOIN final_results fr ON fr.attempt_id = a.id
      JOIN exams e  ON e.id = a.exam_id AND e.institution_id = v_inst
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE EXISTS (SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
                    WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id))
     GROUP BY a.student_id
  ),
  -- Signal 2: attendance in the teacher's own classes, last 30 days.
  att AS (
    SELECT ar.student_id,
           round(count(*) FILTER (WHERE ar.status IN ('present','late')) * 100.0
                 / NULLIF(count(*), 0), 0) AS pct
      FROM attendance_records ar
     WHERE ar.class_id = ANY(v_classes) AND ar.date > v_today - 30
     GROUP BY ar.student_id
  ),
  -- Signal 3: homework non-submission over the teacher's trailing 5 assignments.
  hw_recent AS (
    SELECT h.id, hac.class_id,
           row_number() OVER (PARTITION BY hac.class_id ORDER BY h.due_at DESC NULLS LAST, h.created_at DESC) AS rn
      FROM homework_assignments h
      JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
     WHERE h.created_by = v_uid AND hac.class_id = ANY(v_classes)
  ),
  hw AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE s.id IS NULL) AS missed,
           count(*)                             AS expected
      FROM roster r
      JOIN hw_recent hr ON hr.class_id = r.class_id AND hr.rn <= 5
      LEFT JOIN homework_submissions s
             ON s.homework_assignment_id = hr.id AND s.student_id = r.student_id
     GROUP BY r.student_id
  ),
  -- Signal 4: test non-attempt over the teacher's trailing 3 exams.
  ex_recent AS (
    SELECT e.id, ec.class_id,
           row_number() OVER (PARTITION BY ec.class_id
                              ORDER BY COALESCE(e.scheduled_date, e.created_at::date) DESC) AS rn
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.created_by = v_uid AND ec.class_id = ANY(v_classes)
       AND e.status IN ('published','active','completed')
  ),
  ex AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE a.id IS NULL) AS skipped,
           count(*)                             AS expected
      FROM roster r
      JOIN ex_recent er ON er.class_id = r.class_id AND er.rn <= 3
      LEFT JOIN student_exam_attempts a
             ON a.exam_id = er.id AND a.student_id = r.student_id
     GROUP BY r.student_id
  ),
  scored AS (
    SELECT r.student_id, r.class_id,
           (perf.pct IS NOT NULL AND perf.pct < 50)                       AS s_perf,
           (att.pct  IS NOT NULL AND att.pct  < 75)                       AS s_att,
           (COALESCE(hw.missed, 0) >= 2)                                  AS s_hw,
           (COALESCE(ex.skipped, 0) >= 1)                                 AS s_ex,
           perf.pct AS perf_pct, att.pct AS att_pct,
           hw.missed, hw.expected AS hw_expected,
           ex.skipped, ex.expected AS ex_expected
      FROM roster r
      LEFT JOIN perf ON perf.student_id = r.student_id
      LEFT JOIN att  ON att.student_id  = r.student_id
      LEFT JOIN hw   ON hw.student_id   = r.student_id
      LEFT JOIN ex   ON ex.student_id   = r.student_id
  ),
  ranked AS (
    SELECT s.*,
           (s_perf::int + s_att::int + s_hw::int + s_ex::int) AS signals
      FROM scored s
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY signals DESC, COALESCE(perf_pct, 100) ASC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'student_id',   rk.student_id,
             'student_name', (SELECT pf.full_name FROM profiles pf WHERE pf.id = rk.student_id),
             'class_id',     rk.class_id,
             'class_name',   c.name,
             'section',      c.section,
             'severity',     CASE WHEN rk.signals >= 3 THEN 'high'
                                  WHEN rk.signals = 2  THEN 'medium'
                                  ELSE 'watch' END,
             'reasons',      (
               SELECT jsonb_agg(z) FROM (
                 SELECT 'Scoring ' || rk.perf_pct || '% in your subject' AS z WHERE rk.s_perf
                 UNION ALL
                 SELECT 'Attendance ' || rk.att_pct || '% in your classes' WHERE rk.s_att
                 UNION ALL
                 SELECT 'Missed ' || rk.missed || ' of ' || rk.hw_expected || ' homework' WHERE rk.s_hw
                 UNION ALL
                 SELECT 'Skipped ' || rk.skipped || ' of ' || rk.ex_expected || ' tests' WHERE rk.s_ex
               ) r2(z))
           ) AS x, rk.signals, rk.perf_pct
      FROM ranked rk
      JOIN classes c ON c.id = rk.class_id
     WHERE rk.signals > 0
     ORDER BY rk.signals DESC, COALESCE(rk.perf_pct, 100) ASC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'students', v_rows);
END $function$;

-- ===========================================================================
-- D. Spec 2.7 — portal adoption for the teacher's own students
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.dash_teacher_portal_adoption()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid; v_classes uuid[];
  v_tz text; v_today date; v_total int;
  v_never int; v_never_names text[];
  v_today_n int; v_yday_n int; v_7 numeric; v_30 numeric;
  v_spark jsonb; v_hw_pct numeric; v_ex_pct numeric; v_roster uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('has_data', false);
  END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  -- An array, not a temp table: CREATE TEMP TABLE is a write and Postgres
  -- forbids it inside a STABLE function.
  SELECT array_agg(DISTINCT r.student_id) INTO v_roster
    FROM public.teacher_roster_student_ids(v_uid, v_classes) r;
  v_roster := COALESCE(v_roster, ARRAY[]::uuid[]);

  v_total := array_length(v_roster, 1);
  v_total := COALESCE(v_total, 0);
  IF v_total = 0 THEN RETURN jsonb_build_object('has_data', false); END IF;

  -- Never opened the portal at all. auth.users is read here under DEFINER and
  -- never returned row-wise: only a count and at most three display names.
  SELECT count(*) INTO v_never
    FROM auth.users u
   WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL;

  SELECT array_agg(nm) INTO v_never_names FROM (
    SELECT (SELECT pf.full_name FROM profiles pf WHERE pf.id = u.id) AS nm
      FROM auth.users u
     WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL
     ORDER BY 1 LIMIT 3) s;

  SELECT count(*) INTO v_today_n FROM student_activity_daily d
    WHERE d.student_id = ANY(v_roster) AND d.activity_date = v_today;
  SELECT count(*) INTO v_yday_n FROM student_activity_daily d
    WHERE d.student_id = ANY(v_roster) AND d.activity_date = v_today - 1;

  SELECT round(count(*)::numeric / 7, 1) INTO v_7 FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster) AND d.activity_date > v_today - 7 AND d.activity_date <= v_today;
  SELECT round(count(*)::numeric / 30, 1) INTO v_30 FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster) AND d.activity_date > v_today - 30 AND d.activity_date <= v_today;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', g.day, 'n', COALESCE(c.n, 0)) ORDER BY g.day), '[]'::jsonb)
    INTO v_spark
    FROM generate_series(v_today - 13, v_today, INTERVAL '1 day') AS g(day)
    LEFT JOIN (
      SELECT d.activity_date, count(*) AS n
        FROM student_activity_daily d
       WHERE d.student_id = ANY(v_roster) AND d.activity_date > v_today - 14
       GROUP BY d.activity_date) c ON c.activity_date = g.day::date;

  -- Engagement: what they DO once inside, on this teacher's own work.
  SELECT round(count(*) FILTER (WHERE s.id IS NOT NULL) * 100.0 / NULLIF(count(*), 0), 0)
    INTO v_hw_pct
    FROM homework_assignments h
    JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
                                        AND hac.class_id = ANY(v_classes)
    CROSS JOIN LATERAL unnest(v_roster) AS t(student_id)
    LEFT JOIN homework_submissions s ON s.homework_assignment_id = h.id AND s.student_id = t.student_id
   WHERE h.created_by = v_uid;

  SELECT round(count(*) FILTER (WHERE a.id IS NOT NULL) * 100.0 / NULLIF(count(*), 0), 0)
    INTO v_ex_pct
    FROM exams e
    JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ANY(v_classes)
    CROSS JOIN LATERAL unnest(v_roster) AS t(student_id)
    LEFT JOIN student_exam_attempts a ON a.exam_id = e.id AND a.student_id = t.student_id
   WHERE e.created_by = v_uid AND e.status IN ('published','active','completed');

  RETURN jsonb_build_object(
    'has_data', true,
    'total_students', v_total,
    'never_logged_in', jsonb_build_object('count', COALESCE(v_never,0),
                                          'names', COALESCE(to_jsonb(v_never_names), '[]'::jsonb)),
    'today',     jsonb_build_object('n', v_today_n, 'pct', round(v_today_n * 100.0 / v_total, 0)),
    'yesterday', jsonb_build_object('n', v_yday_n,  'pct', round(v_yday_n  * 100.0 / v_total, 0)),
    'avg_7',     jsonb_build_object('n', v_7,  'pct', round(v_7  * 100.0 / v_total, 0)),
    'avg_30',    jsonb_build_object('n', v_30, 'pct', round(v_30 * 100.0 / v_total, 0)),
    'sparkline', v_spark,
    'engagement', jsonb_build_object('homework_pct', v_hw_pct, 'tests_pct', v_ex_pct));
END $function$;

-- ===========================================================================
-- E. Spec 2.8 — syllabus coverage. Coverage + recency ONLY, no pacing language.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.dash_teacher_syllabus_coverage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_inst uuid; v_rows jsonb; v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);
  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH pairs AS (
    SELECT DISTINCT p.class_id, p.subject_id
      FROM public.dash_resolve_scoped_pairs() p WHERE p.subject_id IS NOT NULL
  ),
  totals AS (
    SELECT pr.class_id, pr.subject_id,
           (SELECT count(*) FROM syllabus_topics st
             WHERE st.subject_id = pr.subject_id AND COALESCE(st.is_active, true)) AS total_chapters
      FROM pairs pr
  ),
  done AS (
    SELECT spe.class_id, spe.subject_id,
           count(DISTINCT spe.topic_id) FILTER (WHERE spe.action = 'completed') AS done_chapters,
           max(spe.date) AS last_logged_on
      FROM syllabus_progress_events spe
     WHERE spe.institution_id = v_inst
     GROUP BY spe.class_id, spe.subject_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'class_id',       t.class_id,
           'class_name',     c.name,
           'section',        c.section,
           'subject_id',     t.subject_id,
           'subject_name',   us.name,
           'total_chapters', t.total_chapters,
           'done_chapters',  COALESCE(d.done_chapters, 0),
           'coverage_pct',   CASE WHEN t.total_chapters > 0
                                  THEN round(COALESCE(d.done_chapters,0) * 100.0 / t.total_chapters, 0)
                             END,
           'last_logged_on', d.last_logged_on,
           -- Recency, NOT pacing: there is no per-chapter due date to judge against.
           'days_since_log', CASE WHEN d.last_logged_on IS NOT NULL
                                  THEN (v_today - d.last_logged_on) END
         ) ORDER BY us.name, c.name), '[]'::jsonb) INTO v_rows
    FROM totals t
    JOIN classes c ON c.id = t.class_id
    JOIN universal_subjects us ON us.id = t.subject_id
    LEFT JOIN done d ON d.class_id = t.class_id AND d.subject_id = t.subject_id;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $function$;

-- ===========================================================================
-- F. Grants — anon revoked BY NAME (CLAUDE.md §11)
-- ===========================================================================
REVOKE ALL ON FUNCTION public.dash_teacher_weak_chapters(integer)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dash_teacher_students_attention(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dash_teacher_portal_adoption()           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dash_teacher_syllabus_coverage()         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dash_teacher_weak_chapters(integer)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teacher_students_attention(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teacher_portal_adoption()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teacher_syllabus_coverage()         TO authenticated;
