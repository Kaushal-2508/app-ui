-- "Exam performance over time": add class + subject filters for teachers.
--
-- The single-argument dash_teacher_exam_trend(integer) is DROPPED rather than
-- replaced: CREATE OR REPLACE cannot change a signature, and adding defaulted
-- parameters alongside it would leave two candidates for a one-argument call and
-- raise "function is not unique" at runtime.
DROP FUNCTION IF EXISTS public.dash_teacher_exam_trend(integer);

CREATE OR REPLACE FUNCTION public.dash_teacher_exam_trend(
  p_limit      integer DEFAULT 8,
  p_class_id   uuid    DEFAULT NULL,
  p_subject_id uuid    DEFAULT NULL
)
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

  -- Both filters are validated against the caller's own pairs and raise
  -- otherwise, so neither parameter can ever widen scope — they only narrow it.
  IF p_class_id IS NOT NULL AND NOT (p_class_id = ANY(v_pc)) THEN
    RAISE EXCEPTION 'dashboard: class not in scope';
  END IF;
  IF p_subject_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(v_ps) AS s(sid) WHERE s.sid = p_subject_id) THEN
    RAISE EXCEPTION 'dashboard: subject not in scope';
  END IF;

  WITH pairs AS (
    SELECT pr.cid, pr.sid
      FROM unnest(v_pc, v_ps) AS pr(cid, sid)
     WHERE (p_class_id IS NULL OR pr.cid = p_class_id)
       AND (p_subject_id IS NULL OR pr.sid IS NULL OR pr.sid = p_subject_id)
  ),
  recent AS (
    SELECT DISTINCT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
      FROM exams e
      JOIN exam_subjects esx ON esx.exam_id = e.id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','active','completed')
       AND (p_subject_id IS NULL OR esx.subject_id = p_subject_id)
       -- Only exams that produced a result inside the (possibly filtered) scope:
       -- the widget discards null-average rows, so anything else wastes the window.
       AND EXISTS (
         SELECT 1
           FROM student_exam_attempts a
           JOIN final_results fr ON fr.attempt_id = a.id
          WHERE a.exam_id = e.id
            AND EXISTS (SELECT 1 FROM pairs p
                         WHERE p.cid = a.class_id
                           AND (p.sid IS NULL OR p.sid = esx.subject_id))
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
            AND EXISTS (SELECT 1 FROM pairs p
                         WHERE p.cid = a.class_id
                           AND (p.sid IS NULL OR p.sid = esx2.subject_id))
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

REVOKE ALL ON FUNCTION public.dash_teacher_exam_trend(integer, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_exam_trend(integer, uuid, uuid) TO authenticated;
