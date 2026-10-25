-- Coordinator Console, phase 5: subject-wise performance for a wing.
--
-- WHY THIS EXISTS. Dash5SubjectPerformance is one of the cards the console
-- reuses, and it was the one reused card that could not simply be clamped: with
-- no class picked it calls dash_school_subject_performance, and with a class it
-- calls dash_subject_performance. Both are dash_* functions gated on
-- dash_resolve_institution, which RAISES for a coordinator. The card did not
-- render an empty wing, it errored.
--
-- Clamping those two was not an option either. They are admin-only by design
-- and are read by other admin surfaces; widening them would hand a coordinator
-- the school-wide subject table, which is the opposite of what this console is.
--
-- So the wing gets its own, built on the SAME atoms as the performance tree, so
-- a subject's bar here and its row in the tree cannot disagree.
--
-- Subjects are keyed on `subject_key`, not on subject_id: universal_subjects
-- holds one row per subject PER GRADE, so a wing spanning three grades has
-- three "Mathematics" ids that are one subject to a reader.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

CREATE OR REPLACE FUNCTION public.dash5_coord_subjects(p_class_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_class uuid;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();
  v_class := public.dash5_scope_class(c.inst, p_class_id, false);

  WITH a AS MATERIALIZED (
    SELECT z.* FROM public.dash5_atom_rows(c.inst) z
     WHERE z.wing_id = c.wing
       AND (v_class IS NULL OR z.class_id = v_class)
  ),
  agg AS (
    SELECT a.subject_key,
           -- The id and the name of whichever grade's row has the most classes
           -- behind it, so the label is the one a reader would recognise.
           (array_agg(a.subject_id ORDER BY a.subject_id))[1] AS subject_id,
           count(DISTINCT a.class_id)::int classes,
           sum(a.papers)::int papers,
           sum(a.attempts)::int attempts,
           sum(a.acc * a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)         FILTER (WHERE a.acc IS NOT NULL) den,
           sum(a.chapters)::int chapters,
           sum(a.chapters_done)::int done,
           sum(a.chapters_partial)::int part,
           sum(a.pending_grading)::int pending
      FROM a GROUP BY a.subject_key
  ),
  named AS (
    SELECT g.*,
           COALESCE(btrim(us.name), initcap(g.subject_key)) AS name,
           CASE WHEN g.den > 0 THEN round(g.num / g.den, 1) END AS accuracy,
           CASE WHEN g.chapters > 0
                THEN round((g.done * 2 + g.part) * 100.0 / (g.chapters * 2), 1) END AS coverage
      FROM agg g
      LEFT JOIN universal_subjects us ON us.id = g.subject_id
  ),
  -- One teacher name per subject, for the row's sub-line. A subject taught by
  -- several people across the wing reports the count instead of a wrong name.
  tch AS (
    SELECT a.subject_key,
           count(DISTINCT ca.user_id)::int n,
           (array_agg(DISTINCT p.full_name))[1] AS first_name
      FROM a
      JOIN class_assignments ca ON ca.class_id = a.class_id
                               AND ca.subject_id = a.subject_id
                               AND ca.role::text = 'teacher'
      JOIN profiles p ON p.id = ca.user_id
     GROUP BY a.subject_key
  )
  SELECT jsonb_build_object(
    'scope', CASE WHEN v_class IS NULL THEN 'wing' ELSE 'class' END,
    'class_id', v_class,
    'class_label', (SELECT cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '')
                      FROM classes cl WHERE cl.id = v_class),
    -- The wing average, so a bar can be read against the line it should clear.
    'wing_avg', (SELECT CASE WHEN sum(den) > 0 THEN round(sum(num)/sum(den), 1) END FROM named),
    'total', (SELECT count(*)::int FROM named),
    'assessed', (SELECT count(*)::int FROM named WHERE accuracy IS NOT NULL),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'subject_id', n.subject_id, 'subject_key', n.subject_key, 'name', n.name,
        'accuracy', n.accuracy, 'coverage', n.coverage,
        'classes', n.classes, 'papers', n.papers, 'attempts', n.attempts,
        'pending_grading', n.pending,
        'teachers', COALESCE(t.n, 0), 'teacher', t.first_name)
      -- Weakest first, and never-assessed subjects last rather than at zero:
      -- unmeasured is not the same fact as failing.
      ORDER BY (n.accuracy IS NULL), n.accuracy, n.name)
      FROM named n LEFT JOIN tch t ON t.subject_key = n.subject_key), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_subjects(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_subjects(uuid) TO authenticated, service_role;
