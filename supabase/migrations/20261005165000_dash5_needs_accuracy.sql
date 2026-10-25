-- Admin dashboard accuracy pass: "Needs attention", task suggestions, exam
-- pipeline, assign drawer, school-wide queue and the Communication chips.
-- Audit: docs/admin-dashboard-audit-2026-10-05.md. Owner decisions
-- (Tushar, 2026-10-05): averages and paper counts use PUBLISHED marks only
-- (dash5_counted_results); nothing that shows today may disappear.
--
-- Signatures, return types and every jsonb key the live UI reads are kept.
-- New keys are additive.
--
-- 1. dash5_exam_pipeline (R1, R8, R2)
--    * One row per (class, subject) pair. The old prs/a0 carried wing_id, so a
--      class in two wings was counted twice (Salci National: 404 pairs shown,
--      264 real; 114 papers shown, 58 real).
--    * An exam's subject is mapped onto the class's own subject by id first,
--      then by subject name (universal_subjects has one row per grade).
--    * One unit for every bar: a class paper = one exam for one class in one
--      of its subjects.
--    * "Held" now needs marks. Results out = has counted (published) results;
--      results pending = marks entered but none published; NEW key
--      held_no_marks = the paper's day has passed and no marks exist. "On the
--      calendar" = published and dated later this year. It was read from the
--      statuses ready/active, which no exam has ever had, so it was always 0.
--    * The paper's day is the dash5_counted_results rule (scheduled date when
--      plausible, else start, publish, create), not the publish date.
--    * "Pairs with no paper" = no PUBLISHED paper, the test every other card
--      uses; pairs_with_no_held_paper (new) is the plan's "owes one" count.
--    * Pace from dash5_year_pace. New keys: held_no_marks,
--      pairs_with_no_held_paper, pairs_no_paper_unexamined,
--      unexamined_examples, pending_papers.
-- 2. dash5_task_suggestions (R12, R1, R4)
--    * Pace line was hard-coded at 74%; now dash5_year_pace (51.4% today).
--    * Wing tasks go to an active coordinator of the wing, by name, never to a
--      teacher who merely has a wing_assignments row.
--    * School totals de-duplicate dash5_atom_rows on (class_id, subject_id).
--    * "Publish results for N papers" counts distinct papers (103, not 110).
--    * "No paper" keeps every pair and says how many are in subjects no class
--      has examined this year (Library, Music, PT ...).
-- 3. resolve_flag_assignee (R12). Person-picking only: class teacher, wing
--    coordinator (must hold the coordinator role) and subject teacher must be
--    active and are picked by name; the admin fallback is an active school
--    admin who has signed in at least once, by name (it was "LIMIT 1" with no
--    order, which at Salci National picked a never-used account named "...").
--    Signature and return unchanged; dash_evaluate_flags and
--    dash_create_task_from_flag keep working. PUBLIC/anon EXECUTE revoked.
-- 4. dash5_assign_context (R1, R4, R12, R16): school sums de-duplicated; pace
--    from dash5_year_pace; admin fallback as above; pending = distinct papers;
--    copy for the no-paper split, online homework and the 75% line.
-- 5. dash5_school_wide_needs (R13): high-severity events counted from
--    proctoring_events (the session counter was written twice); leave copy
--    no longer claims the register marks students absent; past-dated leave
--    named; new key href per item, a real page to act on.
-- 6. dash5_communication: cancelled meetings, cancelled bookings and notices
--    scheduled for later are no longer counted; new key ptm.held_this_year.

-- ----------------------------------------------------------------- 1 -------
CREATE OR REPLACE FUNCTION public.dash5_exam_pipeline(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_pace numeric; v_gone numeric; v_out jsonb; v_key text;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM institutions WHERE id = v_inst;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end, v_today)::date;
  v_pace := public.dash5_year_pace(v_inst);
  v_gone := v_pace / 100.0;

  SELECT initcap(lower(btrim(us.name))) INTO v_key
    FROM universal_subjects us WHERE us.id = p_subject_id;

  WITH prs AS MATERIALIZED (
    -- One row per (class, subject). No wing column: a class mapped into two
    -- wings must not count twice (R1).
    SELECT DISTINCT scm.class_id, scm.subject_id, initcap(lower(btrim(us0.name))) subject_key
      FROM subject_class_mappings scm
      JOIN classes c ON c.id = scm.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
      JOIN universal_subjects us0 ON us0.id = scm.subject_id
     WHERE scm.institution_id = v_inst
  ),
  a0 AS MATERIALIZED (
    SELECT p.class_id, p.subject_id, p.subject_key
      FROM prs p
     WHERE (p_wing_id IS NULL OR EXISTS (
              SELECT 1 FROM wing_class_mappings m
               WHERE m.class_id = p.class_id AND m.wing_id = p_wing_id))
       AND (p_class_id IS NULL OR p.class_id = p_class_id)
       AND (v_key IS NULL OR p.subject_key = v_key)
  ),
  -- Every exam x class x exam subject. The paper's day is the rule
  -- dash5_counted_results uses (KEEP IN STEP): the scheduled date when it is
  -- plausible, else the start, publish or create time, in school time.
  cp0 AS MATERIALIZED (
    SELECT e.id exam_id, ec.class_id, es.subject_id exam_subject_id, e.status::text st,
           (COALESCE(
              CASE WHEN e.scheduled_date BETWEEN e.created_at - INTERVAL '400 days'
                                             AND e.created_at + INTERVAL '400 days'
                   THEN e.scheduled_date END,
              e.start_time, e.published_at, e.created_at) AT TIME ZONE v_tz)::date d
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = v_inst
       AND e.status::text IN ('draft','ready','published','active','completed')
  ),
  -- Each (class, exam subject) lands on ONE of the class's own subjects: the
  -- same id first, else the same subject name (R2). Resolved on the small
  -- distinct set, then joined on equality. The same id always has the same
  -- name, so the name join finds the exact match too.
  smap AS MATERIALIZED (
    SELECT DISTINCT ON (s.class_id, s.exam_subject_id)
           s.class_id, s.exam_subject_id, p.subject_id pair_subject_id
      FROM (SELECT DISTINCT cp0.class_id, cp0.exam_subject_id FROM cp0) s
      JOIN universal_subjects us ON us.id = s.exam_subject_id
      JOIN prs p ON p.class_id = s.class_id
                AND p.subject_key = initcap(lower(btrim(us.name)))
     ORDER BY s.class_id, s.exam_subject_id, (p.subject_id = s.exam_subject_id) DESC, p.subject_id
  ),
  cp AS MATERIALIZED (
    SELECT x.exam_id, x.class_id, x.exam_subject_id, x.st, x.d, m.pair_subject_id
      FROM cp0 x
      JOIN smap m ON m.class_id = x.class_id AND m.exam_subject_id = x.exam_subject_id
  ),
  -- Published results that count (published exam, published result, not
  -- absent, blank papers removed), dated in this year.
  cr AS MATERIALIZED (
    SELECT DISTINCT r.exam_id, r.class_id, r.exam_subject_id
      FROM public.dash5_counted_results(v_inst) r
     WHERE r.exam_date BETWEEN v_ay_start AND v_ay_end
  ),
  -- Marks entered but not published, per exam and class.
  mk AS MATERIALIZED (
    SELECT DISTINCT a.exam_id, a.class_id
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst
     WHERE fr.is_published IS NOT TRUE
  ),
  -- Hybrid papers are marked on their own plane and never reach final_results.
  hy AS MATERIALIZED (
    SELECT DISTINCT ha.exam_id, ha.class_id
      FROM hybrid_exam_attempts ha
     WHERE ha.institution_id = v_inst AND ha.status = 'evaluated'
  ),
  k AS (
    SELECT c.exam_id, c.class_id, c.pair_subject_id,
           bool_or(c.st = 'draft') is_draft,
           max(c.d) d,
           bool_or(cr.exam_id IS NOT NULL) is_out
      FROM cp c
      LEFT JOIN cr ON cr.exam_id = c.exam_id AND cr.class_id = c.class_id
                  AND cr.exam_subject_id = c.exam_subject_id
     GROUP BY 1, 2, 3
  ),
  -- Where each class paper sits. Marks prove a paper was sat, so a marked
  -- paper is held whatever date it carries; an unmarked one is "on the
  -- calendar" while its day is ahead and "held, no marks yet" once it passes.
  st AS (
    SELECT k.exam_id, k.class_id, k.pair_subject_id,
           CASE
             WHEN k.is_draft THEN CASE WHEN k.d >= v_ay_start THEN 'draft' END
             WHEN k.is_out THEN 'out'
             WHEN k.d NOT BETWEEN v_ay_start AND v_ay_end THEN NULL
             WHEN mk.exam_id IS NOT NULL OR hy.exam_id IS NOT NULL THEN 'pending'
             WHEN k.d > v_today THEN 'calendar'
             ELSE 'no_marks'
           END bucket
      FROM k
      LEFT JOIN mk ON mk.exam_id = k.exam_id AND mk.class_id = k.class_id
      LEFT JOIN hy ON hy.exam_id = k.exam_id AND hy.class_id = k.class_id
  ),
  per_pair AS (
    SELECT a0.class_id, a0.subject_id, a0.subject_key,
           count(s.exam_id) FILTER (WHERE s.bucket = 'out')::int n_out,
           count(s.exam_id) FILTER (WHERE s.bucket = 'pending')::int n_pend,
           count(s.exam_id) FILTER (WHERE s.bucket = 'no_marks')::int n_nomarks,
           count(s.exam_id) FILTER (WHERE s.bucket = 'calendar')::int n_cal,
           count(s.exam_id) FILTER (WHERE s.bucket = 'draft')::int n_draft
      FROM a0
      LEFT JOIN st s ON s.class_id = a0.class_id AND s.pair_subject_id = a0.subject_id
     GROUP BY 1, 2, 3
  ),
  pp2 AS (
    SELECT p.*, (p.n_out + p.n_pend) held,
           CASE WHEN p.n_out + p.n_pend > 0
                THEN GREATEST(round((p.n_out + p.n_pend) / v_gone)::int, p.n_out + p.n_pend)
                ELSE 1 END planned
      FROM per_pair p
  ),
  -- Subjects some class of the school has a published paper in this year,
  -- whatever the scope: "no class has examined it" is a school-wide fact.
  -- Published, so the split matches the task suggestions and the drawer,
  -- which read papers from dash5_atom_rows (counted results only).
  examined AS (
    SELECT DISTINCT p.subject_key
      FROM st s
      JOIN prs p ON p.class_id = s.class_id AND p.subject_id = s.pair_subject_id
     WHERE s.bucket = 'out'
  ),
  unexamined AS (
    SELECT pp2.subject_key, count(*) n
      FROM pp2
     WHERE pp2.n_out = 0
       AND NOT EXISTS (SELECT 1 FROM examined x WHERE x.subject_key = pp2.subject_key)
     GROUP BY 1
  ),
  agg AS (
    SELECT COALESCE(sum(held), 0)::int held,
           COALESCE(sum(planned), 0)::int planned,
           COALESCE(sum(n_out), 0)::int n_out,
           COALESCE(sum(n_pend), 0)::int n_pend,
           COALESCE(sum(n_nomarks), 0)::int n_nomarks,
           COALESCE(sum(n_cal), 0)::int n_cal,
           COALESCE(sum(n_draft), 0)::int n_draft,
           -- No PUBLISHED paper: the same test as every other card's "no paper".
           count(*) FILTER (WHERE n_out = 0)::int pairs_with_none,
           -- No paper held at all (marked or not): each owes the plan one.
           count(*) FILTER (WHERE held = 0)::int pairs_none_held,
           count(*)::int pairs
      FROM pp2
  )
  SELECT jsonb_build_object(
    'year_elapsed_pct', v_pace,
    'held', g.held, 'planned', g.planned,
    'remaining', GREATEST(g.planned - g.held, 0),
    'pending_publication', g.n_pend,
    'pending_papers', (SELECT count(DISTINCT s.exam_id)::int FROM st s
                         JOIN a0 ON a0.class_id = s.class_id AND a0.subject_id = s.pair_subject_id
                        WHERE s.bucket = 'pending'),
    'pairs', g.pairs, 'pairs_with_no_paper', g.pairs_with_none,
    'pairs_with_no_held_paper', g.pairs_none_held,
    'pairs_no_paper_unexamined', COALESCE((SELECT sum(n)::int FROM unexamined), 0),
    'unexamined_examples', COALESCE((SELECT jsonb_agg(u.subject_key ORDER BY u.n DESC, u.subject_key)
                                       FROM (SELECT * FROM unexamined ORDER BY n DESC, subject_key LIMIT 3) u),
                                    '[]'::jsonb),
    'on_pace', CASE WHEN g.planned > 0 THEN round(g.held * 100.0 / g.planned, 1) END,
    'held_results_out', g.n_out,
    'held_results_pending', g.n_pend,
    'held_no_marks', g.n_nomarks,
    'on_calendar', g.n_cal,
    'in_draft', g.n_draft,
    'not_written', GREATEST(g.planned - g.held - g.n_nomarks - g.n_cal - g.n_draft, 0),
    -- Kept for callers written against the previous shape.
    'drafted', g.n_draft,
    'unscheduled', GREATEST(g.planned - g.held - g.n_draft, 0)
  ) INTO v_out
  FROM agg g;

  RETURN v_out;
END
$function$;

-- ----------------------------------------------------------------- 3 -------
-- (Before 2 and 4, which call it.)
CREATE OR REPLACE FUNCTION public.resolve_flag_assignee(p_institution_id uuid, p_subject_type text, p_subject_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_class uuid;
BEGIN
  IF p_subject_type = 'class' THEN
    BEGIN v_class := p_subject_key::uuid; EXCEPTION WHEN others THEN v_class := NULL; END;
  ELSIF p_subject_type = 'student' THEN
    SELECT ca.class_id INTO v_class FROM class_assignments ca
      WHERE ca.user_id = p_subject_key::uuid AND ca.role='student' LIMIT 1;
  ELSIF p_subject_type = 'exam' THEN
    SELECT ec.class_id INTO v_class FROM exam_classes ec WHERE ec.exam_id = p_subject_key::uuid LIMIT 1;
  END IF;

  IF v_class IS NOT NULL THEN
    -- The class teacher: active, first by name.
    SELECT ca.user_id INTO v_uid FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id AND pf.is_active IS NOT FALSE
     WHERE ca.class_id = v_class AND ca.role='teacher' AND ca.subject_id IS NULL
     ORDER BY pf.full_name, pf.id LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
    -- The wing's coordinator. A wing_assignments row alone is not enough: at
    -- Salci National plain teachers hold such rows and were handed wing tasks.
    SELECT wa.user_id INTO v_uid FROM wing_class_mappings m
      JOIN wings w ON w.id = m.wing_id AND w.is_active IS NOT FALSE
      JOIN wing_assignments wa ON wa.wing_id = m.wing_id
      JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
     WHERE m.class_id = v_class
       AND EXISTS (SELECT 1 FROM user_roles ur
                    WHERE ur.user_id = wa.user_id AND ur.role = 'coordinator'
                      AND ur.institution_id = p_institution_id)
     ORDER BY w.display_order NULLS LAST, w.name, pf.full_name, pf.id LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  IF p_subject_type = 'subject' THEN
    SELECT ca.user_id INTO v_uid FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_institution_id
      JOIN profiles pf ON pf.id = ca.user_id AND pf.is_active IS NOT FALSE
      WHERE ca.role='teacher' AND ca.subject_id = p_subject_key::uuid
      ORDER BY pf.full_name, pf.id LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  -- Fallback: a school admin. Active, someone who has signed in at least once
  -- before a never-used account, then by name, so the same person is named
  -- every time.
  SELECT ur.user_id INTO v_uid FROM user_roles ur
    JOIN profiles pf ON pf.id = ur.user_id AND pf.is_active IS NOT FALSE
    LEFT JOIN auth.users u ON u.id = ur.user_id
   WHERE ur.institution_id = p_institution_id
     AND ur.role IN ('school_admin', 'super_school_admin')
   ORDER BY (u.last_sign_in_at IS NOT NULL) DESC, pf.full_name, pf.id
   LIMIT 1;
  RETURN v_uid;
END $function$;

REVOKE ALL ON FUNCTION public.resolve_flag_assignee(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_flag_assignee(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_flag_assignee(uuid, text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------- 2 -------
CREATE OR REPLACE FUNCTION public.dash5_task_suggestions(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb; v_pace numeric;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  -- The share of the year gone, not a fixed 74% (R12).
  v_pace := public.dash5_year_pace(v_inst);

  WITH aw AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  -- School totals: one row per (class, subject). dash5_atom_rows repeats a
  -- class once per wing it is mapped into (R1).
  a AS MATERIALIZED (
    SELECT DISTINCT ON (x.class_id, x.subject_id) x.*
      FROM aw x ORDER BY x.class_id, x.subject_id, x.wing_id NULLS LAST
  ),
  sc AS MATERIALIZED (SELECT * FROM public.dash5_student_counts(v_inst)),
  cls AS (
    SELECT a.class_id,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done, sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den
      FROM a GROUP BY 1
  ),
  labelled AS (
    SELECT c.*, cl.name || COALESCE(' ' || NULLIF(cl.section,''), '') label,
           CASE WHEN c.den > 0 THEN c.num/c.den END acc,
           CASE WHEN c.ch > 0 THEN (c.done*2+c.part)*100.0/(c.ch*2) END cov
      FROM cls c JOIN classes cl ON cl.id = c.class_id
  ),
  -- Per-wing views keep a class in every wing it is mapped into.
  wing_cls AS (SELECT DISTINCT aw.class_id, aw.wing_id FROM aw WHERE aw.wing_id IS NOT NULL),
  -- Pairs with no published paper, and how many of them are in subjects that
  -- no class of the school has examined this year (Library, Music, PT ...).
  nop AS (
    SELECT a.subject_key,
           NOT EXISTS (SELECT 1 FROM a y WHERE y.subject_key = a.subject_key AND y.papers > 0) unexamined
      FROM a WHERE a.papers = 0
  ),
  nop_n AS (
    SELECT count(*)::int n, count(*) FILTER (WHERE unexamined)::int m,
           (SELECT string_agg(z.k, ', ' ORDER BY z.c DESC, z.k)
              FROM (SELECT nop.subject_key k, count(*) c FROM nop WHERE nop.unexamined
                     GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 3) z) names
      FROM nop
  ),
  -- Distinct papers with a result still unpublished, the unit the school-wide
  -- card counts (103 at Alliance, not 110 class-subject rows).
  pend AS (
    SELECT count(DISTINCT e.id)::int n
      FROM final_results fr
      JOIN student_exam_attempts at ON at.id = fr.attempt_id
      JOIN exams e ON e.id = at.exam_id
     WHERE e.institution_id = v_inst AND fr.is_published IS NOT TRUE
  ),
  raw AS (
    (SELECT 'weakest_class' code, 1 priority, 'academic_content'::task_type ttype, 3 due_days,
            'Remedial plan for ' || l.label title,
            round(l.acc)::text || '% average, ' || round(COALESCE(l.cov,0))::text
              || '% syllabus coverage. Lowest in the school.' detail,
            public.resolve_flag_assignee(v_inst, 'class', l.class_id::text) assignee
       FROM labelled l WHERE l.acc IS NOT NULL ORDER BY l.acc LIMIT 1)

    UNION ALL
    SELECT 'pace_' || w.id::text, 1, 'academic_content'::task_type, 7,
           'Bring ' || n.cnt || ' class' || CASE WHEN n.cnt = 1 THEN '' ELSE 'es' END
             || ' in ' || w.name || ' back to the ' || v_pace || '% pace line',
           'The pace line is the share of the school year gone. Coverage is the leading indicator: a class behind now is a class revising in the exam week.',
           COALESCE((SELECT wa.user_id FROM wing_assignments wa
                       JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
                      WHERE wa.wing_id = w.id
                        AND EXISTS (SELECT 1 FROM user_roles ur
                                     WHERE ur.user_id = wa.user_id AND ur.role = 'coordinator'
                                       AND ur.institution_id = v_inst)
                      ORDER BY pf.full_name, pf.id LIMIT 1),
                    public.resolve_flag_assignee(v_inst, 'institution', v_inst::text))
      FROM wings w
      JOIN LATERAL (SELECT count(*)::int cnt FROM wing_cls wc JOIN labelled l ON l.class_id = wc.class_id
                     WHERE wc.wing_id = w.id AND l.cov IS NOT NULL AND l.cov < v_pace) n ON true
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE AND n.cnt > 0

    UNION ALL
    SELECT 'no_paper', 2, 'exam_related'::task_type, 5,
           'Schedule papers for ' || x.n || ' subject-class pair' || CASE WHEN x.n = 1 THEN '' ELSE 's' END
             || ' with no published paper this year',
           CASE WHEN x.m > 0
                THEN x.m || ' of them are in subjects no class has examined this year ('
                       || x.names || '), so check whether those are examined at all. '
                ELSE '' END
             || 'Until a paper''s results are published, the pair is left out of every average on the dashboard.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM nop_n x WHERE x.n > 0

    UNION ALL
    SELECT 'pending_results', 2, 'exam_related'::task_type, 4,
           'Publish results for ' || x.n || ' paper' || CASE WHEN x.n = 1 THEN '' ELSE 's' END || ' already marked',
           'Students and parents cannot see these marks, and the averages on this page leave them out until they are published.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM pend x WHERE x.n > 0

    UNION ALL
    SELECT 'never_in', 2, 'student_support'::task_type, 10,
           'Onboard ' || x.n || ' students who have never signed in',
           'Nothing they do is measured until they do.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(never_in)::int n FROM sc) x WHERE x.n > 0

    UNION ALL
    SELECT 'attendance_floor', 1, 'student_support'::task_type, 5,
           'Contact families of ' || x.n || ' students below the 75% attendance line',
           'Attendance this year is under 75%. Approved leave counts as a day not present.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(below_floor)::int n FROM sc) x WHERE x.n > 0
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

-- ----------------------------------------------------------------- 4 -------
CREATE OR REPLACE FUNCTION public.dash5_assign_context(p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid;
  v_pace numeric; v_scope text; v_label text; v_sublabel text;
  v_wing uuid; v_tid uuid; v_tname text; v_trole text; v_exact boolean := true;
  v_full text;
  v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);

  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  -- Pace is how much of the year has gone (shared rule), not a fixed line.
  v_pace := public.dash5_year_pace(v_inst);

  v_wing := p_wing_id;
  IF v_wing IS NULL AND p_class_id IS NOT NULL THEN
    SELECT m.wing_id INTO v_wing FROM wing_class_mappings m WHERE m.class_id = p_class_id LIMIT 1;
  END IF;

  /* ---- scope + label ---- */
  -- Everything this function emits is plain ASCII on purpose. Prod SQL is
  -- applied through scripts/run-sql.ps1, and PowerShell 5.1 mangles non-ASCII
  -- in a request body, so a middot baked into a label here reaches the database
  -- as mojibake. The drawer composes its own separator on the client.
  IF p_class_id IS NOT NULL AND p_subject_id IS NOT NULL THEN
    v_scope := 'subject';
    SELECT us.name, c.name || COALESCE(' ' || NULLIF(c.section,''), '')
      INTO v_label, v_sublabel
      FROM classes c, universal_subjects us
     WHERE c.id = p_class_id AND us.id = p_subject_id;
  ELSIF p_class_id IS NOT NULL THEN
    v_scope := 'class';
    SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '') INTO v_label
      FROM classes c WHERE c.id = p_class_id;
  ELSIF v_wing IS NOT NULL THEN
    v_scope := 'wing';
    SELECT w.name INTO v_label FROM wings w WHERE w.id = v_wing;
  ELSE
    v_scope := 'school';
    SELECT i.name INTO v_label FROM institutions i WHERE i.id = v_inst;
  END IF;

  -- What a task title calls this scope. A subject on its own reads as
  -- "Bring Painting back to the pace line", which is true of no particular
  -- class; the class has to be in the sentence.
  v_full := v_label || COALESCE(' in ' || v_sublabel, '');

  /* ---- owner, narrowest first, falling back rather than failing ---- */
  IF v_scope = 'subject' THEN
    SELECT ca.user_id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.class_id = p_class_id AND ca.subject_id = p_subject_id
       AND ca.role::text = 'teacher' AND pf.is_active IS NOT FALSE
     ORDER BY pf.full_name, pf.id LIMIT 1;
    v_trole := 'Subject teacher';
  END IF;

  IF v_tid IS NULL AND p_class_id IS NOT NULL THEN
    IF v_scope = 'subject' THEN v_exact := false; END IF;
    SELECT ca.user_id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.class_id = p_class_id AND ca.subject_id IS NULL
       AND ca.role::text = 'teacher' AND pf.is_active IS NOT FALSE
     ORDER BY pf.full_name, pf.id LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'Class teacher'; END IF;
  END IF;

  IF v_tid IS NULL AND v_wing IS NOT NULL THEN
    IF v_scope <> 'wing' THEN v_exact := false; END IF;
    SELECT wa.user_id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM wing_assignments wa
      JOIN profiles pf ON pf.id = wa.user_id
     WHERE wa.wing_id = v_wing AND pf.is_active IS NOT FALSE
       AND EXISTS (SELECT 1 FROM user_roles ur
                    WHERE ur.user_id = pf.id AND ur.role::text = 'coordinator'
                      AND ur.institution_id = v_inst)
     ORDER BY pf.full_name, pf.id LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'Wing coordinator'; END IF;
  END IF;

  IF v_tid IS NULL THEN
    v_exact := false;
    -- Same rule as resolve_flag_assignee: an active admin who has signed in
    -- at least once, then by name, so every card names the same person.
    SELECT pf.id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM user_roles ur
      JOIN profiles pf ON pf.id = ur.user_id AND pf.is_active IS NOT FALSE
      LEFT JOIN auth.users u ON u.id = ur.user_id
     WHERE ur.institution_id = v_inst
       AND ur.role::text IN ('school_admin','super_school_admin')
     ORDER BY (u.last_sign_in_at IS NOT NULL) DESC, pf.full_name, pf.id
     LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'School admin'; END IF;
  END IF;

  /* ---- the figures the ask has to stand on ---- */
  WITH aw AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  -- One row per (class, subject) in scope. dash5_atom_rows repeats a class
  -- once per wing it is mapped into, which doubled every school sum (R1).
  a AS MATERIALIZED (
    SELECT DISTINCT ON (x.class_id, x.subject_id) x.*
      FROM aw x
     WHERE (v_wing IS NULL OR p_class_id IS NOT NULL OR x.wing_id = v_wing)
       AND (p_class_id IS NULL OR x.class_id = p_class_id)
       AND (p_subject_id IS NULL OR x.subject_id = p_subject_id)
     ORDER BY x.class_id, x.subject_id, x.wing_id NULLS LAST
  ),
  -- Subject names some class of the school has a published paper in.
  examined AS (SELECT DISTINCT aw.subject_key FROM aw WHERE aw.papers > 0),
  unexam AS (
    SELECT a.subject_key, count(*)::int n FROM a
     WHERE a.papers = 0
       AND NOT EXISTS (SELECT 1 FROM examined x WHERE x.subject_key = a.subject_key)
     GROUP BY 1
  ),
  -- Distinct papers with a result still unpublished, in this scope. An exam's
  -- subject reaches the class's own subject by id or by name (R2).
  pd AS (
    SELECT count(DISTINCT at.exam_id)::int n
      FROM final_results fr
      JOIN student_exam_attempts at ON at.id = fr.attempt_id
      JOIN exams e ON e.id = at.exam_id AND e.institution_id = v_inst
      JOIN exam_subjects es ON es.exam_id = e.id
      JOIN universal_subjects us ON us.id = es.subject_id
     WHERE fr.is_published IS NOT TRUE
       -- The same id always has the same name, so one equality test on the
       -- name covers both the exact and the same-name match.
       AND EXISTS (SELECT 1 FROM a
                    WHERE a.class_id = at.class_id
                      AND a.subject_key = initcap(lower(btrim(us.name))))
  ),
  g AS (
    SELECT count(*)::int pairs,
           count(*) FILTER (WHERE a.papers = 0)::int pairs_no_paper,
           COALESCE(sum(a.chapters),0)::int chapters,
           COALESCE(sum(a.chapters_done),0)::int chapters_done,
           COALESCE(sum(a.chapters_partial),0)::int chapters_partial,
           COALESCE(sum(a.lessons_taught),0)::int lt,
           COALESCE(sum(a.lessons_planned),0)::int lp,
           COALESCE(sum(a.papers),0)::int papers,
           (SELECT n FROM pd) pending,
           COALESCE((SELECT sum(n) FROM unexam), 0)::int unexamined,
           (SELECT string_agg(z.subject_key, ', ' ORDER BY z.n DESC, z.subject_key)
              FROM (SELECT * FROM unexam ORDER BY n DESC, subject_key LIMIT 3) z) unexamined_names,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) acc_num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) acc_den,
           COALESCE(sum(a.hw_slots),0)::int hw_slots,
           COALESCE(sum(a.hw_submitted),0)::int hw_done
      FROM a
  ),
  -- Attendance and the head count are per-CLASS figures, so they are summed
  -- over distinct classes rather than over atoms: a class with nine subjects
  -- would otherwise weigh nine times as much as a class with one. Summing
  -- DISTINCT students would be worse still, since two classes of thirty would
  -- collapse to thirty.
  k AS (
    SELECT COALESCE(sum(p.att_present),0)::numeric present,
           COALESCE(sum(p.att_total),0)::numeric total,
           COALESCE(sum(p.students),0)::int students,
           count(*)::int classes
      FROM (SELECT DISTINCT ON (a.class_id) a.class_id, a.students, a.att_present, a.att_total
              FROM a ORDER BY a.class_id) p
  ),
  m AS (
    SELECT g.*, k.students, k.classes,
           CASE WHEN g.chapters > 0
                THEN round((g.chapters_done*2 + g.chapters_partial)*100.0/(g.chapters*2),1) END cov,
           CASE WHEN g.acc_den > 0 THEN round(g.acc_num/g.acc_den,1) END acc,
           CASE WHEN g.hw_slots > 0 THEN round(g.hw_done*100.0/g.hw_slots,1) END hw,
           CASE WHEN k.total > 0 THEN round(k.present*100.0/k.total,1) END att
      FROM g, k
  )
  SELECT jsonb_build_object(
    'scope', v_scope,
    'label', v_label,
    'sublabel', v_sublabel,
    'full_label', v_full,
    'pace_pct', v_pace,
    'target', jsonb_build_object(
      'id', v_tid, 'name', v_tname, 'role', v_trole, 'exact', v_exact),
    'stats', jsonb_build_array(
      jsonb_build_object('label', 'Average score', 'value', m.acc, 'unit', '%'),
      jsonb_build_object('label', 'Coverage',      'value', m.cov, 'unit', '%'),
      jsonb_build_object('label', 'Attendance',    'value', m.att, 'unit', '%')),
    'facts', jsonb_build_object(
      'pairs', m.pairs, 'pairs_no_paper', m.pairs_no_paper,
      'pairs_no_paper_unexamined', m.unexamined,
      'chapters', m.chapters, 'chapters_done', m.chapters_done,
      'chapters_partial', m.chapters_partial,
      'lessons_taught', m.lt, 'lessons_planned', m.lp,
      'papers', m.papers, 'pending_grading', m.pending,
      'homework_pct', m.hw, 'students', m.students, 'classes', m.classes,
      'coverage_pct', m.cov, 'accuracy_pct', m.acc, 'attendance_pct', m.att),

    -- Suggestions are written against THESE figures, so a wing that is on pace
    -- is not offered a catch-up task it does not need. Every one of them is
    -- suppressed when the condition behind it is absent.
    'suggestions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'title', s.title, 'detail', s.detail, 'priority', s.priority,
               'task_type', s.ttype, 'due_days', s.due_days) ORDER BY s.priority, s.title), '[]'::jsonb)
        FROM (
          SELECT 1 priority, 'academic_content'::task_type ttype, 7 due_days,
                 'Bring ' || v_full || ' back to the ' || v_pace || '% pace line' title,
                 'Coverage is ' || m.cov || '%, which is ' || round(v_pace - m.cov, 1)
                   || ' points behind where the year has got to. '
                   || (m.chapters - m.chapters_done - m.chapters_partial)
                   || ' chapters have not been started.' detail
           WHERE m.cov IS NOT NULL AND m.cov < v_pace - 3

          UNION ALL
          SELECT 2, 'academic_content'::task_type, 10,
                 'Finish the ' || m.chapters_partial || ' partly-done chapter'
                   || CASE WHEN m.chapters_partial = 1 THEN '' ELSE 's' END || ' in ' || v_label,
                 'A partly-done chapter counts as half a finished one, so closing these is the cheapest coverage available.'
           WHERE m.chapters_partial > 0

          UNION ALL
          SELECT 1, 'exam_related'::task_type, 5,
                 'Conduct a first paper in ' || m.pairs_no_paper || ' subject-class pair'
                   || CASE WHEN m.pairs_no_paper = 1 THEN '' ELSE 's' END,
                 m.pairs_no_paper || ' of ' || m.pairs || ' subject-class pairs have no published paper this year'
                   || CASE WHEN m.unexamined > 0
                           THEN ', ' || m.unexamined || ' of them in subjects no class has examined this year ('
                                || m.unexamined_names || ')'
                           ELSE '' END
                   || '. Until results are published they are left out of every score on the dashboard.'
           WHERE m.pairs_no_paper > 0

          UNION ALL
          SELECT 2, 'exam_related'::task_type, 4,
                 'Publish results for ' || m.pending || ' paper'
                   || CASE WHEN m.pending = 1 THEN '' ELSE 's' END,
                 'Marks are entered but not published, so students and parents cannot see them and the averages here do not count them.'
           WHERE m.pending > 0

          UNION ALL
          SELECT 1, 'student_support'::task_type, 5,
                 'Attendance plan for ' || v_full,
                 'Attendance is ' || m.att || '%, below the 75% line.'
           WHERE m.att IS NOT NULL AND m.att < 75

          UNION ALL
          SELECT 2, 'academic_content'::task_type, 7,
                 'Raise online homework submission in ' || v_full,
                 'Online submission is running at ' || m.hw || '% of the homework set to these classes. Homework checked on paper is not counted here.'
           WHERE m.hw IS NOT NULL AND m.hw < 60

          UNION ALL
          SELECT 1, 'academic_content'::task_type, 7,
                 'Remedial plan for ' || v_full,
                 'The average score is ' || m.acc || '%, which is below the 50% line.'
           WHERE m.acc IS NOT NULL AND m.acc < 50
        ) s)
  ) INTO v_out FROM m;

  RETURN v_out;
END
$function$;

-- ----------------------------------------------------------------- 5 -------
CREATE OR REPLACE FUNCTION public.dash5_school_wide_needs(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_proc int; v_proc_high int; v_proc_old int; v_proc_top text;
  v_issues int; v_issue_days int;
  v_leave int; v_leave_days int; v_leave_past int;
  v_staff_leave int; v_staff_past int; v_unpub int;
  v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  -- Sessions still waiting for a review decision, and their high-severity
  -- events read from the event log itself. The session counter was written
  -- twice per event (trigger plus browser), so it read double (R13).
  WITH pend AS (
    SELECT ps.id, ps.created_at
      FROM proctoring_sessions ps
      JOIN student_exam_attempts a ON a.id = ps.attempt_id
      JOIN exams e ON e.id = a.exam_id
     WHERE e.institution_id = v_inst
       AND ps.requires_review IS TRUE
       AND COALESCE(ps.review_status, 'pending') = 'pending'
  ),
  ev AS (
    SELECT pe.event_type::text t, count(*)::int n
      FROM proctoring_events pe JOIN pend ON pend.id = pe.session_id
     WHERE pe.severity::text = 'high'
     GROUP BY 1
  )
  SELECT (SELECT count(*)::int FROM pend),
         (SELECT count(*)::int FROM pend WHERE pend.created_at < now() - INTERVAL '30 days'),
         COALESCE((SELECT sum(ev.n)::int FROM ev), 0),
         (SELECT ev.t FROM ev ORDER BY ev.n DESC, ev.t LIMIT 1)
    INTO v_proc, v_proc_old, v_proc_high, v_proc_top;

  SELECT count(*)::int,
         COALESCE(max((v_today - (ri.created_at AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date)), 0)::int
    INTO v_issues, v_issue_days
    FROM reported_issues ri
   WHERE ri.institution_id = v_inst
     AND ri.status::text NOT IN ('resolved', 'closed');

  SELECT count(*)::int,
         COALESCE(max((v_today - (lr.created_at AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date)), 0)::int,
         count(*) FILTER (WHERE lr.end_date < v_today)::int
    INTO v_leave, v_leave_days, v_leave_past
    FROM leave_requests lr
   WHERE lr.institution_id = v_inst AND lr.status::text = 'pending';

  SELECT count(*)::int, count(*) FILTER (WHERE sl.end_date < v_today)::int
    INTO v_staff_leave, v_staff_past
    FROM staff_leave_requests sl
   WHERE sl.institution_id = v_inst AND sl.status::text = 'pending';

  SELECT count(DISTINCT e.id)::int INTO v_unpub
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
   WHERE e.institution_id = v_inst AND fr.is_published IS NOT TRUE;

  -- `goto` is the dashboard section the old UI scrolls to; `href` is the page
  -- where the item can actually be acted on.
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'severity', x.sev, 'title', x.t, 'detail', x.s,
               'cta', x.cta, 'goto', x.go, 'href', x.href) ORDER BY x.ord)
        FROM (
          SELECT 1 ord, 'High' sev,
                 v_proc || ' proctoring session' || CASE WHEN v_proc = 1 THEN '' ELSE 's' END
                   || ' flagged for review' t,
                 CASE WHEN v_proc_high > 0
                      THEN v_proc_high || ' high-severity event' || CASE WHEN v_proc_high = 1 THEN '' ELSE 's' END
                           || ' logged across them, most often '
                           || CASE v_proc_top
                                WHEN 'face_not_detected' THEN 'no face in the camera frame'
                                WHEN 'tab_switch' THEN 'a switch to another tab'
                                WHEN 'fullscreen_exited' THEN 'leaving full screen'
                                WHEN 'multiple_faces' THEN 'a second face in the frame'
                                WHEN 'browser_devtools_opened' THEN 'developer tools opened'
                                ELSE replace(COALESCE(v_proc_top, 'an alert'), '_', ' ') END
                           || '.'
                      ELSE 'Flagged by the proctor but not yet looked at.' END
                   || CASE WHEN v_proc_old > 0
                           THEN ' ' || v_proc_old || ' of the sessions are more than 30 days old.'
                           ELSE '' END s,
                 'Open proctoring' cta, 'sec-academics' go, '/proctoring/live' href
           WHERE v_proc > 0

          UNION ALL
          SELECT 2, CASE WHEN v_unpub > 6 THEN 'High' ELSE 'Medium' END,
                 v_unpub || ' paper' || CASE WHEN v_unpub = 1 THEN '' ELSE 's' END
                   || ' marked but not published',
                 'Students and parents cannot see these marks, and the averages on this page leave them out.',
                 'Publish', 'sec-academics', '/exams'
           WHERE v_unpub > 0

          UNION ALL
          SELECT 3, 'Medium',
                 v_issues || ' open platform issue' || CASE WHEN v_issues = 1 THEN '' ELSE 's' END,
                 CASE WHEN v_issue_days > 0
                      THEN 'Raised from inside the school. Oldest open ' || v_issue_days
                           || ' day' || CASE WHEN v_issue_days = 1 THEN '' ELSE 's' END || '.'
                      ELSE 'Raised from inside the school, all opened today.' END,
                 'Open support', 'sec-needs', '/support'
           WHERE v_issues > 0

          UNION ALL
          SELECT 4, 'Medium',
                 v_leave || ' student leave request'
                   || CASE WHEN v_leave = 1 THEN '' ELSE 's' END || ' awaiting a decision',
                 CASE WHEN v_leave_days > 0
                      THEN 'Oldest submitted ' || v_leave_days || ' day'
                           || CASE WHEN v_leave_days = 1 THEN '' ELSE 's' END || ' ago.'
                      ELSE 'All submitted today.' END
                   || CASE WHEN v_leave_past > 0
                           THEN ' ' || v_leave_past || ' of them '
                                || CASE WHEN v_leave_past = 1 THEN 'is' ELSE 'are' END
                                || ' for days already past.'
                           ELSE '' END,
                 'Review leave', 'sec-attendance', '/school/attendance?tab=leaves'
           WHERE v_leave > 0

          UNION ALL
          SELECT 5, 'Medium',
                 v_staff_leave || ' staff leave request'
                   || CASE WHEN v_staff_leave = 1 THEN '' ELSE 's' END || ' awaiting a decision',
                 CASE WHEN v_staff_past = v_staff_leave
                      THEN CASE WHEN v_staff_leave = 1 THEN 'It is for dates already past.'
                                ELSE 'All of them are for dates already past.' END
                      ELSE (v_staff_leave - v_staff_past) || ' start'
                           || CASE WHEN v_staff_leave - v_staff_past = 1 THEN 's' ELSE '' END
                           || ' today or later: approving one without a substitution leaves a class unattended.'
                           || CASE WHEN v_staff_past > 0
                                   THEN ' ' || v_staff_past || ' '
                                        || CASE WHEN v_staff_past = 1 THEN 'is' ELSE 'are' END
                                        || ' for dates already past.'
                                   ELSE '' END
                 END,
                 'Review leave', 'sec-teachers', '/staff/workday?tab=staff-leaves'
           WHERE v_staff_leave > 0
        ) x), '[]'::jsonb),
    'counts', jsonb_build_object(
      'proctoring', v_proc, 'issues', v_issues, 'student_leave', v_leave,
      'staff_leave', v_staff_leave, 'unpublished_papers', v_unpub,
      'proctoring_high_events', v_proc_high)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- ----------------------------------------------------------------- 6 -------
CREATE OR REPLACE FUNCTION public.dash5_communication(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  WITH n AS (
    -- Sent this year. A notice scheduled for later has not been sent yet.
    SELECT nt.* FROM notices nt
     WHERE nt.institution_id = v_inst
       AND COALESCE(nt.published_at::date, nt.created_at::date) BETWEEN v_ay_start AND v_ay_end
       AND COALESCE(nt.published_at, nt.created_at) <= now()
  ),
  -- Opened and acknowledged are real columns on notice_recipients, so the
  -- reference's "Acknowledged" bar is answerable here after all; only the push
  -- channel is not.
  nr AS (
    SELECT count(*)::int total,
           count(*) FILTER (WHERE r.read_at IS NOT NULL)::int opened,
           count(*) FILTER (WHERE r.acknowledged_at IS NOT NULL)::int acked,
           count(*) FILTER (WHERE nq.requires_acknowledgement)::int ack_due
      FROM notice_recipients r JOIN n nq ON nq.id = r.notice_id
  ),
  p AS (
    SELECT ps.*,
           -- Slots offered: the window divided by the slot length. Without this
           -- denominator "146 booked" says nothing about whether the meeting
           -- filled up.
           CASE WHEN ps.start_time IS NOT NULL AND ps.end_time IS NOT NULL
                     AND COALESCE(ps.slot_duration_minutes, 0) > 0
                THEN GREATEST(floor(EXTRACT(EPOCH FROM (ps.end_time - ps.start_time)) / 60
                                    / ps.slot_duration_minutes)::int, 0) END slots
      FROM ptm_schedules ps
     WHERE ps.institution_id = v_inst
       AND ps.scheduled_date BETWEEN v_today AND v_today + 30
       -- A cancelled meeting is not a meeting in the next 30 days.
       AND ps.cancelled_at IS NULL AND COALESCE(ps.status, '') <> 'cancelled'
  ),
  bk AS (
    SELECT b.ptm_id, count(*)::int n,
           count(*) FILTER (WHERE b.feedback IS NOT NULL OR b.rating IS NOT NULL)::int fed
      FROM ptm_bookings b JOIN p ON p.id = b.ptm_id
     WHERE b.cancelled_at IS NULL AND COALESCE(b.status, '') <> 'cancelled'
     GROUP BY 1
  ),
  bt AS (
    SELECT COALESCE(sum(bk.n), 0)::int booked, COALESCE(sum(bk.fed), 0)::int fed FROM bk
  ),
  pt AS (SELECT COALESCE(sum(p.slots), 0)::int slots, count(*)::int meetings FROM p)
  SELECT jsonb_build_object(
    'channels_live', false,
    'circulars', jsonb_build_object(
      'total', (SELECT count(*)::int FROM n),
      'requiring_ack', (SELECT count(*)::int FROM n WHERE n.requires_acknowledgement),
      'recipients', (SELECT COALESCE(sum(n.recipient_count), 0)::int FROM n),
      'reached', (SELECT total FROM nr),
      'opened', (SELECT opened FROM nr),
      'acknowledged', (SELECT acked FROM nr),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'type', r.type::text,
                 'published_at', COALESCE(r.published_at, r.created_at),
                 'recipients', r.recipient_count,
                 'opened', (SELECT count(*)::int FROM notice_recipients x
                             WHERE x.notice_id = r.id AND x.read_at IS NOT NULL),
                 'requires_ack', r.requires_acknowledgement)
               ORDER BY COALESCE(r.published_at, r.created_at) DESC)
          FROM (SELECT * FROM n
                 ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT 6) r), '[]'::jsonb)),
    'ptm', jsonb_build_object(
      'total', (SELECT meetings FROM pt),
      'slots', (SELECT slots FROM pt),
      'bookings', (SELECT booked FROM bt),
      'feedback', (SELECT fed FROM bt),
      -- Meetings already held this year, so a school with past PTMs and none
      -- coming up is not told it has sent or scheduled nothing.
      'held_this_year', (SELECT count(*)::int FROM ptm_schedules h
                          WHERE h.institution_id = v_inst
                            AND h.scheduled_date >= v_ay_start AND h.scheduled_date < v_today
                            AND h.cancelled_at IS NULL AND COALESCE(h.status, '') <> 'cancelled'),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'date', r.scheduled_date,
                 'status', r.status::text, 'slots', r.slots,
                 'bookings', COALESCE((SELECT bk.n FROM bk WHERE bk.ptm_id = r.id), 0))
               ORDER BY r.scheduled_date)
          FROM (SELECT * FROM p ORDER BY p.scheduled_date LIMIT 6) r), '[]'::jsonb)),

    -- `unit` tells the card whether a bar is a rate to draw against 100 or a
    -- count to scale against its neighbours. Mixing the two silently is how a
    -- 4-count bar ends up looking longer than an 88% one.
    'reach', jsonb_build_array(
      jsonb_build_object('label', 'Circulars published', 'unit', 'count',
                         'value', (SELECT count(*)::int FROM n)),
      jsonb_build_object('label', 'People the circulars reached', 'unit', 'count',
                         'value', (SELECT total FROM nr)),
      jsonb_build_object('label', 'Opened', 'unit', 'pct',
                         'value', (SELECT CASE WHEN total > 0
                                     THEN round(opened*100.0/total, 1) END FROM nr),
                         'of', (SELECT total FROM nr)),
      jsonb_build_object('label', 'Acknowledged', 'unit', 'pct',
                         'value', (SELECT CASE WHEN ack_due > 0
                                     THEN round(acked*100.0/ack_due, 1) END FROM nr),
                         'of', (SELECT ack_due FROM nr)),
      jsonb_build_object('label', 'Meetings in the next 30 days', 'unit', 'count',
                         'value', (SELECT meetings FROM pt)),
      jsonb_build_object('label', 'PTM slots booked', 'unit', 'pct',
                         'value', (SELECT CASE WHEN pt.slots > 0
                                     THEN round(bt.booked*100.0/pt.slots, 1) END
                                     FROM pt, bt),
                         'of', (SELECT slots FROM pt),
                         'n', (SELECT booked FROM bt)),
      jsonb_build_object('label', 'PTM feedback left', 'unit', 'pct',
                         'value', (SELECT CASE WHEN booked > 0
                                     THEN round(fed*100.0/booked, 1) END FROM bt),
                         'of', (SELECT booked FROM bt)))
  ) INTO v_out;

  RETURN v_out;
END
$function$;
