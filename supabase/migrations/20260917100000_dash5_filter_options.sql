-- Admin Dashboard v5: the option lists every filter on the page reads, and the
-- one pipeline argument that was missing.
--
-- ONE call for wings, classes and subjects rather than three. Fourteen filter
-- controls share it through a single 5-minute cache entry, so adding a filter to
-- a card costs no extra round trip. Classes carry their wing so a class picker
-- can narrow itself when a wing is chosen, which is what makes the paired
-- wing/class filters in the reference work.

CREATE OR REPLACE FUNCTION public.dash5_filter_options(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  SELECT jsonb_build_object(
    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) ORDER BY w.name)
        FROM wings w
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb),

    'classes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id,
               'label', c.name || COALESCE(' ' || NULLIF(c.section, ''), ''),
               'wing_id', m.wing_id)
             ORDER BY c.name, c.section)
        FROM classes c
        LEFT JOIN wing_class_mappings m ON m.class_id = c.id
       WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE), '[]'::jsonb),

    -- Deduped on the normalised name, the same key 20260914120000 established:
    -- universal_subjects holds one row per subject PER GRADE, so an undeduped
    -- picker offers "Punjabi" sixteen times and none of them mean anything on
    -- their own. The id carried is the one with the most class mappings.
    'subjects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.subject_id, 'name', s.nm) ORDER BY s.nm)
        FROM (
          SELECT DISTINCT ON (initcap(lower(btrim(us.name))))
                 us.id AS subject_id, btrim(us.name) AS nm,
                 count(*) OVER (PARTITION BY initcap(lower(btrim(us.name)))) AS n
            FROM subject_class_mappings scm
            JOIN classes c ON c.id = scm.class_id AND c.is_active IS NOT FALSE
            JOIN universal_subjects us ON us.id = scm.subject_id
           WHERE scm.institution_id = v_inst
           ORDER BY initcap(lower(btrim(us.name))), us.id
        ) s), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------ pipeline: narrow by subject ---- */

-- The reference's pipeline card filters by wing, class AND subject. The subject
-- argument was the one missing, so that picker had nowhere to send its value.
CREATE OR REPLACE FUNCTION public.dash5_exam_pipeline(
  p_wing_id    uuid DEFAULT NULL,
  p_class_id   uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_gone numeric; v_out jsonb; v_key text;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  v_gone := LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0);

  -- The picker offers ONE id per subject name, but a school teaches "Maths" as
  -- a different universal_subjects row per grade. Matching on the id alone would
  -- filter to a single grade's rows and silently show a fraction of the subject,
  -- so the filter matches every row sharing that normalised name.
  SELECT initcap(lower(btrim(us.name))) INTO v_key
    FROM universal_subjects us WHERE us.id = p_subject_id;

  WITH a AS MATERIALIZED (
    SELECT x.* FROM public.dash5_atom_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR x.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR x.class_id = p_class_id)
       AND (v_key IS NULL OR x.subject_key = v_key)
  ),
  per_pair AS (
    SELECT a.class_id, a.subject_id, a.papers, a.pending_grading,
           CASE WHEN a.papers > 0
                THEN GREATEST(round(a.papers / v_gone)::int, a.papers)
                ELSE 1 END planned
      FROM a
  ),
  agg AS (
    SELECT COALESCE(sum(papers), 0)::int held,
           COALESCE(sum(planned), 0)::int planned,
           COALESCE(sum(pending_grading), 0)::int pending,
           count(*) FILTER (WHERE papers = 0)::int pairs_with_none,
           count(*)::int pairs
      FROM per_pair
  ),
  drafted AS (
    SELECT count(DISTINCT e.id)::int n
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN classes c ON c.id = ec.class_id AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ec.class_id
      LEFT JOIN exam_subjects es ON es.exam_id = e.id
      LEFT JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = v_inst AND e.status::text = 'draft'
       AND (p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR ec.class_id = p_class_id)
       AND (v_key IS NULL OR initcap(lower(btrim(us.name))) = v_key)
  )
  SELECT jsonb_build_object(
    'year_elapsed_pct', round(v_gone * 100, 1),
    'held', g.held, 'planned', g.planned,
    'remaining', GREATEST(g.planned - g.held, 0),
    'drafted', d.n,
    'unscheduled', GREATEST(GREATEST(g.planned - g.held, 0) - d.n, 0),
    'pending_publication', g.pending,
    'pairs', g.pairs, 'pairs_with_no_paper', g.pairs_with_none,
    'on_pace', CASE WHEN g.planned > 0 THEN round(g.held * 100.0 / g.planned, 1) END
  ) INTO v_out
  FROM agg g, drafted d;

  RETURN v_out;
END
$function$;

/* -------------------------------- absentees: narrow by class as well as wing */
-- p_class_id already existed on this one; nothing to change. Listed here only so
-- the next reader does not go looking for it.

REVOKE EXECUTE ON FUNCTION public.dash5_filter_options(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_filter_options(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.dash5_exam_pipeline(uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_exam_pipeline(uuid,uuid,uuid,uuid) TO authenticated, service_role;

-- The three-argument signature is replaced by the four-argument one above.
DROP FUNCTION IF EXISTS public.dash5_exam_pipeline(uuid,uuid,uuid);
