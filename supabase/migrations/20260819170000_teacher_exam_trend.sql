-- Teacher-scoped exam trend.
--
-- dash_scoped_exam_trend resolves a teacher to class_id only, so "Exam
-- performance over time" plotted every subject examined in her classes. For
-- Teacher2 — who teaches English Core alone — the eight points returned were
-- Social Studies, Computer Science, Art and Physical Education papers set by
-- colleagues. Rendering was the smaller problem; the content was wrong.
--
-- This variant additionally requires the exam's SUBJECT to be one of the
-- caller's own (class, subject) pairs, the same boundary the KPI, class-subject,
-- weak-chapters and attention panels use. It keeps the fix from
-- 20260819160000 — only exams that actually produced a result enter the window,
-- because the widget discards null-average rows.
--
-- Verified for Teacher2: 4 English Core exams with results, so the chart draws.
-- The shared dash_scoped_exam_trend is left untouched for coordinators, whose
-- scope genuinely IS every subject in their wing.
CREATE OR REPLACE FUNCTION public.dash_teacher_exam_trend(p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_pc uuid[]; v_ps uuid[]; v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(auth.uid());
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 24);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_scoped_pairs() p;
  IF v_pc IS NULL THEN RETURN '[]'::jsonb; END IF;

  WITH recent AS (
    SELECT DISTINCT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
      FROM exams e
      JOIN exam_subjects esx ON esx.exam_id = e.id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','active','completed')
       -- Must have produced a result inside MY (class, subject) scope.
       AND EXISTS (
         SELECT 1
           FROM student_exam_attempts a
           JOIN final_results fr ON fr.attempt_id = a.id
          WHERE a.exam_id = e.id
            AND EXISTS (SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
                         WHERE pr.cid = a.class_id
                           AND (pr.sid IS NULL OR pr.sid = esx.subject_id))
       )
     ORDER BY exam_date DESC NULLS LAST
     LIMIT p_limit
  ),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date,
           round(avg(fr.percentage), 1) AS avg_pct,
           count(fr.id)                 AS participation
      FROM recent r
      JOIN exam_subjects esx2 ON esx2.exam_id = r.id
      LEFT JOIN student_exam_attempts a
             ON a.exam_id = r.id
            AND EXISTS (SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
                         WHERE pr.cid = a.class_id
                           AND (pr.sid IS NULL OR pr.sid = esx2.subject_id))
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

REVOKE ALL ON FUNCTION public.dash_teacher_exam_trend(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_exam_trend(integer) TO authenticated;
