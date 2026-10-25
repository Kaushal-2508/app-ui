-- Dashboard rebuild Phase 1 — Task 5
-- KPI strip summary. Weekly delta for "students who need help" is NULL in v1 (no historical snapshot).

CREATE OR REPLACE FUNCTION public.dash_kpi_summary(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_present int; v_total int;
  v_wk_present int; v_wk_total int; v_pwk_present int; v_pwk_total int;
  v_avg numeric; v_prev_avg numeric; v_exams int;
  v_need int; v_flags int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_present, v_total
  FROM attendance_records WHERE institution_id = v_inst AND date = v_today;

  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_wk_present, v_wk_total
  FROM attendance_records
  WHERE institution_id = v_inst AND date > v_today - 7 AND date <= v_today;
  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_pwk_present, v_pwk_total
  FROM attendance_records
  WHERE institution_id = v_inst AND date > v_today - 14 AND date <= v_today - 7;

  SELECT round(avg(fr.percentage),1), count(DISTINCT e.id) INTO v_avg, v_exams
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id = fr.attempt_id
  JOIN exams e ON e.id = a.exam_id
  WHERE e.institution_id = v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) BETWEEN v_ay_start AND v_ay_end;

  SELECT round(avg(fr.percentage),1) INTO v_prev_avg
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id = fr.attempt_id
  JOIN exams e ON e.id = a.exam_id
  WHERE e.institution_id = v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
        BETWEEN (v_ay_start - INTERVAL '1 year')::date AND (v_ay_start - INTERVAL '1 day')::date;

  SELECT count(*) INTO v_need FROM public.dash_score_students(v_inst, NULL) WHERE score >= 20;

  SELECT count(*) INTO v_flags FROM dashboard_flags WHERE institution_id = v_inst AND resolved_at IS NULL;

  RETURN jsonb_build_object(
    'attendance_today', jsonb_build_object(
       'present', v_present, 'total', v_total, 'marked', v_total > 0,
       'pct', CASE WHEN v_total > 0 THEN round(v_present*100.0/v_total,1) END,
       'week_pct',  CASE WHEN v_wk_total  > 0 THEN round(v_wk_present *100.0/v_wk_total ,1) END,
       'prev_week_pct', CASE WHEN v_pwk_total > 0 THEN round(v_pwk_present*100.0/v_pwk_total,1) END),
    'school_avg', jsonb_build_object('pct', v_avg, 'prev_pct', v_prev_avg, 'exams_count', v_exams),
    'students_need_help', jsonb_build_object('count', v_need, 'prev_count', NULL),
    'decisions_waiting', jsonb_build_object('count', v_flags)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.dash_kpi_summary(uuid) TO authenticated;
