-- Student dashboard "Attendance" card — range-filtered attendance summary.
-- Additive: new read-only SECURITY DEFINER RPC. useStudentMonthAttendance() is untouched
-- (the status-strip tile, the attendance page calendar and StudentAttendanceWidget all
-- still use it for the single-month pivot).
--
-- Server-side aggregation is deliberate (§23): a 6-month or academic-year window would
-- otherwise pull every attendance row to the browser just to count them.
--
-- Semantics mirror useStudentMonthAttendance exactly so the card and the attendance page
-- never disagree:
--   * a school holiday (cal_events.kind='holiday') OVERRIDES whatever was marked that day,
--   * percentage = present / (present + absent); sick, casual and holiday are excluded
--     from the denominator (excused or off), and it is NULL when nothing is graded yet.
-- "Today" is institution-local per §24, and the window never runs past today.

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
  v_range := CASE WHEN p_range IN ('1m','3m','6m','ay') THEN p_range ELSE '1m' END;

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

GRANT EXECUTE ON FUNCTION public.student_attendance_summary(text) TO authenticated;
