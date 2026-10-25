-- Optional class filter on the institution exam trend.
--
-- The teacher variant has had one since it was written; at institution scope
-- the chart pooled every class, so an admin could see the school's bars move
-- but not which class moved them. "Class 8-A over the last eight papers" is the
-- question this card is opened with.
--
-- The filter narrows BOTH halves, and it has to. `recent` picks which exams are
-- worth plotting and `agg` computes each bar's height; filtering only the
-- second would spend the eight-exam window on papers that class never sat and
-- then plot them as empty bars.
--
-- p_limit is clamped here for the first time. It arrives from the client and
-- fed an unbounded LIMIT, so a caller could ask for every exam the school has
-- ever published in one round trip. The teacher variant already clamps to 24;
-- this matches it.
--
-- The old two-argument signature is DROPped rather than left alongside.
-- CREATE OR REPLACE does not replace across a different argument count, it adds
-- an overload, and PostgREST then cannot resolve a call matching both - which
-- reads on screen as an empty chart. That exact failure shipped in
-- 20260822101900 on dash_attendance_trend.
BEGIN;

DROP FUNCTION IF EXISTS public.dash_exam_trend(integer, uuid);

CREATE OR REPLACE FUNCTION public.dash_exam_trend(
  p_limit integer DEFAULT 8,
  p_institution_id uuid DEFAULT NULL::uuid,
  p_class_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 24);

  -- A class from another institution must not narrow the chart to nothing and
  -- read as "this school has never graded an exam".
  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  WITH recent AS (
    SELECT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
    FROM exams e
    WHERE e.institution_id = v_inst
      AND e.status IN ('published','active','completed')
      -- only exams that can actually be plotted, for the chosen class
      AND EXISTS (
        SELECT 1
          FROM student_exam_attempts a
          JOIN final_results fr ON fr.attempt_id = a.id
         WHERE a.exam_id = e.id
           AND (p_class_id IS NULL OR a.class_id = p_class_id)
      )
    ORDER BY exam_date DESC NULLS LAST
    LIMIT p_limit
  ),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date,
           round(avg(fr.percentage),1) AS avg_pct,
           count(fr.id) AS participation
    FROM recent r
    LEFT JOIN student_exam_attempts a
           ON a.exam_id = r.id
          AND (p_class_id IS NULL OR a.class_id = p_class_id)
    LEFT JOIN final_results fr ON fr.attempt_id = a.id
    GROUP BY r.id, r.title, r.exam_type, r.exam_date
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'exam_id', id, 'title', title, 'exam_type', exam_type,
           'avg_pct', avg_pct, 'participation', participation, 'exam_date', exam_date)
           ORDER BY exam_date ASC), '[]'::jsonb)
    INTO v_rows FROM agg;
  RETURN v_rows;
END $function$;

REVOKE EXECUTE ON FUNCTION public.dash_exam_trend(integer, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_exam_trend(integer, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_exam_trend(integer, uuid, uuid) TO authenticated;

COMMIT;
