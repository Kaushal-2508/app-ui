-- Wing filter on "Class-wise average performance".
--
-- The ranking is 33 classes deep and paged six at a time, so "which of MY
-- wing's classes is behind" currently means loading five pages and reading past
-- everyone else's. A wing is also the unit this list is acted on: the card next
-- to it already ranks coordinators by wing, and the follow-up to a red bar is a
-- conversation with that wing's coordinator.
--
-- Wings reach classes through wing_class_mappings (§4). EXISTS rather than a
-- join: a class can be mapped to more than one wing, and joining would emit
-- that class once per mapping and rank it twice.
--
-- p_wing_id is appended, so the one-argument signature is DROPped first.
-- CREATE OR REPLACE across a different argument count adds an overload rather
-- than replacing, and PostgREST then cannot resolve a call matching both, which
-- reads on screen as an empty card. That failure shipped in 20260822101900.
--
-- Everything else below is the live definition verbatim: the academic-year
-- window, the >= 5 results floor, and the NULL-average classes that are
-- deliberately returned so the card can name them rather than silently drop
-- them.
BEGIN;

DROP FUNCTION IF EXISTS public.dash_class_performance(uuid);

CREATE OR REPLACE FUNCTION public.dash_class_performance(
  p_institution_id uuid DEFAULT NULL::uuid,
  p_wing_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(class_id uuid, class_name text, students integer, avg_pct numeric,
                results integer, exams integer, attendance_30d numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  -- A wing from another institution must not return an empty ranking and read
  -- as "no class here has been examined".
  IF p_wing_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM wings w
                      WHERE w.id = p_wing_id AND w.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: wing not in institution';
  END IF;

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
     AND (p_wing_id IS NULL
          OR EXISTS (SELECT 1 FROM wing_class_mappings m
                      WHERE m.class_id = c.id AND m.wing_id = p_wing_id))
     AND (r.results IS NULL OR r.results = 0 OR r.results >= 5)
   ORDER BY r.avg_pct ASC NULLS LAST, c.name;
END $function$;

REVOKE EXECUTE ON FUNCTION public.dash_class_performance(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_class_performance(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_class_performance(uuid, uuid) TO authenticated;

COMMIT;
