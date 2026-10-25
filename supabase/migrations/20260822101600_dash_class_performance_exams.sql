-- Report EXAMS alongside raw result rows on the class ranking.
--
-- The card was showing "8 students · 64 results", which reads as nonsense: 64
-- is the number of result ROWS (8 students x 8 exams), a number no principal
-- has a use for. What they want to know is how many assessments the average
-- rests on -- 8 exams is evidence, 1 exam is not.
BEGIN;

-- Adding a column to a RETURNS TABLE changes the return type, which
-- CREATE OR REPLACE refuses ("cannot change return type of existing function").
-- Plain DROP, not CASCADE: nothing else depends on it, and CASCADE would take
-- any future dependant with it silently.
DROP FUNCTION IF EXISTS public.dash_class_performance(uuid);

CREATE OR REPLACE FUNCTION public.dash_class_performance(
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE(
  class_id uuid, class_name text, students integer,
  avg_pct numeric, results integer, exams integer, attendance_30d numeric
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
         coalesce(r.exams, 0)::int,
         (SELECT round(count(*) FILTER (WHERE ar.status IN ('present','late')) * 100.0
                       / NULLIF(count(*), 0), 1)
            FROM attendance_records ar
           WHERE ar.class_id = c.id
             AND ar.date > v_today - 30 AND ar.date <= v_today)
    FROM classes c
    LEFT JOIN LATERAL (
      SELECT round(avg(fr.percentage), 1) AS avg_pct,
             count(*)                     AS results,
             count(DISTINCT e.id)         AS exams
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
     AND (r.results IS NULL OR r.results = 0 OR r.results >= 5)
   ORDER BY r.avg_pct ASC NULLS LAST, c.name;
END $$;

REVOKE EXECUTE ON FUNCTION public.dash_class_performance(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_class_performance(uuid) TO authenticated;

COMMIT;
