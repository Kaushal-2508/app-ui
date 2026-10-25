-- Optional class filter on the institution attendance trend.
--
-- Only the teacher variant could narrow to one class; at institution scope the
-- chart pooled every class, so an admin could see the school line dip but not
-- which class caused it. p_class_id defaults to NULL, so every existing 1- and
-- 2-argument call keeps its current behaviour.
BEGIN;

-- Appending a defaulted argument to an existing function creates a SECOND
-- overload rather than replacing the first, and PostgREST then cannot resolve
-- a 1-argument call: dash_attendance_trend(30) matches both candidates and
-- fails with "function is not unique", which is exactly the shape of "the
-- chart shows nothing". Drop the old signature by explicit argument types
-- before recreating.
DROP FUNCTION IF EXISTS public.dash_attendance_trend(integer, uuid);

CREATE OR REPLACE FUNCTION public.dash_attendance_trend(
  p_days integer DEFAULT 30,
  p_institution_id uuid DEFAULT NULL,
  p_class_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  -- A class from another institution must not narrow the trend to nothing and
  -- look like "no attendance recorded".
  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.date, 'present', d.present, 'total', d.total,
           'pct', CASE WHEN d.total>0 THEN round(d.present*100.0/d.total,1) END) ORDER BY d.date), '[]'::jsonb)
    INTO v_points
  FROM (
    SELECT date,
           count(*) FILTER (WHERE status IN ('present','late')) AS present,
           count(*) AS total
    FROM attendance_records
    WHERE institution_id = v_inst
      AND date > v_today - p_days AND date <= v_today
      AND (p_class_id IS NULL OR class_id = p_class_id)
    GROUP BY date
  ) d;

  SELECT round((count(*) FILTER (WHERE status IN ('present','late')))*100.0 / NULLIF(count(*),0), 1)
    INTO v_all
  FROM attendance_records
   WHERE institution_id = v_inst
     AND (p_class_id IS NULL OR class_id = p_class_id);

  RETURN jsonb_build_object('points', v_points, 'all_time_avg', v_all);
END $$;

REVOKE EXECUTE ON FUNCTION public.dash_attendance_trend(integer, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_attendance_trend(integer, uuid, uuid) TO authenticated;

COMMIT;
