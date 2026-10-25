-- The exam trend must pick the most recent exams that HAVE results.
--
-- It was taking the most recent p_limit exams and LEFT JOINing results, so a
-- run of empty draft/test exams consumed the whole window. On prod the eight
-- newest exams are junk ("b", "NoNoNo", "g", "fv") with no attempts between
-- them; the eight DEMO exams carrying 252 results each are older and fell
-- outside the limit. The widget needs two plottable points, got one, and showed
-- "Not enough exams yet" on a school with eight graded exams.
--
-- An exam with no results cannot be a point on a performance trend, so it has
-- no business occupying a slot in the window.
BEGIN;

CREATE OR REPLACE FUNCTION public.dash_exam_trend(
  p_limit integer DEFAULT 8,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  WITH recent AS (
    SELECT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
    FROM exams e
    WHERE e.institution_id = v_inst
      AND e.status IN ('published','active','completed')
      -- only exams that can actually be plotted
      AND EXISTS (
        SELECT 1
          FROM student_exam_attempts a
          JOIN final_results fr ON fr.attempt_id = a.id
         WHERE a.exam_id = e.id
      )
    ORDER BY exam_date DESC NULLS LAST
    LIMIT p_limit
  ),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date,
           round(avg(fr.percentage),1) AS avg_pct,
           count(fr.id) AS participation
    FROM recent r
    LEFT JOIN student_exam_attempts a ON a.exam_id = r.id
    LEFT JOIN final_results fr ON fr.attempt_id = a.id
    GROUP BY r.id, r.title, r.exam_type, r.exam_date
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'exam_id', id, 'title', title, 'exam_type', exam_type,
           'avg_pct', avg_pct, 'participation', participation, 'exam_date', exam_date)
           ORDER BY exam_date ASC), '[]'::jsonb)
    INTO v_rows FROM agg;
  RETURN v_rows;
END $$;

COMMIT;
