-- Fix: dash_scoped_attendance_compliance treated "the institution's most recent
-- attendance date" as the reference working day. On a morning when a single
-- class in the whole school had marked, that made every other class read as
-- "did not log attendance", and the digest reported "18 of 18 classes did not
-- log attendance on the last working day" at 8am on a normal day.
--
-- A reference day now has to look like a day the school actually operated: at
-- least a quarter of the institution's active classes marked attendance on it.
-- The in-progress current day is therefore ignored until enough of the school
-- has marked, instead of being counted as a school-wide failure.

CREATE OR REPLACE FUNCTION public.dash_scoped_attendance_compliance(p_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz text; v_today date; v_days int;
  v_working_days int; v_latest date;
  v_missing_today int; v_total_classes int;
  v_rows jsonb;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL OR v_inst IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total_classes', 0,
                              'missing_today', 0, 'latest_date', NULL,
                              'working_days', 0);
  END IF;

  v_days := LEAST(GREATEST(COALESCE(p_days, 14), 1), 60);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  v_total_classes := array_length(v_class_ids, 1);

  -- A "working day" is a date on which at least a quarter of the institution's
  -- active classes recorded attendance. This keeps a half-finished current day
  -- (or a single stray class) from being treated as the benchmark.
  WITH inst_classes AS (
    SELECT GREATEST(count(*)::numeric * 0.25, 1) AS threshold
      FROM classes
     WHERE institution_id = v_inst AND COALESCE(is_active, true)
  ),
  day_counts AS (
    SELECT ar.date, count(DISTINCT ar.class_id)::numeric AS classes_marked
      FROM attendance_records ar
     WHERE ar.institution_id = v_inst
       AND ar.date > v_today - v_days
     GROUP BY ar.date
  )
  SELECT count(*)::int, max(dc.date)
    INTO v_working_days, v_latest
    FROM day_counts dc, inst_classes ic
   WHERE dc.classes_marked >= ic.threshold;

  v_working_days := COALESCE(v_working_days, 0);

  SELECT count(*)::int INTO v_missing_today
    FROM unnest(v_class_ids) AS cid
   WHERE v_latest IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM attendance_records ar
                      WHERE ar.class_id = cid AND ar.date = v_latest);

  SELECT COALESCE(jsonb_agg(x ORDER BY pct ASC NULLS FIRST), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT CASE WHEN v_working_days > 0
                  THEN round(count(DISTINCT ar.date) * 100.0 / v_working_days, 1) END AS pct,
             jsonb_build_object(
               'class_id', c.id,
               'class_name', c.name || CASE WHEN COALESCE(c.section,'') <> ''
                                            THEN ' ' || c.section ELSE '' END,
               'days_marked', count(DISTINCT ar.date)::int,
               'days_expected', v_working_days,
               'pct', CASE WHEN v_working_days > 0
                           THEN LEAST(round(count(DISTINCT ar.date) * 100.0 / v_working_days, 1), 100) END,
               'last_marked', max(ar.date),
               'missing_latest', (v_latest IS NOT NULL AND max(ar.date) IS DISTINCT FROM v_latest)
             ) AS x
        FROM classes c
        LEFT JOIN attendance_records ar
               ON ar.class_id = c.id AND ar.date > v_today - v_days
       WHERE c.id = ANY(v_class_ids)
       GROUP BY c.id, c.name, c.section
    ) q;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total_classes', v_total_classes,
    'missing_today', COALESCE(v_missing_today, 0),
    'latest_date', v_latest,
    'working_days', v_working_days
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash_scoped_attendance_compliance(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash_scoped_attendance_compliance(integer) TO authenticated;
