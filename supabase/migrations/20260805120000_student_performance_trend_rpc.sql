-- Student dashboard "Performance trend" — subject + time-range filtered trend.
-- Additive: new read-only SECURITY DEFINER RPC. The existing student_score_trend(p_limit)
-- stays untouched (StudentStatusStrip's "average of last 5 tests" tile still uses it).
--
-- Returns, in ONE payload: the subject options for the dropdown (all-time, so narrowing the
-- time range never empties the picker) and the filtered chart points.
--
-- Per-subject semantics (matches the rest of the platform — My Results "Subject trajectory",
-- student_subject_class_comparison, dash_subject_performance): there is NO per-subject mark
-- anywhere in the schema (final_results carries ONE percentage per exam; offline_student_marks
-- is per exam+student with no subject_id). A subject filter therefore selects the EXAMS that
-- included that subject and plots those exams' percentages. With no subject selected ("All"),
-- every published result in the window is plotted — one point per exam.
--
-- Multi-subject exams must NOT fan out (that would double-count a single result), so the
-- subject filter is an EXISTS predicate, never a join — same reasoning as student_score_trend.
--
-- Subject identity is the normalised name initcap(lower(btrim(name))), NOT subject_id:
-- universal_subjects holds per-grade duplicates of the same subject, so ids would show
-- "English" twice in the picker. This mirrors student_subject_class_comparison.
--
-- "Today" is institution-local per CLAUDE.md §24 — never a bare CURRENT_DATE.

CREATE OR REPLACE FUNCTION public.student_performance_trend(
  p_subject text DEFAULT NULL,          -- normalised subject name; NULL/'' = All subjects
  p_range   text DEFAULT '3m'           -- '1m' | '3m' | '6m' | 'ay' (current academic year)
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_tz text;
  v_today date;
  v_range text;
  v_subject text;
  v_from date;
  v_to date;                            -- NULL = open-ended (relative windows)
  v_ay_code text; v_ay_start date; v_ay_end date;
  v_subjects jsonb;
  v_points jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Validate inputs (an unknown range falls back to the default rather than raising).
  v_range := CASE WHEN p_range IN ('1m','3m','6m','ay') THEN p_range ELSE '3m' END;
  v_subject := NULLIF(btrim(COALESCE(p_subject, '')), '');
  IF v_subject IS NOT NULL THEN
    v_subject := initcap(lower(v_subject));
  END IF;

  v_inst := public.get_user_institution(v_uid);
  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  IF v_range = 'ay' THEN
    SELECT ay.code, ay.starts_on, ay.ends_on
      INTO v_ay_code, v_ay_start, v_ay_end
    FROM cal_academic_years ay
    WHERE ay.institution_id = v_inst
    ORDER BY (v_today BETWEEN ay.starts_on AND ay.ends_on) DESC, ay.is_active DESC, ay.starts_on DESC
    LIMIT 1;
    v_from := COALESCE(v_ay_start, (v_today - INTERVAL '1 year')::date);
    v_to   := COALESCE(v_ay_end, v_today);
  ELSE
    v_from := (v_today - (CASE v_range
                            WHEN '1m' THEN INTERVAL '1 month'
                            WHEN '6m' THEN INTERVAL '6 months'
                            ELSE INTERVAL '3 months' END))::date;
    v_to := NULL;  -- no upper bound, so a result dated today always lands in the window
  END IF;

  -- Subject options: every subject the student has a published result in, ALL-TIME.
  SELECT COALESCE(jsonb_agg(t.s ORDER BY t.s), '[]'::jsonb)
    INTO v_subjects
  FROM (
    SELECT DISTINCT initcap(lower(btrim(us.name))) AS s
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE a.student_id = v_uid AND fr.is_published = true
      AND btrim(COALESCE(us.name, '')) <> ''
  ) t;

  -- Chart points: one row per published result in the window (never fanned out by subject).
  WITH mine AS (
    SELECT e.id AS exam_id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date,
                    a.submitted_at::date, fr.created_at::date) AS exam_date,
           fr.percentage,
           COALESCE(fr.published_at, fr.finalized_at, fr.created_at) AS ord
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE a.student_id = v_uid AND fr.is_published = true
  ),
  filtered AS (
    SELECT m.*
    FROM mine m
    WHERE m.exam_date >= v_from
      AND (v_to IS NULL OR m.exam_date <= v_to)
      AND (v_subject IS NULL OR EXISTS (
             SELECT 1
             FROM exam_subjects es
             JOIN universal_subjects us ON us.id = es.subject_id
             WHERE es.exam_id = m.exam_id
               AND initcap(lower(btrim(us.name))) = v_subject))
    ORDER BY m.ord DESC
    LIMIT 100                            -- bounded (§23); a term rarely exceeds a few dozen tests
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'exam_id', f.exam_id,
           'title', f.title,
           'exam_type', f.exam_type,
           'exam_date', f.exam_date,
           'percentage', f.percentage
         ) ORDER BY f.ord ASC), '[]'::jsonb)
    INTO v_points
  FROM filtered f;

  RETURN jsonb_build_object(
    'has_data', jsonb_array_length(v_points) > 0,
    'range', v_range,
    'subject', v_subject,
    'academic_year', v_ay_code,
    'from', to_char(v_from, 'YYYY-MM-DD'),
    'to', CASE WHEN v_to IS NULL THEN NULL ELSE to_char(v_to, 'YYYY-MM-DD') END,
    'subjects', v_subjects,
    'points', v_points
  );
END $$;

GRANT EXECUTE ON FUNCTION public.student_performance_trend(text, text) TO authenticated;
