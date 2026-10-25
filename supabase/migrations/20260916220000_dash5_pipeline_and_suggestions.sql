-- Admin Dashboard v5, phase 6: the exam pipeline and the task suggestions.
-- Design: docs/superpowers/specs/2026-09-16-admin-dashboard-v5-design.md
--
-- These are the last two cards of the reference. They were deliberately held
-- back until there was a real write path behind the buttons, because a control
-- that looks like it assigns work and does not is worse than one that has not
-- arrived yet.

/* ------------------------------------------------ correction to phase 4a -- */

-- tasks.status is completed | done_pending_approval | in_progress | open |
-- rejected. There is no 'done', so the coordinator card's "tasks closed" tested
-- for a value that can never occur and would have read 0 forever.
CREATE OR REPLACE FUNCTION public.dash5_coordinators(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH atoms AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  pc AS (SELECT DISTINCT a.class_id, a.wing_id, a.students, a.att_present, a.att_total FROM atoms a),
  wagg AS (
    SELECT a.wing_id,
           sum(a.chapters)::int chapters, sum(a.chapters_done)::int done,
           sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den
      FROM atoms a GROUP BY a.wing_id
  ),
  wc AS (
    SELECT pc.wing_id, count(*)::int classes, sum(pc.students)::int students,
           sum(pc.att_present)::int ap, sum(pc.att_total)::int at2
      FROM pc GROUP BY pc.wing_id
  ),
  coord AS (
    SELECT wa.wing_id, COALESCE(pf.full_name, pf.email) nm
      FROM wing_assignments wa
      JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
  ),
  staff_in_wing AS (
    SELECT m.wing_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
      JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE ca.role::text = 'teacher'
     GROUP BY 1
  ),
  tsk AS (
    SELECT t.wing_id,
           count(*)::int total,
           count(*) FILTER (WHERE t.status::text = 'completed')::int closed,
           count(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date::date < v_today
                              AND t.status::text NOT IN ('completed','rejected'))::int overdue
      FROM tasks t
     WHERE t.institution_id = v_inst AND t.wing_id IS NOT NULL
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'wing_id', w.id, 'wing_name', w.name,
      'coordinator', (SELECT string_agg(c.nm, ', ') FROM coord c WHERE c.wing_id = w.id),
      'classes', COALESCE(k.classes, 0),
      'students', COALESCE(k.students, 0),
      'teachers', COALESCE(sw.n, 0),
      'avg_score', CASE WHEN g.den > 0 THEN round(g.num/g.den, 1) END,
      'coverage_pct', CASE WHEN g.chapters > 0
         THEN round((g.done*2 + g.part)*100.0/(g.chapters*2), 1) END,
      'attendance_pct', CASE WHEN k.at2 > 0 THEN round(k.ap*100.0/k.at2, 1) END,
      'tasks_closed', COALESCE(t.closed, 0), 'tasks_total', COALESCE(t.total, 0),
      'tasks_overdue', COALESCE(t.overdue, 0),
      'band', public.dash5_band(public.dash5_composite(
         CASE WHEN g.den > 0 THEN g.num/g.den END,
         CASE WHEN g.chapters > 0 THEN (g.done*2+g.part)*100.0/(g.chapters*2) END,
         CASE WHEN k.at2 > 0 THEN k.ap*100.0/k.at2 END, NULL))
    ) ORDER BY w.name), '[]'::jsonb)
  ) INTO v_out
  FROM wings w
  LEFT JOIN wagg g ON g.wing_id = w.id
  LEFT JOIN wc   k ON k.wing_id = w.id
  LEFT JOIN staff_in_wing sw ON sw.wing_id = w.id
  LEFT JOIN tsk  t ON t.wing_id = w.id
  WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------------- exam pipeline ---- */

-- Papers the year implies against what has actually been held. The plan comes
-- from the scope's OWN pace: three papers held in 77% of the year implies about
-- four for the session. A scope with nothing held still owes the year one, which
-- is exactly why it shows as a gap. Flooring every row at "one more" instead
-- would claim the school is about to double its output in the last quarter.
CREATE OR REPLACE FUNCTION public.dash5_exam_pipeline(
  p_wing_id  uuid DEFAULT NULL,
  p_class_id uuid DEFAULT NULL,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_gone numeric; v_out jsonb;
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

  -- Share of the session elapsed, clamped so an early or finished year cannot
  -- produce a divide-by-zero or a nonsense projection.
  v_gone := LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0);

  WITH a AS MATERIALIZED (
    SELECT * FROM public.dash5_atom_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR x.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR x.class_id = p_class_id)
  ),
  per_pair AS (
    SELECT a.class_id, a.subject_id, a.papers, a.pending_grading,
           CASE WHEN a.papers > 0
                THEN GREATEST(round(a.papers / v_gone)::int, a.papers)
                ELSE 1 END planned
      FROM a
  ),
  agg AS (
    SELECT sum(papers)::int held,
           sum(planned)::int planned,
           sum(pending_grading)::int pending,
           count(*) FILTER (WHERE papers = 0)::int pairs_with_none,
           count(*)::int pairs
      FROM per_pair
  ),
  -- Everything still to come, split into the two honest states: the paper
  -- exists as a draft, or the slot is on the calendar with nothing written yet.
  drafted AS (
    SELECT count(DISTINCT e.id)::int n
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN classes c ON c.id = ec.class_id AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ec.class_id
     WHERE e.institution_id = v_inst AND e.status::text = 'draft'
       AND (p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR ec.class_id = p_class_id)
  )
  SELECT jsonb_build_object(
    'year_elapsed_pct', round(v_gone * 100, 1),
    'held', g.held, 'planned', g.planned,
    'remaining', GREATEST(g.planned - g.held, 0),
    'drafted', d.n,
    'unscheduled', GREATEST(GREATEST(g.planned - g.held, 0) - d.n, 0),
    'pending_publication', g.pending,
    'pairs', g.pairs, 'pairs_with_no_paper', g.pairs_with_none,
    'on_pace', CASE WHEN g.planned > 0
       THEN round(g.held * 100.0 / g.planned, 1) END
  ) INTO v_out
  FROM agg g, drafted d;

  RETURN v_out;
END
$function$;

/* --------------------------------------------------- task suggestions ----- */

-- Drafts, derived from the facts already on this page and addressed to the
-- person who can act. Deterministic SQL rather than a model call: every line is
-- an observation about a number the page already holds, so computing it is
-- instant, free, explainable, and structurally unable to invent a statistic
-- about a real child. Nothing is written until an admin approves one.
CREATE OR REPLACE FUNCTION public.dash5_task_suggestions(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb; v_pace numeric := 74;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  s AS MATERIALIZED (SELECT * FROM public.dash5_student_rows(v_inst)),
  cls AS (
    SELECT a.class_id, a.wing_id,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done, sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*) FILTER (WHERE a.papers = 0)::int no_paper,
           sum(a.pending_grading)::int pending
      FROM a GROUP BY 1,2
  ),
  labelled AS (
    SELECT c.*, cl.name || COALESCE(' ' || NULLIF(cl.section,''), '') label,
           CASE WHEN c.den > 0 THEN c.num/c.den END acc,
           CASE WHEN c.ch > 0 THEN (c.done*2+c.part)*100.0/(c.ch*2) END cov
      FROM cls c JOIN classes cl ON cl.id = c.class_id
  ),
  raw AS (
    -- 1. the weakest class in the school
    (SELECT 'weakest_class' code, 1 priority, 'academic_content'::task_type ttype, 3 due_days,
            'Remedial plan for ' || l.label title,
            round(l.acc)::text || '% average, ' || round(COALESCE(l.cov,0))::text
              || '% syllabus coverage. Lowest in the school.' detail,
            public.resolve_flag_assignee(v_inst, 'class', l.class_id::text) assignee
       FROM labelled l WHERE l.acc IS NOT NULL ORDER BY l.acc LIMIT 1)

    UNION ALL
    -- 2. classes behind the pace line, addressed to each wing
    SELECT 'pace_' || w.id::text, 1, 'academic_content'::task_type, 7,
           'Bring ' || n.cnt || ' class' || CASE WHEN n.cnt = 1 THEN '' ELSE 'es' END
             || ' in ' || w.name || ' back to the ' || v_pace || '% pace line',
           'Coverage is the leading indicator: a class behind now is a class revising in the exam week.',
           -- Primary has no coordinator, and a suggestion nobody can be
           -- assigned to is a card that cannot be approved. Fall through to
           -- the principal the way resolve_flag_assignee itself does.
           COALESCE((SELECT wa.user_id FROM wing_assignments wa WHERE wa.wing_id = w.id LIMIT 1),
                    public.resolve_flag_assignee(v_inst, 'institution', v_inst::text))
      FROM wings w
      JOIN LATERAL (SELECT count(*)::int cnt FROM labelled l
                     WHERE l.wing_id = w.id AND l.cov IS NOT NULL AND l.cov < v_pace) n ON true
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE AND n.cnt > 0

    UNION ALL
    -- 3. subject-class pairs nobody has examined
    SELECT 'no_paper', 2, 'exam_related'::task_type, 5,
           'Schedule papers for ' || x.n || ' subject-class pairs with nothing set',
           'They are excluded from every average on the dashboard, so the school figure rests on '
             || 'thinner evidence than it looks.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(no_paper)::int n FROM cls) x WHERE x.n > 0

    UNION ALL
    -- 4. results written but never published
    SELECT 'pending_results', 2, 'exam_related'::task_type, 4,
           'Publish results for ' || x.n || ' papers already written',
           'Parents and students cannot be told anything until these close.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(pending)::int n FROM cls) x WHERE x.n > 0

    UNION ALL
    -- 5. accounts that were created and never opened
    SELECT 'never_in', 2, 'student_support'::task_type, 10,
           'Onboard ' || x.n || ' students who have never signed in',
           'Nothing they do is measured until they do.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT count(*)::int n FROM s WHERE s.never_in) x WHERE x.n > 0

    UNION ALL
    -- 6. the attendance floor
    SELECT 'attendance_floor', 1, 'student_support'::task_type, 5,
           'Contact families of ' || x.n || ' students below the 75% attendance floor',
           'Board eligibility risk.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT count(*)::int n FROM s WHERE COALESCE(s.attendance_pct, 100) < 75) x WHERE x.n > 0
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM raw),
    'high', (SELECT count(*)::int FROM raw WHERE priority = 1),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'code', r.code, 'title', r.title, 'detail', r.detail,
        'priority', r.priority, 'task_type', r.ttype, 'due_days', r.due_days,
        'assignee_id', r.assignee,
        'assignee_name', (SELECT COALESCE(pf.full_name, pf.email) FROM profiles pf WHERE pf.id = r.assignee)
      ) ORDER BY r.priority, r.title) FROM raw r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_exam_pipeline(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_task_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash5_exam_pipeline(uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_task_suggestions(uuid) TO authenticated, service_role;
