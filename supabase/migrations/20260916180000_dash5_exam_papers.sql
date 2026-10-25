-- Admin Dashboard v5, phase 4b: exam performance over time.
-- One row per PAPER, so the reference's scatter can plot a dot per paper on a
-- real date axis rather than bucketing everything into cycles.
--
-- A paper here is one (exam, class, subject) event: the same exam sat by three
-- classes is three papers, because that is what a principal acts on and it is
-- the same unit the performance tree counts.

CREATE OR REPLACE FUNCTION public.dash5_exam_papers(
  p_wing_id        uuid DEFAULT NULL,
  p_class_id       uuid DEFAULT NULL,
  p_from           date DEFAULT NULL,
  p_to             date DEFAULT NULL,
  p_limit          int  DEFAULT 400,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_from date; v_to date; v_out jsonb;
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 400), 1), 1000);
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_from := COALESCE(p_from, v_ay_start, v_today - INTERVAL '12 months')::date;
  v_to   := COALESCE(p_to,   v_ay_end,   v_today)::date;

  WITH ev AS (
    SELECT e.id exam_id, e.title, e.exam_mode, e.is_offline, e.total_marks,
           ec.class_id, es.subject_id,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) d
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN exam_subjects es ON es.exam_id = e.id
      JOIN classes c ON c.id = ec.class_id AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ec.class_id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_from AND v_to
       AND (p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR ec.class_id = p_class_id)
  ),
  res AS (
    SELECT a.exam_id, a.class_id,
           count(*) FILTER (WHERE COALESCE(fr.is_absent,false) = false)::int appeared,
           count(*) FILTER (WHERE COALESCE(fr.is_absent,false))::int absent,
           avg(fr.percentage) FILTER (WHERE COALESCE(fr.is_absent,false) = false) avg_pct
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
     GROUP BY 1,2
  ),
  roster AS (
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
     WHERE ca.role::text = 'student'
       AND ca.user_id IN (SELECT s.student_id FROM public.institution_student_ids(v_inst) s)
     GROUP BY 1
  ),
  papers AS (
    SELECT ev.exam_id, ev.title, ev.d,
           ev.class_id, ev.subject_id,
           c.name || COALESCE(' ' || NULLIF(c.section,''), '') class_label,
           us.name subject_name,
           COALESCE(r.appeared, 0) appeared,
           COALESCE(rs.n, 0) roster,
           round(r.avg_pct, 1) avg_pct,
           CASE WHEN ev.is_offline THEN 'Offline' ELSE 'Online' END mode,
           ev.total_marks
      FROM ev
      JOIN classes c ON c.id = ev.class_id
      LEFT JOIN universal_subjects us ON us.id = ev.subject_id
      LEFT JOIN res r ON r.exam_id = ev.exam_id AND r.class_id = ev.class_id
      LEFT JOIN roster rs ON rs.class_id = ev.class_id
     WHERE r.avg_pct IS NOT NULL      -- a paper with no marks cannot be plotted
  ),
  capped AS (
    -- Bounded, because Alliance alone has 1,542 marked papers and an unbounded
    -- payload is a page that dies at scale. The newest are kept and the true
    -- total travels with them, so the card can say what it is not showing
    -- instead of quietly drawing three weeks and calling it the year.
    SELECT * FROM papers ORDER BY d DESC LIMIT v_lim
  )
  SELECT jsonb_build_object(
    'from', v_from, 'to', v_to,
    'count', (SELECT count(*)::int FROM capped),
    'total', (SELECT count(*)::int FROM papers),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'exam_id', p.exam_id, 'title', p.title, 'date', p.d,
        'class_id', p.class_id, 'class_label', p.class_label,
        'subject_id', p.subject_id, 'subject_name', p.subject_name,
        'avg_pct', p.avg_pct, 'appeared', p.appeared, 'roster', p.roster,
        'mode', p.mode, 'total_marks', p.total_marks,
        'band', public.dash5_band(p.avg_pct)
      ) ORDER BY p.d) FROM capped p), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_exam_papers(uuid,uuid,date,date,int,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash5_exam_papers(uuid,uuid,date,date,int,uuid) TO authenticated, service_role;
