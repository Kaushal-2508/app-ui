-- Fix: "Exam performance over time" was empty for a teacher with 39 published
-- exams in the class.
--
-- CAUSE: dash_scoped_exam_trend takes the p_limit (8) MOST RECENT exams by date
-- and only then LEFT JOINs results. ExamPerformanceTrendWidget discards every
-- row whose avg_pct is null, so if the eight newest papers happen to have no
-- results the chart receives nothing and renders "not enough exams yet".
--
-- Measured for Teacher2's class: 39 published exams, only 12 with results — and
-- the newest eight are unscored drafts/tests, so the window was entirely wasted.
--
-- FIX: restrict the window to exams that actually HAVE a result in scope, then
-- take the most recent of those. The chart was already dropping the others, so
-- nothing is lost; the window is simply spent on rows that can be drawn.
--
-- Amended in place rather than forked: this is a straight bug fix and it helps
-- coordinators and admins for the same reason. The return shape is unchanged.
CREATE OR REPLACE FUNCTION public.dash_scoped_exam_trend(p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_classes uuid[]; v_rows jsonb;
BEGIN
  v_inst := public.get_user_institution(auth.uid());
  v_classes := public.dash_resolve_scoped_classes();

  WITH recent AS (
    SELECT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
      FROM exams e
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','active','completed')
       AND EXISTS (SELECT 1 FROM exam_classes ec
                    WHERE ec.exam_id = e.id AND ec.class_id = ANY(v_classes))
       -- THE FIX: only exams that produced a result inside this scope.
       AND EXISTS (SELECT 1
                     FROM student_exam_attempts a
                     JOIN final_results fr ON fr.attempt_id = a.id
                    WHERE a.exam_id = e.id AND a.class_id = ANY(v_classes))
     ORDER BY exam_date DESC NULLS LAST
     LIMIT p_limit
  ),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date,
           round(avg(fr.percentage), 1) AS avg_pct,
           count(fr.id)                 AS participation
      FROM recent r
      LEFT JOIN student_exam_attempts a ON a.exam_id = r.id AND a.class_id = ANY(v_classes)
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
