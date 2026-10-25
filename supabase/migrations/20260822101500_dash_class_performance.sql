-- Class averages over the ACADEMIC YEAR, for the dashboard's class ranking.
--
-- Why not dash_classes_table: its `recent_avg` only counts exams published in
-- the last 60 days. On prod that leaves 1 of 8 classes with a number, so a
-- "class-wise average performance" ranking rendered a single bar and looked
-- broken. The 60-day window is right for the drill-down table it was built for
-- ("what happened lately") and wrong for a ranking ("who is behind").
--
-- Same academic-year window and the same >= 5 results floor as
-- dash_school_subject_performance, so the two rankings on the page agree about
-- what counts as evidence.
BEGIN;

CREATE OR REPLACE FUNCTION public.dash_class_performance(
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE(
  class_id uuid, class_name text, students integer,
  avg_pct numeric, results integer, attendance_30d numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  SELECT c.id,
         c.name || CASE WHEN coalesce(c.section,'') <> '' THEN '-' || c.section ELSE '' END,
         (SELECT count(*)::int FROM class_assignments ca
           WHERE ca.class_id = c.id AND ca.role::text = 'student'),
         r.avg_pct,
         coalesce(r.results, 0)::int,
         (SELECT round(count(*) FILTER (WHERE ar.status IN ('present','late')) * 100.0
                       / NULLIF(count(*), 0), 1)
            FROM attendance_records ar
           WHERE ar.class_id = c.id
             AND ar.date > v_today - 30 AND ar.date <= v_today)
    FROM classes c
    LEFT JOIN LATERAL (
      SELECT round(avg(fr.percentage), 1) AS avg_pct, count(*) AS results
        FROM final_results fr
        JOIN student_exam_attempts a ON a.id = fr.attempt_id
        JOIN exams e ON e.id = a.exam_id
       WHERE a.class_id = c.id
         AND e.institution_id = v_inst
         AND e.status IN ('published','active','completed')
         AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
             BETWEEN v_ay_start AND v_ay_end
    ) r ON true
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     -- A class with a handful of results is one paper's evidence, not a
     -- ranking position. Unscored classes still come back, with NULL, so the
     -- card can name them rather than silently dropping them.
     AND (r.results IS NULL OR r.results = 0 OR r.results >= 5)
   ORDER BY r.avg_pct ASC NULLS LAST, c.name;
END $$;

REVOKE EXECUTE ON FUNCTION public.dash_class_performance(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_class_performance(uuid) TO authenticated;

COMMIT;
