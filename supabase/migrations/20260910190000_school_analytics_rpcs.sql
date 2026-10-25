-- School Analytics rebuild — server-side aggregation family.
--
-- Supersedes get_school_exam_analytics + the client-side aggregation in
-- src/hooks/useAnalytics.ts (useSchoolAnalytics / useSchoolSectionBreakdown /
-- useProctoringAnalytics). Design: docs/superpowers/specs/2026-09-10-school-analytics-rebuild-design.md
--
-- What these fix, verified against prod on 2026-09-10:
--   * Student/teacher totals came from user_roles, so Salci National read 253
--     students next to the Command Center's 252. Everything here counts through
--     institution_student_ids() (migration 20260905190000).
--   * The proctoring tab fetched EVERY session on the platform (2,914 rows,
--     26,525 events) and filtered client-side, so PostgREST's 1,000-row cap
--     silently truncated it. Salci National owns 38 of those sessions.
--   * Nothing excluded final_results.is_absent (1,176 of 20,826 rows
--     platform-wide), so absentees were averaged in as 0%.
--   * There was no time window at all: every figure mixed every academic year.
--
-- Shape rules that keep two screens from disagreeing:
--   * ONE exam universe per figure. Everything feeding a score or a pipeline
--     step is measured over `ex_scored` (published/active/completed, inside the
--     window, and inside the class filter when one is set). Exam counts that
--     describe the window itself honour the class filter too.
--   * ONE definition of a result: a final_results row reached through
--     student_exam_attempts, excluding is_absent. Absent rows are returned
--     separately, never folded into an average or a "results" count.
--   * ONE banding rule: the overview chart and the drill-down band the SAME
--     rounded average, or the list disagrees with the bar it came from.
--   * Per-exam and per-class figures are pre-aggregated ONCE into a CTE keyed on
--     the id and then joined, never recomputed by a correlated subquery per row.
--     Alliance has 1,376 exams and 19,513 attempts; a correlated subquery over a
--     materialised CTE rescans the whole tuplestore for every outer row.
--
-- Conventions: institution-local "today" via dash_range_window (CLAUDE.md §24),
-- the same exam-date expression as every dash_* RPC, bounded LIMIT/OFFSET paging
-- (§23), REVOKE FROM PUBLIC + FROM anon by name (§26), and search_path pinned to
-- public + pg_temp so a temp table cannot shadow a lookup inside a DEFINER body.

-- ─────────────────────────────────────────────────────────────────────────────
-- Guard: resolve + authorise the institution for the whole family.
-- Mirrors get_school_exam_analytics: a super admin may name any institution, a
-- school admin only their own. Fails closed when auth.uid() is NULL (a NULL
-- comparison would otherwise skip the check — the teacher_roster_student_ids
-- bug of 2026-08-25).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.school_analytics_guard(_institution_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_uid  uuid := (select auth.uid());
  v_inst uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'analytics: not authenticated' USING ERRCODE = '42501';
  END IF;

  v_inst := COALESCE(_institution_id, public.get_user_institution(v_uid));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'analytics: no institution context for this user' USING ERRCODE = '42501';
  END IF;

  IF public.has_role(v_uid, 'super_admin') THEN
    RETURN v_inst;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.institution_id = v_inst
      AND ur.role IN ('school_admin', 'super_school_admin')
  ) THEN
    RETURN v_inst;
  END IF;

  RAISE EXCEPTION 'analytics: not authorized for this institution' USING ERRCODE = '42501';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Overview: window, roster, performance, pipeline, distribution, subjects, trend.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.school_analytics_overview(
  _institution_id uuid DEFAULT NULL,
  _range          text DEFAULT 'ay',
  _class_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_inst   uuid := public.school_analytics_guard(_institution_id);
  v_from   date;
  v_to     date;
  v_span   int;
  v_pfrom  date;
  v_pto    date;
  v_result jsonb;
BEGIN
  -- A foreign class id must error, never return zeroes that read as "no students".
  IF _class_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM classes c WHERE c.id = _class_id AND c.institution_id = v_inst
  ) THEN
    RAISE EXCEPTION 'analytics: class not in institution';
  END IF;

  SELECT w.from_date, w.to_date INTO v_from, v_to
  FROM public.dash_range_window(_range, v_inst) w;

  -- Previous window of equal length, ending the day before this one starts.
  v_span  := GREATEST((v_to - v_from) + 1, 1);
  v_pto   := v_from - 1;
  v_pfrom := v_pto - (v_span - 1);

  WITH ex_all AS (
    SELECT e.id,
           e.title,
           e.exam_type,
           e.status::text AS status,
           e.exam_mode::text AS mode,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
    FROM exams e
    WHERE e.institution_id = v_inst
  ),
  -- The class filter narrows the EXAM UNIVERSE too, not just the attempts.
  -- Without this, picking one class left "Exams held 74" reporting the whole
  -- school beside that class's 8 results.
  ex_win AS (
    SELECT x.* FROM ex_all x
    WHERE x.exam_date BETWEEN v_from AND v_to
      AND (_class_id IS NULL OR EXISTS (
            SELECT 1 FROM exam_classes ec WHERE ec.exam_id = x.id AND ec.class_id = _class_id))
  ),
  -- Only these statuses feed a score. Drafts and archived exams appear in the
  -- window count and never in an average.
  ex_scored AS (
    SELECT * FROM ex_win WHERE status IN ('published', 'active', 'completed')
  ),
  -- Every attempt and result figure is measured over ex_scored, so "papers
  -- submitted" and "results recorded" share one denominator.
  att AS (
    SELECT a.id, a.exam_id, a.student_id, a.class_id, a.is_submitted,
           a.evaluation_status::text AS eval
    FROM student_exam_attempts a
    WHERE a.exam_id IN (SELECT id FROM ex_scored)
      AND (_class_id IS NULL OR a.class_id = _class_id)
  ),
  res AS (
    SELECT f.attempt_id, f.percentage, f.is_pass, f.is_absent,
           a.exam_id, a.student_id, a.class_id
    FROM final_results f
    JOIN att a ON a.id = f.attempt_id
  ),
  -- An absent student has no score; averaging their 0% in is the defect above.
  res_ok AS (
    SELECT * FROM res WHERE NOT is_absent
  ),
  -- One pass over the attempts, keyed on exam. Replaces the correlated EXISTS
  -- pair that rescanned the att and res tuplestores once per exam row.
  per_exam AS (
    SELECT a.exam_id,
           count(*) FILTER (WHERE a.is_submitted)                              AS submitted,
           count(f.attempt_id)                                                 AS results_any,
           count(f.attempt_id) FILTER (WHERE NOT f.is_absent)                  AS results_ok,
           count(*) FILTER (WHERE a.is_submitted AND f.attempt_id IS NULL)     AS no_result,
           count(*) FILTER (WHERE a.is_submitted AND a.eval = 'pending')       AS pending_eval
    FROM att a
    LEFT JOIN final_results f ON f.attempt_id = a.id
    GROUP BY a.exam_id
  ),
  prev_res AS (
    SELECT f.percentage, f.is_pass
    FROM final_results f
    JOIN student_exam_attempts a ON a.id = f.attempt_id
    JOIN ex_all p ON p.id = a.exam_id
    WHERE p.exam_date BETWEEN v_pfrom AND v_pto
      AND p.status IN ('published', 'active', 'completed')
      AND (_class_id IS NULL OR a.class_id = _class_id)
      AND NOT f.is_absent
  ),
  -- ROUNDED on purpose: school_analytics_students bands the same rounded value,
  -- and a student on 34.96 must not be "Under 35%" on the bar while the list
  -- behind that bar files them under "35 to 49%".
  stu AS (
    SELECT student_id, round(avg(percentage), 1) AS avg_pct
    FROM res_ok
    GROUP BY student_id
  ),
  stu_banded AS (
    SELECT student_id,
           CASE WHEN avg_pct < 35 THEN 'lt35'
                WHEN avg_pct < 50 THEN 'b35_49'
                WHEN avg_pct < 70 THEN 'b50_69'
                WHEN avg_pct < 90 THEN 'b70_89'
                ELSE 'b90plus' END AS band
    FROM stu
  ),
  band_counts AS (
    SELECT b.band, b.label, b.ord, count(sb.student_id)::int AS students
    FROM (VALUES
      ('lt35',    'Under 35%',     1),
      ('b35_49',  '35 to 49%',     2),
      ('b50_69',  '50 to 69%',     3),
      ('b70_89',  '70 to 89%',     4),
      ('b90plus', '90% and above', 5)
    ) AS b(band, label, ord)
    LEFT JOIN stu_banded sb ON sb.band = b.band
    GROUP BY b.band, b.label, b.ord
  ),
  -- universal_subjects carries per-grade duplicate rows, so GROUP on the
  -- normalised name but DISPLAY the real one: initcap() mangles acronyms
  -- ("PE" -> "Pe", "IT" -> "It"), which is fine for a key and wrong on screen.
  subj AS (
    SELECT lower(btrim(us.name)) AS subject_key,
           us.name  AS subject_name,
           us.id    AS subject_id,
           r.percentage, r.is_pass, r.exam_id, r.attempt_id
    FROM res_ok r
    JOIN exam_subjects es ON es.exam_id = r.exam_id
    JOIN universal_subjects us ON us.id = es.subject_id
  ),
  subj_agg AS (
    SELECT subject_key,
           mode() WITHIN GROUP (ORDER BY subject_name) AS subject_name,
           mode() WITHIN GROUP (ORDER BY subject_id)   AS subject_id,
           round(avg(percentage), 1) AS avg_pct,
           count(DISTINCT attempt_id)::int AS results,
           count(DISTINCT exam_id)::int AS exams,
           round((count(*) FILTER (WHERE is_pass))::numeric
                 / NULLIF(count(*) FILTER (WHERE is_pass IS NOT NULL), 0) * 100, 1) AS pass_rate
    FROM subj
    GROUP BY subject_key
  ),
  trend_raw AS (
    SELECT e.id AS exam_id, e.title, e.exam_type, e.exam_date,
           round(avg(r.percentage), 1) AS avg_pct,
           count(*)::int AS participation
    FROM res_ok r
    JOIN ex_scored e ON e.id = r.exam_id
    GROUP BY e.id, e.title, e.exam_type, e.exam_date
    ORDER BY e.exam_date DESC, e.title, e.id
    LIMIT 12
  )
  SELECT jsonb_build_object(
    'institution', (
      SELECT jsonb_build_object('id', i.id, 'name', i.name, 'timezone', COALESCE(i.timezone, 'Asia/Kolkata'))
      FROM institutions i WHERE i.id = v_inst
    ),
    'window', jsonb_build_object(
      'range', CASE WHEN _range IN ('tm','1m','3m','6m','ay') THEN _range ELSE '3m' END,
      'from', v_from, 'to', v_to,
      'prev_from', v_pfrom, 'prev_to', v_pto,
      'class_id', _class_id
    ),
    'roster', jsonb_build_object(
      -- For one class the denominator is the union of who is enrolled now and
      -- who actually has a result: a student who moved class after sitting the
      -- paper otherwise makes the tile read "33 of 32".
      'students', CASE
        WHEN _class_id IS NULL THEN public.institution_student_count(v_inst)
        ELSE (SELECT count(*)::int FROM (
                SELECT ca.user_id FROM class_assignments ca
                 WHERE ca.class_id = _class_id AND ca.role = 'student'
                UNION
                SELECT s.student_id FROM stu s
              ) roster)
      END,
      'teachers', (
        SELECT count(DISTINCT ur.user_id)::int
        FROM user_roles ur JOIN profiles p ON p.id = ur.user_id
        WHERE ur.institution_id = v_inst AND ur.role = 'teacher' AND p.is_active IS NOT FALSE
      ),
      'classes', CASE
        WHEN _class_id IS NULL THEN (SELECT count(*)::int FROM classes c
                                     WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE)
        ELSE 1
      END
    ),
    'performance', (
      SELECT jsonb_build_object(
        'results',          (SELECT count(*)::int FROM res_ok),
        -- WHERE the marks came from. 89% of Alliance's are offline papers a
        -- teacher keyed in, which is why 244 students who have never signed in
        -- still hold marks. Without this split, "students assessed" reads as
        -- "students the portal tested" and the figure looks invented.
        'results_online',   (SELECT count(*)::int FROM res_ok r
                              JOIN ex_scored e ON e.id = r.exam_id WHERE e.mode = 'online'),
        'results_offline',  (SELECT count(*)::int FROM res_ok r
                              JOIN ex_scored e ON e.id = r.exam_id WHERE e.mode <> 'online'),
        'absent_results',   (SELECT count(*)::int FROM res WHERE is_absent),
        'students_assessed',(SELECT count(*)::int FROM stu),
        'avg_pct',          (SELECT round(avg(percentage), 1) FROM res_ok),
        'pass_rate',        (SELECT round((count(*) FILTER (WHERE is_pass))::numeric
                                          / NULLIF(count(*) FILTER (WHERE is_pass IS NOT NULL), 0) * 100, 1)
                             FROM res_ok),
        'prev_avg_pct',     (SELECT round(avg(percentage), 1) FROM prev_res),
        'prev_pass_rate',   (SELECT round((count(*) FILTER (WHERE is_pass))::numeric
                                          / NULLIF(count(*) FILTER (WHERE is_pass IS NOT NULL), 0) * 100, 1)
                             FROM prev_res),
        'prev_results',     (SELECT count(*)::int FROM prev_res)
      )
    ),
    'pipeline', jsonb_build_object(
      'exams_in_window',       (SELECT count(*)::int FROM ex_win),
      'exams_draft',           (SELECT count(*)::int FROM ex_win WHERE status = 'draft'),
      'exams_scored',          (SELECT count(*)::int FROM ex_scored),
      'exams_with_results',    (SELECT count(*)::int FROM per_exam WHERE results_any > 0),
      'exams_awaiting_results',(SELECT count(*)::int FROM per_exam WHERE submitted > 0 AND results_any = 0),
      'attempts_submitted',    (SELECT COALESCE(sum(submitted), 0)::int FROM per_exam),
      -- Same definition as performance.results, so the KPI tile and this row can
      -- never print two different numbers under the same word.
      'results_published',     (SELECT COALESCE(sum(results_ok), 0)::int FROM per_exam),
      'awaiting_evaluation',   (SELECT COALESCE(sum(pending_eval), 0)::int FROM per_exam),
      'awaiting_result',       (SELECT COALESCE(sum(no_result), 0)::int FROM per_exam),
      -- Hybrid papers live on a separate data plane (hybrid_* tables) and never
      -- produce a final_results row, so they swell "exams held" while never
      -- contributing a score. Surfaced so the caption can say so.
      'exams_hybrid',          (SELECT count(*)::int FROM ex_scored WHERE mode = 'hybrid'),
      -- A combined paper has one whole-paper score and several subjects, so its
      -- result is attributed to each of them. Surfaced so the subject caption
      -- can admit it rather than implying per-subject marking.
      'multi_subject_exams',   (SELECT count(*)::int FROM (
                                  SELECT es.exam_id FROM exam_subjects es
                                  WHERE es.exam_id IN (SELECT id FROM ex_scored)
                                  GROUP BY es.exam_id HAVING count(*) > 1) m)
    ),
    'distribution', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('band', band, 'label', label, 'students', students) ORDER BY ord)
      FROM band_counts
    ), '[]'::jsonb),
    'subjects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'subject_id', subject_id, 'subject_name', subject_name,
        'avg_pct', avg_pct, 'results', results, 'exams', exams, 'pass_rate', pass_rate
      ) ORDER BY avg_pct ASC, subject_name)
      FROM subj_agg
    ), '[]'::jsonb),
    'trend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exam_id', exam_id, 'title', title, 'exam_type', exam_type,
        'exam_date', exam_date, 'avg_pct', avg_pct, 'participation', participation
      ) ORDER BY exam_date ASC, title)
      FROM trend_raw
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Classes league table.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.school_analytics_classes(
  _institution_id uuid    DEFAULT NULL,
  _range          text    DEFAULT 'ay',
  _assessed_only  boolean DEFAULT true,
  _sort           text    DEFAULT 'avg_asc',
  _class_id       uuid    DEFAULT NULL,
  _limit          int     DEFAULT 25,
  _offset         int     DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_inst  uuid := public.school_analytics_guard(_institution_id);
  v_from  date;
  v_to    date;
  v_lim   int  := LEAST(GREATEST(COALESCE(_limit, 25), 1), 200);
  v_off   int  := GREATEST(COALESCE(_offset, 0), 0);
  v_sort  text := CASE WHEN _sort IN ('avg_asc','avg_desc','name','results_desc') THEN _sort ELSE 'avg_asc' END;
  v_total int;
  v_rows  jsonb;
BEGIN
  IF _class_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM classes c WHERE c.id = _class_id AND c.institution_id = v_inst
  ) THEN
    RAISE EXCEPTION 'analytics: class not in institution';
  END IF;

  SELECT w.from_date, w.to_date INTO v_from, v_to
  FROM public.dash_range_window(_range, v_inst) w;

  WITH ex_scored AS (
    SELECT e.id
    FROM exams e
    WHERE e.institution_id = v_inst
      AND e.status IN ('published', 'active', 'completed')
      AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) BETWEEN v_from AND v_to
  ),
  att AS (
    SELECT a.id, a.class_id, a.student_id, a.is_submitted
    FROM student_exam_attempts a
    WHERE a.exam_id IN (SELECT id FROM ex_scored)
  ),
  -- Everything per class in ONE pass keyed on class_id, instead of three
  -- correlated subqueries per row over a 19k-attempt tuplestore.
  per_class_att AS (
    SELECT a.class_id,
           count(f.attempt_id) FILTER (WHERE NOT f.is_absent)::int              AS results,
           count(DISTINCT a.student_id) FILTER (WHERE f.attempt_id IS NOT NULL
                                                 AND NOT f.is_absent)::int      AS students_assessed,
           count(f.attempt_id) FILTER (WHERE f.is_absent)::int                  AS absent_results,
           round(avg(f.percentage) FILTER (WHERE NOT f.is_absent), 1)           AS avg_pct,
           round((count(*) FILTER (WHERE NOT f.is_absent AND f.is_pass))::numeric
                 / NULLIF(count(*) FILTER (WHERE NOT f.is_absent AND f.is_pass IS NOT NULL), 0) * 100, 1)
                                                                                AS pass_rate,
           count(*) FILTER (WHERE a.is_submitted AND f.attempt_id IS NULL)::int AS awaiting_results
    FROM att a
    LEFT JOIN final_results f ON f.attempt_id = a.id
    GROUP BY a.class_id
  ),
  per_class_roster AS (
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int AS roster
    FROM class_assignments ca
    WHERE ca.role = 'student'
      AND ca.class_id IN (SELECT id FROM classes WHERE institution_id = v_inst)
    GROUP BY ca.class_id
  ),
  flags AS (
    SELECT a.class_id, count(*)::int AS flagged
    FROM proctoring_sessions ps
    JOIN att a ON a.id = ps.attempt_id
    WHERE ps.requires_review
    GROUP BY a.class_id
  ),
  -- Active classes PLUS any class that carries a result in this window even
  -- though it has since been deactivated. Without the second half the sum of
  -- this table silently undershoots the Overview total: at Salci National 12 of
  -- 2,060 results sit in classes that are no longer active.
  scope_class AS (
    SELECT c.id, c.name, c.section, COALESCE(c.is_active, true) AS is_active
    FROM classes c
    WHERE c.institution_id = v_inst
      AND (_class_id IS NULL OR c.id = _class_id)
      AND (c.is_active IS NOT FALSE
           OR EXISTS (SELECT 1 FROM per_class_att pa WHERE pa.class_id = c.id AND pa.results > 0))
  ),
  per_class AS (
    SELECT c.id AS class_id, c.name, c.section, c.is_active,
           COALESCE(r.roster, 0)             AS roster,
           COALESCE(a.results, 0)            AS results,
           COALESCE(a.students_assessed, 0)  AS students_assessed,
           COALESCE(a.absent_results, 0)     AS absent_results,
           a.avg_pct,
           a.pass_rate,
           COALESCE(a.awaiting_results, 0)   AS awaiting_results,
           COALESCE(f.flagged, 0)            AS flagged_sessions
    FROM scope_class c
    LEFT JOIN per_class_att    a ON a.class_id = c.id
    LEFT JOIN per_class_roster r ON r.class_id = c.id
    LEFT JOIN flags            f ON f.class_id = c.id
  ),
  filtered AS (
    SELECT * FROM per_class
    WHERE NOT _assessed_only OR results > 0
  )
  SELECT
    (SELECT count(*)::int FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'class_id', class_id, 'name', name, 'section', section, 'is_active', is_active,
        'roster', roster, 'results', results, 'students_assessed', students_assessed,
        'absent_results', absent_results, 'avg_pct', avg_pct, 'pass_rate', pass_rate,
        'awaiting_results', awaiting_results, 'flagged_sessions', flagged_sessions
      ) ORDER BY ord)
      FROM (
        -- class_id is the unique tiebreaker: two sections can share a name (this
        -- school has two called "Class 12 Science - Non - Medical A"), and
        -- without it a row can repeat on one page and vanish from the next.
        SELECT f.*, row_number() OVER (
          ORDER BY
            CASE WHEN v_sort = 'avg_asc'      THEN f.avg_pct END ASC  NULLS LAST,
            CASE WHEN v_sort = 'avg_desc'     THEN f.avg_pct END DESC NULLS LAST,
            CASE WHEN v_sort = 'results_desc' THEN f.results END DESC NULLS LAST,
            f.name, f.section, f.class_id
        ) AS ord
        FROM filtered f
        ORDER BY ord
        LIMIT v_lim OFFSET v_off
      ) page
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to,
      'range', CASE WHEN _range IN ('tm','1m','3m','6m','ay') THEN _range ELSE '3m' END),
    'rows', v_rows,
    'total', v_total,
    'limit', v_lim,
    'offset', v_off
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Exams in the window, with real participation and outcome.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.school_analytics_exams(
  _institution_id uuid  DEFAULT NULL,
  _range          text  DEFAULT 'ay',
  _filters        jsonb DEFAULT '{}'::jsonb,
  _limit          int   DEFAULT 25,
  _offset         int   DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_inst    uuid := public.school_analytics_guard(_institution_id);
  v_from    date;
  v_to      date;
  v_lim     int  := LEAST(GREATEST(COALESCE(_limit, 25), 1), 200);
  v_off     int  := GREATEST(COALESCE(_offset, 0), 0);
  v_status  text := NULLIF(_filters ->> 'status', '');
  v_class   uuid := NULLIF(_filters ->> 'class_id', '')::uuid;
  v_subject uuid := NULLIF(_filters ->> 'subject_id', '')::uuid;
  v_type    text := NULLIF(_filters ->> 'exam_type', '');
  v_mode    text := NULLIF(_filters ->> 'mode', '');
  v_total   int;
  v_rows    jsonb;
BEGIN
  IF v_class IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM classes c WHERE c.id = v_class AND c.institution_id = v_inst
  ) THEN
    RAISE EXCEPTION 'analytics: class not in institution';
  END IF;

  SELECT w.from_date, w.to_date INTO v_from, v_to
  FROM public.dash_range_window(_range, v_inst) w;

  WITH ex AS (
    SELECT e.id, e.title, e.exam_type, e.status::text AS status, e.exam_mode::text AS mode,
           e.is_results_only, e.total_marks,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
    FROM exams e
    WHERE e.institution_id = v_inst
      AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) BETWEEN v_from AND v_to
      AND (v_status  IS NULL OR e.status::text = v_status)
      AND (v_type    IS NULL OR e.exam_type = v_type)
      AND (v_mode    IS NULL OR e.exam_mode::text = v_mode)
      AND (v_class   IS NULL OR EXISTS (SELECT 1 FROM exam_classes ec WHERE ec.exam_id = e.id AND ec.class_id = v_class))
      AND (v_subject IS NULL OR EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id = e.id AND es.subject_id = v_subject))
  ),
  page AS (
    SELECT * FROM ex ORDER BY exam_date DESC, title, id LIMIT v_lim OFFSET v_off
  ),
  -- One pass over this page's attempts. Nine correlated subqueries per row used
  -- to re-walk final_results four separate times; against the 200-row clamp that
  -- was 1,800 subplans per call. The class filter is applied HERE as well, so a
  -- class-filtered page reports that class's numbers rather than the whole
  -- exam's while listing only that class's exams.
  pa AS (
    SELECT a.exam_id, a.id AS attempt_id, a.student_id, a.is_submitted,
           f.attempt_id AS result_id, f.percentage, f.is_pass, f.is_absent
    FROM student_exam_attempts a
    LEFT JOIN final_results f ON f.attempt_id = a.id
    WHERE a.exam_id IN (SELECT id FROM page)
      AND (v_class IS NULL OR a.class_id = v_class)
  ),
  per_exam AS (
    SELECT exam_id,
           count(*) FILTER (WHERE is_submitted)::int                            AS attempted,
           -- Papers actually written: an absentee has a submitted attempt and an
           -- is_absent result, so counting them as having sat produced
           -- "9 of 9 sat it, 2 absent" on the same line.
           count(*) FILTER (WHERE is_submitted
                              AND COALESCE(is_absent, false) = false)::int      AS sat,
           count(result_id) FILTER (WHERE NOT is_absent)::int                   AS results,
           count(result_id) FILTER (WHERE is_absent)::int                       AS absent,
           round(avg(percentage) FILTER (WHERE NOT is_absent), 1)               AS avg_pct,
           round((count(*) FILTER (WHERE NOT is_absent AND is_pass))::numeric
                 / NULLIF(count(*) FILTER (WHERE NOT is_absent AND is_pass IS NOT NULL), 0) * 100, 1) AS pass_rate
    FROM pa GROUP BY exam_id
  ),
  -- Everyone the exam was meant to reach: the current student roster of its
  -- classes UNION anyone who actually sat it. DISTINCT, because a student in two
  -- of the exam's classes is one student (dash_recent_exams counts rows and
  -- inflates); the union, because a student who has since moved class still sat
  -- the paper. Roster alone produced "9 of 8 sat it" on 8 exams here.
  per_exam_assigned AS (
    SELECT p.id AS exam_id, count(*)::int AS assigned
    FROM page p
    CROSS JOIN LATERAL (
      SELECT ca.user_id
      FROM class_assignments ca
      JOIN exam_classes ec ON ec.class_id = ca.class_id AND ec.exam_id = p.id
      WHERE ca.role = 'student'
        AND (v_class IS NULL OR ca.class_id = v_class)
      UNION
      SELECT a.student_id FROM pa a WHERE a.exam_id = p.id AND a.is_submitted
    ) expected
    GROUP BY p.id
  ),
  per_exam_meta AS (
    SELECT p.id AS exam_id,
           (SELECT string_agg(DISTINCT us.name, ', ')
              FROM exam_subjects es JOIN universal_subjects us ON us.id = es.subject_id
             WHERE es.exam_id = p.id) AS subjects,
           (SELECT string_agg(DISTINCT c.name || COALESCE(' ' || c.section, ''), ', ')
              FROM exam_classes ec JOIN classes c ON c.id = ec.class_id
             WHERE ec.exam_id = p.id) AS classes
    FROM page p
  ),
  per_exam_flags AS (
    SELECT a.exam_id, count(*)::int AS flagged_sessions
    FROM proctoring_sessions ps
    JOIN pa a ON a.attempt_id = ps.attempt_id
    WHERE ps.requires_review
    GROUP BY a.exam_id
  )
  SELECT
    (SELECT count(*)::int FROM ex),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exam_id', p.id,
        'title', p.title,
        'exam_type', p.exam_type,
        'status', p.status,
        'mode', p.mode,
        'is_results_only', p.is_results_only,
        'exam_date', p.exam_date,
        'total_marks', p.total_marks,
        'subjects', m.subjects,
        'classes', m.classes,
        'assigned', COALESCE(g.assigned, 0),
        'attempted', COALESCE(e.attempted, 0),
        'sat', COALESCE(e.sat, 0),
        'results', COALESCE(e.results, 0),
        'absent', COALESCE(e.absent, 0),
        'avg_pct', e.avg_pct,
        'pass_rate', e.pass_rate,
        'flagged_sessions', COALESCE(x.flagged_sessions, 0)
      ) ORDER BY p.exam_date DESC, p.title, p.id)
      FROM page p
      LEFT JOIN per_exam          e ON e.exam_id = p.id
      LEFT JOIN per_exam_assigned g ON g.exam_id = p.id
      LEFT JOIN per_exam_meta     m ON m.exam_id = p.id
      LEFT JOIN per_exam_flags    x ON x.exam_id = p.id
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to,
      'range', CASE WHEN _range IN ('tm','1m','3m','6m','ay') THEN _range ELSE '3m' END),
    'class_id', v_class,
    'rows', v_rows,
    'total', v_total,
    'limit', v_lim,
    'offset', v_off
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Students by average score in the window, optionally narrowed to one band.
-- This is the drill-down behind the distribution chart, so it MUST band students
-- exactly the way school_analytics_overview does: same rounding, same cuts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.school_analytics_students(
  _institution_id uuid DEFAULT NULL,
  _range          text DEFAULT 'ay',
  _class_id       uuid DEFAULT NULL,
  _band           text DEFAULT NULL,
  _limit          int  DEFAULT 50,
  _offset         int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_inst  uuid := public.school_analytics_guard(_institution_id);
  v_from  date;
  v_to    date;
  v_lim   int  := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
  v_off   int  := GREATEST(COALESCE(_offset, 0), 0);
  v_band  text := NULLIF(_band, '');
  v_total int;
  v_rows  jsonb;
BEGIN
  IF _class_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM classes c WHERE c.id = _class_id AND c.institution_id = v_inst
  ) THEN
    RAISE EXCEPTION 'analytics: class not in institution';
  END IF;

  IF v_band IS NOT NULL AND v_band NOT IN ('lt35','b35_49','b50_69','b70_89','b90plus') THEN
    RAISE EXCEPTION 'analytics: unknown score band %', v_band;
  END IF;

  SELECT w.from_date, w.to_date INTO v_from, v_to
  FROM public.dash_range_window(_range, v_inst) w;

  WITH ex_scored AS (
    SELECT e.id
    FROM exams e
    WHERE e.institution_id = v_inst
      AND e.status IN ('published', 'active', 'completed')
      AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) BETWEEN v_from AND v_to
      AND (_class_id IS NULL OR EXISTS (
            SELECT 1 FROM exam_classes ec WHERE ec.exam_id = e.id AND ec.class_id = _class_id))
  ),
  res_ok AS (
    SELECT a.student_id, a.class_id, f.percentage, f.is_pass
    FROM final_results f
    JOIN student_exam_attempts a ON a.id = f.attempt_id
    WHERE a.exam_id IN (SELECT id FROM ex_scored)
      AND NOT f.is_absent
      AND (_class_id IS NULL OR a.class_id = _class_id)
  ),
  stu AS (
    SELECT student_id,
           round(avg(percentage), 1) AS avg_pct,
           count(*)::int AS results,
           round((count(*) FILTER (WHERE is_pass))::numeric
                 / NULLIF(count(*) FILTER (WHERE is_pass IS NOT NULL), 0) * 100, 1) AS pass_rate,
           mode() WITHIN GROUP (ORDER BY class_id) AS class_id
    FROM res_ok
    GROUP BY student_id
  ),
  banded AS (
    SELECT s.*,
           CASE WHEN s.avg_pct < 35 THEN 'lt35'
                WHEN s.avg_pct < 50 THEN 'b35_49'
                WHEN s.avg_pct < 70 THEN 'b50_69'
                WHEN s.avg_pct < 90 THEN 'b70_89'
                ELSE 'b90plus' END AS band
    FROM stu s
  ),
  filtered AS (
    SELECT * FROM banded WHERE v_band IS NULL OR band = v_band
  ),
  page AS (
    SELECT * FROM filtered ORDER BY avg_pct ASC, student_id LIMIT v_lim OFFSET v_off
  )
  SELECT
    (SELECT count(*)::int FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'student_id', pg.student_id,
        'full_name', COALESCE(NULLIF(btrim(p.full_name), ''), 'Unnamed student'),
        'avatar_path', p.avatar_path,
        'class_id', pg.class_id,
        'class_name', c.name,
        'section', c.section,
        'results', pg.results,
        'avg_pct', pg.avg_pct,
        'pass_rate', pg.pass_rate,
        'band', pg.band
      ) ORDER BY pg.avg_pct ASC, p.full_name, pg.student_id)
      FROM page pg
      LEFT JOIN profiles p ON p.id = pg.student_id
      LEFT JOIN classes  c ON c.id = pg.class_id
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to,
      'range', CASE WHEN _range IN ('tm','1m','3m','6m','ay') THEN _range ELSE '3m' END),
    'band', v_band,
    'rows', v_rows,
    'total', v_total,
    'limit', v_lim,
    'offset', v_off
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Integrity (proctoring), aggregated server-side.
-- _platform => true is the super-admin platform-wide view that replaces the
-- unbounded client fetch in useProctoringAnalytics.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.school_analytics_integrity(
  _institution_id uuid    DEFAULT NULL,
  _range          text    DEFAULT '3m',
  _class_id       uuid    DEFAULT NULL,
  _platform       boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_uid      uuid := (select auth.uid());
  v_inst     uuid;
  v_tz       text := 'Asia/Kolkata';
  v_from     date;
  v_to       date;
  v_exact    boolean := true;
  v_result   jsonb;
BEGIN
  IF COALESCE(_platform, false) THEN
    IF v_uid IS NULL OR NOT public.has_role(v_uid, 'super_admin') THEN
      RAISE EXCEPTION 'analytics: platform integrity is super admin only' USING ERRCODE = '42501';
    END IF;
    v_inst := NULL;
    -- With no institution, dash_range_window has no academic year to read, so
    -- 'ay' quietly becomes the trailing twelve months. Report that rather than
    -- letting the label claim an academic year it did not use.
    v_exact := (_range IS DISTINCT FROM 'ay');
  ELSE
    v_inst := public.school_analytics_guard(_institution_id);
    SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM institutions i WHERE i.id = v_inst;

    IF _class_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM classes c WHERE c.id = _class_id AND c.institution_id = v_inst
    ) THEN
      RAISE EXCEPTION 'analytics: class not in institution';
    END IF;
  END IF;

  SELECT w.from_date, w.to_date INTO v_from, v_to
  FROM public.dash_range_window(_range, v_inst) w;

  WITH sess AS (
    SELECT ps.id, ps.requires_review,
           -- review_status is nullable; a NULL would otherwise land in `total`
           -- and in none of the buckets, so the four could not add up.
           COALESCE(ps.review_status, 'pending') AS review_status,
           a.exam_id
    FROM proctoring_sessions ps
    JOIN student_exam_attempts a ON a.id = ps.attempt_id
    JOIN exams e ON e.id = a.exam_id
    WHERE (v_inst IS NULL OR e.institution_id = v_inst)
      AND (v_inst IS NULL OR _class_id IS NULL OR a.class_id = _class_id)
      AND (ps.started_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to
  ),
  ev AS (
    SELECT pe.event_type, pe.severity
    FROM proctoring_events pe
    WHERE pe.session_id IN (SELECT id FROM sess)
  ),
  by_exam AS (
    SELECT s.exam_id,
           count(*)::int AS sessions,
           count(*) FILTER (WHERE s.requires_review)::int AS flagged
    FROM sess s
    GROUP BY s.exam_id
    HAVING count(*) FILTER (WHERE s.requires_review) > 0
    ORDER BY count(*) FILTER (WHERE s.requires_review) DESC, count(*) DESC, s.exam_id
    LIMIT 8
  ),
  by_type AS (
    SELECT event_type, count(*)::int AS events
    FROM ev
    GROUP BY event_type
    ORDER BY count(*) DESC, event_type
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'scope', CASE WHEN v_inst IS NULL THEN 'platform' ELSE 'institution' END,
    'window', jsonb_build_object('from', v_from, 'to', v_to,
      'range', CASE WHEN _range IN ('tm','1m','3m','6m','ay') THEN _range ELSE '3m' END,
      'range_is_exact', v_exact),
    'sessions', (
      SELECT jsonb_build_object(
        'total',           count(*)::int,
        'requires_review', count(*) FILTER (WHERE requires_review)::int,
        -- The CHECK constraint allows exactly these four. The old client counted
        -- 'approved' and 'dismissed', which cannot exist, so those tiles were
        -- always zero and 'cleared'/'flagged' sessions were invisible.
        'pending',         count(*) FILTER (WHERE review_status = 'pending')::int,
        'reviewed',        count(*) FILTER (WHERE review_status = 'reviewed')::int,
        'cleared',         count(*) FILTER (WHERE review_status = 'cleared')::int,
        'flagged',         count(*) FILTER (WHERE review_status = 'flagged')::int,
        -- pending + settled = total, always. "Reviewed or cleared" dropped the
        -- 'flagged' ones, so the tiles did not add up to the sessions recorded.
        'settled',         count(*) FILTER (WHERE review_status <> 'pending')::int
      ) FROM sess
    ),
    'severity', (
      SELECT jsonb_build_object(
        'high',   count(*) FILTER (WHERE severity = 'high')::int,
        'medium', count(*) FILTER (WHERE severity = 'medium')::int,
        'low',    count(*) FILTER (WHERE severity = 'low')::int,
        'total',  count(*)::int
      ) FROM ev
    ),
    'event_types', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'events', events) ORDER BY events DESC, event_type)
      FROM by_type
    ), '[]'::jsonb),
    -- How much the two top-8 lists are hiding, so neither is presented as the
    -- whole picture when it is not.
    'event_types_total', (SELECT count(DISTINCT event_type)::int FROM ev),
    'exams_total', (SELECT count(*)::int FROM (
                      SELECT s.exam_id FROM sess s GROUP BY s.exam_id
                      HAVING count(*) FILTER (WHERE s.requires_review) > 0) t),
    'exams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exam_id', b.exam_id,
        'title', e.title,
        'institution_name', CASE WHEN v_inst IS NULL THEN i.name ELSE NULL END,
        'exam_date', COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date),
        'sessions', b.sessions,
        'flagged', b.flagged,
        'flag_rate', round(b.flagged::numeric / NULLIF(b.sessions, 0) * 100, 1)
      ) ORDER BY b.flagged DESC, b.sessions DESC)
      FROM by_exam b
      JOIN exams e ON e.id = b.exam_id
      LEFT JOIN institutions i ON i.id = e.institution_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants. Supabase's ALTER DEFAULT PRIVILEGES hands anon EXECUTE on every new
-- public function and REVOKE FROM PUBLIC does not strip it, so both revokes are
-- required, by name (CLAUDE.md §26).
-- ─────────────────────────────────────────────────────────────────────────────
DO $grants$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.school_analytics_guard(uuid)',
    'public.school_analytics_overview(uuid, text, uuid)',
    'public.school_analytics_classes(uuid, text, boolean, text, uuid, integer, integer)',
    'public.school_analytics_exams(uuid, text, jsonb, integer, integer)',
    'public.school_analytics_students(uuid, text, uuid, text, integer, integer)',
    'public.school_analytics_integrity(uuid, text, uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
  END LOOP;
END
$grants$;

-- The superseded RPC shipped without either revoke; close it while we are here.
-- It stays in place for one release, then can be dropped.
REVOKE ALL ON FUNCTION public.get_school_exam_analytics(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_school_exam_analytics(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_school_exam_analytics(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: every function exists and none is executable by anon or PUBLIC.
-- ─────────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_name text;
  v_oid  oid;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'school_analytics_guard', 'school_analytics_overview', 'school_analytics_classes',
    'school_analytics_exams', 'school_analytics_students', 'school_analytics_integrity',
    'get_school_exam_analytics'
  ] LOOP
    SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
    LIMIT 1;

    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'verify: public.% is missing', v_name;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'verify: anon can still EXECUTE public.%', v_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'verify: PUBLIC can still EXECUTE public.%', v_name;
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'verify: authenticated cannot EXECUTE public.%', v_name;
    END IF;
  END LOOP;
END
$verify$;
