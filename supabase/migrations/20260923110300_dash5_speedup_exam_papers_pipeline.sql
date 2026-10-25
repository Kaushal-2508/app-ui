-- ===========================================================================
-- Exam family: dash5_exam_papers + dash5_exam_pipeline (applied to prod 2026-09-23)
-- Built and proved as pg_temp candidates on prod, 2026-09-23, inside
-- BEGIN ... ROLLBACK. Output is md5-identical to the live functions in every
-- scenario tested (Alliance admin + both coordinators, Salci National admin +
-- both coordinators, Vidyabodhini admin + both coordinators, a super_admin on
-- another school; wing / class / subject / date-range / limit variants; the
-- three scope errors). Signatures, return shape, SECURITY DEFINER, STABLE,
-- plpgsql and search_path are unchanged; CREATE OR REPLACE keeps the grants
-- (authenticated, service_role; no anon).
--
-- dash5_exam_papers (exam scatter; the card asks for the last 30 days)
--   Cause: ev is estimated at 5 rows (the COALESCE(published_at, scheduled_date,
--   created_at) BETWEEN range has no statistics, so the planner applies its
--   0.5% default; Alliance really has 1,583 rows for the session, 533 for 30
--   days). On that estimate the separately aggregated "sc" was joined back to
--   ev as a nested loop: Alliance session plan showed 1,472,842 rows removed
--   by the join filter (~400ms), plus the roster aggregate "rost" rescanned
--   once per paper (loops=931, ~280ms). Execution 875ms under EXPLAIN.
--   Fix: the score aggregate is a LATERAL per ev row (index lookups on
--   idx_sea_exam_class + the final_results attempt_id index, linear in rows
--   and the same plan whatever the estimate); rost is MATERIALIZED once.
--   The old sc joined every ev row sharing an (exam, class) to the attempts,
--   so "appeared" is multiplied by that count k (k = 2 today for Salci
--   National classes mapped to two wings, admin view). That is kept exactly
--   (generate_series(1, k) in the lateral) so output does not change; it
--   looks like a bug and is reported separately, not fixed here.
--   Alliance timings, old -> new (ms):
--     admin 30d          247 -> 129   (cached generic plan: 1255 -> 129)
--     admin session      578 -> 200
--     coord Middle 30d   106 -> 46,   session 548 -> 146
--     coord Senior 30d   246 -> 60,   session 604 -> 79
--   Salci National admin session 617 -> 61.
--
-- dash5_exam_pipeline (exam pipeline card; wing / class / subject filters)
--   Cause: it called dash5_atom_rows(v_inst) (238ms alone on Alliance) for
--   two of its 21 columns, papers and pending_grading; everything else the
--   atom computes (chapters, lessons, homework, attendance, scores) was
--   thrown away. Fix: the pair set, "papers" and "pend" are reproduced with
--   the atom's own definitions (KEEP IN STEP with dash5_atom_rows). "pend"
--   starts from the unpublished results (3,138 of 21,985 rows) so a cached
--   generic plan cannot turn it into 20.6K per-attempt probes (that variant
--   measured 150-160ms). The draft / on-calendar split now skips published
--   and completed exams before joining (only draft/ready/active are counted).
--   Alliance timings, old -> new (ms):
--     admin              280 -> 43    (cached generic plan: 383 -> 49)
--     admin + subject    267 -> 49
--     coord Middle       260 -> 40
--     coord Senior       284 -> 43
--
-- Index note (recommendation only, not built): open_res seq-scans
-- final_results (510 pages) and student_exam_attempts (503 pages), 1,013
-- buffers today. If final_results grows large, a partial index
--   CREATE INDEX CONCURRENTLY idx_final_results_unpublished_attempt
--     ON public.final_results (attempt_id) WHERE is_published IS NOT TRUE;
-- keeps that read proportional to the unpublished backlog.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.dash5_exam_papers(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 400, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_from date; v_to date; v_lim int; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 400), 1), 400);

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_from := COALESCE(p_from, v_ay_start, v_today - INTERVAL '12 months')::date;
  v_to   := COALESCE(p_to, v_today)::date;

  -- ev is estimated at ~5 rows (the COALESCE date range has no statistics, so
  -- the planner applies its 0.5% default) when it is really ~1,600. The old
  -- body joined a separately aggregated "sc" back to ev and to "rost" on that
  -- estimate, which became nested loops: 1.47M join-filter comparisons plus
  -- the roster aggregate re-run once per paper (loops=931). Here the score
  -- aggregate is a LATERAL per ev row (index lookups on idx_sea_exam_class and
  -- the final_results attempt_id index, the right plan at any row count) and
  -- the roster is materialized once.
  WITH ev AS MATERIALIZED (
    SELECT e.id exam_id, e.title, e.exam_type::text cycle,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) d,
           ec.class_id, es.subject_id,
           CASE WHEN e.is_results_only THEN 'Marks only'
                WHEN e.is_offline THEN 'Offline' ELSE 'Online' END mode,
           e.total_marks,
           -- How many ev rows share this (exam, class). The old sc joined every
           -- one of them to the attempts, so each result was counted k times
           -- (k > 1 when a class sits in two wings or an exam has two subjects).
           -- Kept so "appeared" is unchanged.
           count(*) OVER (PARTITION BY e.id, ec.class_id)::int k
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN classes c ON c.id = ec.class_id AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ec.class_id
      LEFT JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_from AND v_to
       AND (p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR ec.class_id = p_class_id)
  ),
  rost AS MATERIALIZED (
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
     WHERE ca.role::text = 'student'
       AND ca.user_id IN (SELECT z.student_id FROM public.institution_student_ids(v_inst) z)
     GROUP BY 1
  ),
  rows_all AS (
    SELECT DISTINCT ON (ev.exam_id, ev.class_id, ev.subject_id)
           ev.exam_id, ev.title, ev.cycle, ev.d, ev.class_id, ev.subject_id, ev.mode, ev.total_marks,
           c.name || COALESCE(' ' || NULLIF(c.section,''), '') class_label,
           us.name subject_name,
           sc.appeared, sc.avg_pct, sc.pass_pct, sc.top_pct,
           COALESCE(rost.n, 0) roster,
           (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
              FROM class_assignments ca
              JOIN profiles pf ON pf.id = ca.user_id
             WHERE ca.class_id = ev.class_id AND ca.subject_id = ev.subject_id
               AND ca.role::text = 'teacher') teacher
      FROM ev
      JOIN classes c ON c.id = ev.class_id
      LEFT JOIN universal_subjects us ON us.id = ev.subject_id
      CROSS JOIN LATERAL (
        SELECT count(*)::int appeared,
               round(avg(fr.percentage), 1) avg_pct,
               round(count(*) FILTER (WHERE fr.percentage >= 35)*100.0/NULLIF(count(*),0), 1) pass_pct,
               round(max(fr.percentage), 1) top_pct
          FROM student_exam_attempts a
          JOIN final_results fr ON fr.attempt_id = a.id
          CROSS JOIN generate_series(1, ev.k) kk
         WHERE a.exam_id = ev.exam_id AND a.class_id = ev.class_id
           AND COALESCE(fr.is_absent, false) = false
      ) sc
      LEFT JOIN rost ON rost.class_id = ev.class_id
     WHERE sc.avg_pct IS NOT NULL
  )
  SELECT jsonb_build_object(
    'from', v_from, 'to', v_to,
    'total', (SELECT count(*)::int FROM rows_all),
    'count', (SELECT count(*)::int FROM (SELECT 1 FROM rows_all LIMIT v_lim) z),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'exam_id', r.exam_id, 'title', r.title, 'cycle', r.cycle, 'date', r.d,
               'class_id', r.class_id, 'class_label', r.class_label,
               'subject_id', r.subject_id, 'subject_name', r.subject_name,
               'teacher', r.teacher,
               'avg_pct', r.avg_pct, 'pass_pct', r.pass_pct, 'top_pct', r.top_pct,
               'appeared', r.appeared, 'roster', r.roster,
               'mode', r.mode, 'total_marks', r.total_marks,
               'band', public.dash5_band(r.avg_pct)) ORDER BY r.d DESC, r.class_label)
        FROM (SELECT * FROM rows_all ORDER BY d DESC, class_label LIMIT v_lim) r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_exam_pipeline(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_gone numeric; v_out jsonb; v_key text;
  v_atom_end date;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  -- The paper window dash5_atom_rows counts "papers" in. Its end defaults to
  -- today, NOT today + 1 like this function's pace window below.
  v_atom_end := COALESCE(v_ay_end, v_today)::date;
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  v_gone := LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0);

  SELECT initcap(lower(btrim(us.name))) INTO v_key
    FROM universal_subjects us WHERE us.id = p_subject_id;

  -- This used to read dash5_atom_rows(v_inst) and keep two of its 21 columns
  -- (papers, pending_grading). That call computes every atom column for every
  -- class-subject pair of the school (chapters, lessons, homework, attendance,
  -- scores) and was ~90% of this function's time. The three pieces it needs
  -- are reproduced below with the atom's definitions: the pair set (prs,
  -- joined to universal_subjects), "papers" and "pend". KEEP IN STEP with
  -- dash5_atom_rows: if its prs / papers / pend change, change them here too.
  WITH prs AS MATERIALIZED (
    SELECT DISTINCT scm.class_id, scm.subject_id, cl.class_group_id, cl.wing_id,
           initcap(lower(btrim(us0.name))) subject_key
      FROM subject_class_mappings scm
      JOIN (SELECT c.id, c.class_group_id, m.wing_id
              FROM classes c
              LEFT JOIN wing_class_mappings m ON m.class_id = c.id
             WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE) cl
        ON cl.id = scm.class_id
      JOIN universal_subjects us0 ON us0.id = scm.subject_id
     WHERE scm.institution_id = v_inst
  ),
  a0 AS MATERIALIZED (
    SELECT p.class_id, p.subject_id
      FROM prs p
     WHERE (p_wing_id IS NULL OR p.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR p.class_id = p_class_id)
       AND (v_key IS NULL OR p.subject_key = v_key)
  ),
  -- pp is the atom's "papers" over the whole school. The date window stays
  -- inside FILTER, as in the atom, so the exams scan is estimated from
  -- institution_id alone.
  pp AS MATERIALIZED (
    SELECT ec.class_id, es.subject_id,
           count(DISTINCT e.id) FILTER (
             WHERE e.status IN ('published','completed')
               AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                   BETWEEN v_ay_start AND v_atom_end)::int papers
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = v_inst
     GROUP BY 1,2
  ),
  -- pd is the atom's "pend": exams with a result still unpublished, per
  -- (attempt class, subject). It starts from the unpublished results (about
  -- 14% of final_results) rather than from the school's attempts: reached
  -- from the attempt side, a cached generic plan (what a pooled connection
  -- runs after five calls) probes final_results once per attempt, 20.6K
  -- probes and ~90ms on Alliance. open_res has no parameters, so its plan
  -- never changes. It is platform-wide, but the unpublished backlog is small;
  -- see the partial-index note in the migration header if it grows.
  open_res AS MATERIALIZED (
    SELECT DISTINCT a.exam_id, a.class_id
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
     WHERE fr.is_published IS NOT TRUE
  ),
  pd AS MATERIALIZED (
    SELECT o.class_id, es.subject_id, count(DISTINCT e.id)::int pending
      FROM open_res o
      JOIN exams e ON e.id = o.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = v_inst
     GROUP BY 1,2
  ),
  per_pair AS (
    SELECT x.papers, x.pending_grading,
           CASE WHEN x.papers > 0
                THEN GREATEST(round(x.papers / v_gone)::int, x.papers)
                ELSE 1 END planned
      FROM (SELECT COALESCE(pp.papers, 0) papers, COALESCE(pd.pending, 0) pending_grading
              FROM a0
              LEFT JOIN pp ON pp.class_id = a0.class_id AND pp.subject_id = a0.subject_id
              LEFT JOIN pd ON pd.class_id = a0.class_id AND pd.subject_id = a0.subject_id) x
  ),
  agg AS (
    SELECT COALESCE(sum(papers), 0)::int held,
           COALESCE(sum(planned), 0)::int planned,
           COALESCE(sum(pending_grading), 0)::int pending,
           count(*) FILTER (WHERE papers = 0)::int pairs_with_none,
           count(*)::int pairs
      FROM per_pair
  ),
  -- Every exam in scope, one row per exam, classified by where it sits. The
  -- DISTINCT matters: an exam covering four classes would otherwise be counted
  -- four times against a plan that counts it once. Only the three statuses
  -- split counts are read; published and completed papers (~92% of Alliance's
  -- exams) are filtered out up front instead of being joined and dropped.
  ex AS (
    SELECT DISTINCT e.id, e.status::text st
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN classes c ON c.id = ec.class_id AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ec.class_id
      LEFT JOIN exam_subjects es ON es.exam_id = e.id
      LEFT JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = v_inst
       AND e.status::text IN ('draft','ready','active')
       AND (p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR ec.class_id = p_class_id)
       AND (v_key IS NULL OR initcap(lower(btrim(us.name))) = v_key)
  ),
  split AS (
    SELECT count(*) FILTER (WHERE ex.st = 'draft')::int in_draft,
           -- "ready" and "active" are written and dated but not yet sat.
           count(*) FILTER (WHERE ex.st IN ('ready','active'))::int on_calendar
      FROM ex
  )
  SELECT jsonb_build_object(
    'year_elapsed_pct', round(v_gone * 100, 1),
    'held', g.held, 'planned', g.planned,
    'remaining', GREATEST(g.planned - g.held, 0),
    'pending_publication', g.pending,
    'pairs', g.pairs, 'pairs_with_no_paper', g.pairs_with_none,
    'on_pace', CASE WHEN g.planned > 0 THEN round(g.held * 100.0 / g.planned, 1) END,

    -- The four-way split the reference draws. results_out is a subtraction
    -- rather than its own count because "held" and "pending" come from the same
    -- atom and must add back up to it exactly.
    'held_results_out', GREATEST(g.held - g.pending, 0),
    'held_results_pending', LEAST(g.pending, g.held),
    'on_calendar', sp.on_calendar,
    'in_draft', sp.in_draft,
    -- What is left once everything above is accounted for: papers the pace
    -- implies that nobody has written yet, even as a draft.
    'not_written', GREATEST(g.planned - g.held - sp.on_calendar - sp.in_draft, 0),

    -- Kept for callers written against the previous shape.
    'drafted', sp.in_draft,
    'unscheduled', GREATEST(g.planned - g.held - sp.in_draft, 0)
  ) INTO v_out
  FROM agg g, split sp;

  RETURN v_out;
END
$function$;

COMMIT;
