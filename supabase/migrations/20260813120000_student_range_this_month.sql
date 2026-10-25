-- Student dashboard time pickers — add a "This month" ('tm') window.
--
-- Both RPCs previously offered only trailing windows ('1m'/'3m'/'6m') plus the
-- academic year. That left the Attendance card unable to show the SAME window as
-- the "Attendance this month" tile above it, so the two could legitimately read
-- 100% and 50% side by side and look broken to a parent.
--
-- 'tm' = the 1st of the current month through today, both institution-local
-- (§24) because v_today is already computed AT TIME ZONE the institution's
-- timezone — a bare CURRENT_DATE here would reintroduce the UTC bug class.
--
-- Additive and backwards compatible: every existing range keeps its exact
-- semantics and an unknown p_range still falls back to the old default rather
-- than raising. Both bodies below are the 20260805130000 / 20260805120000
-- definitions VERBATIM apart from the range validation and the new ELSIF.
-- Rollback = re-apply those two migrations.

-- ── Attendance summary (was 20260805130000) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.student_attendance_summary(p_range text DEFAULT '1m')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_tz text;
  v_today date;
  v_range text;
  v_from date;
  v_to date;
  v_ay_code text; v_ay_start date; v_ay_end date;
  v_present int; v_absent int; v_excused int; v_holiday int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_range := CASE WHEN p_range IN ('tm','1m','3m','6m','ay') THEN p_range ELSE '1m' END;

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
    v_to   := LEAST(COALESCE(v_ay_end, v_today), v_today);
  ELSIF v_range = 'tm' THEN
    -- Calendar month to date: the same window the status-strip tile counts.
    v_from := date_trunc('month', v_today)::date;
    v_to   := v_today;
  ELSE
    v_from := (v_today - (CASE v_range
                            WHEN '3m' THEN INTERVAL '3 months'
                            WHEN '6m' THEN INTERVAL '6 months'
                            ELSE INTERVAL '1 month' END))::date;
    v_to := v_today;
  END IF;

  WITH hol AS (
    -- Every holiday DAY inside the window (multi-day holidays expanded).
    SELECT DISTINCT d::date AS day
    FROM cal_events ce
    CROSS JOIN LATERAL generate_series(ce.starts_on::date, ce.ends_on::date, INTERVAL '1 day') d
    WHERE ce.institution_id = v_inst
      AND ce.kind = 'holiday'
      AND ce.starts_on::date <= v_to
      AND ce.ends_on::date >= v_from
      AND d::date BETWEEN v_from AND v_to
  ),
  eff AS (
    SELECT CASE WHEN h.day IS NOT NULL THEN 'holiday' ELSE ar.status END AS status
    FROM attendance_records ar
    LEFT JOIN hol h ON h.day = ar.date
    WHERE ar.student_id = v_uid
      AND ar.date BETWEEN v_from AND v_to
  )
  SELECT count(*) FILTER (WHERE status = 'present'),
         count(*) FILTER (WHERE status = 'absent'),
         count(*) FILTER (WHERE status IN ('sick','casual')),
         (SELECT count(*) FROM hol)
    INTO v_present, v_absent, v_excused, v_holiday
  FROM eff;

  v_present := COALESCE(v_present, 0);
  v_absent  := COALESCE(v_absent, 0);
  v_excused := COALESCE(v_excused, 0);
  v_holiday := COALESCE(v_holiday, 0);

  RETURN jsonb_build_object(
    'range', v_range,
    'from', to_char(v_from, 'YYYY-MM-DD'),
    'to', to_char(v_to, 'YYYY-MM-DD'),
    'academic_year', v_ay_code,
    'present', v_present,
    'absent', v_absent,
    'excused', v_excused,
    'holiday', v_holiday,
    'graded_days', v_present + v_absent,
    'percentage', CASE WHEN (v_present + v_absent) > 0
                       THEN round(v_present * 100.0 / (v_present + v_absent), 1) END
  );
END $$;

-- ── Performance trend (was 20260805120000) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.student_performance_trend(
  p_subject text DEFAULT NULL,          -- normalised subject name; NULL/'' = All subjects
  p_range   text DEFAULT '3m'           -- 'tm' | '1m' | '3m' | '6m' | 'ay'
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
  v_range := CASE WHEN p_range IN ('tm','1m','3m','6m','ay') THEN p_range ELSE '3m' END;
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
  ELSIF v_range = 'tm' THEN
    -- Calendar month to date. v_to stays NULL like the other relative windows
    -- so a result dated today always lands inside the window.
    v_from := date_trunc('month', v_today)::date;
    v_to   := NULL;
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

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on public
-- functions and REVOKE FROM PUBLIC does not strip it. Both of these read a
-- student's own attendance/results, so revoke by name and re-grant explicitly.
REVOKE EXECUTE ON FUNCTION public.student_attendance_summary(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.student_performance_trend(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_attendance_summary(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_performance_trend(text, text) TO authenticated;
