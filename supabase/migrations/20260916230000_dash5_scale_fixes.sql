-- Admin Dashboard v5: scale fixes.
--
-- Measured on Alliance before this change: ONE page load cost 9.7 seconds of
-- database work across thirteen dash5_* calls. Five of them rebuilt the
-- 1,545-student atom independently at ~1.4s each. Wall clock hid it because the
-- browser fires them in parallel, but the WORK is what multiplies by concurrent
-- admins, and 100 admins landing together is 970 seconds of database time.
-- That is the 2026-05-16 shape, so it does not ship.
--
-- Two of the five did not need the student atom at all. They now compute the
-- two counts they actually wanted, directly.

/* ----------------------------------------------- cheap student counters --- */

-- Never-signed-in and below-the-attendance-floor, per wing, WITHOUT building a
-- per-student row for the whole school. Both are single aggregates.
CREATE OR REPLACE FUNCTION public.dash5_student_counts(p_inst uuid)
RETURNS TABLE (wing_id uuid, never_in int, below_floor int, students int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(p_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  WITH base AS (
    SELECT DISTINCT ON (s.student_id) s.student_id, m.wing_id
      FROM public.institution_student_ids(p_inst) s
      JOIN class_assignments ca ON ca.user_id = s.student_id AND ca.role::text = 'student'
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_inst AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     ORDER BY s.student_id, c.name
  ),
  att AS (
    SELECT ar.student_id,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::numeric p,
           count(*)::numeric n
      FROM attendance_records ar
     WHERE ar.institution_id = p_inst AND ar.date BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  )
  SELECT b.wing_id,
         count(*) FILTER (WHERE u.last_sign_in_at IS NULL)::int,
         count(*) FILTER (WHERE a.n > 0 AND a.p * 100.0 / a.n < 75)::int,
         count(*)::int
    FROM base b
    LEFT JOIN auth.users u ON u.id = b.student_id
    LEFT JOIN att a ON a.student_id = b.student_id
   GROUP BY b.wing_id;
END
$function$;

/* ------------------------------------------------- task suggestions ------- */

-- Was 1,778ms because it built BOTH atoms. It only ever wanted two student
-- counts, which dash5_student_counts now supplies without a per-student row.
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
  sc AS MATERIALIZED (SELECT * FROM public.dash5_student_counts(v_inst)),
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
           'Coverage is the leading indicator: a class behind now is a class revising in the exam week.',
           COALESCE((SELECT wa.user_id FROM wing_assignments wa WHERE wa.wing_id = w.id LIMIT 1),
                    public.resolve_flag_assignee(v_inst, 'institution', v_inst::text))
      FROM wings w
      JOIN LATERAL (SELECT count(*)::int cnt FROM labelled l
                     WHERE l.wing_id = w.id AND l.cov IS NOT NULL AND l.cov < v_pace) n ON true
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE AND n.cnt > 0

    UNION ALL
    SELECT 'no_paper', 2, 'exam_related'::task_type, 5,
           'Schedule papers for ' || x.n || ' subject-class pairs with nothing set',
           'They are excluded from every average on the dashboard, so the school figure rests on '
             || 'thinner evidence than it looks.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(no_paper)::int n FROM cls) x WHERE x.n > 0

    UNION ALL
    SELECT 'pending_results', 2, 'exam_related'::task_type, 4,
           'Publish results for ' || x.n || ' papers already written',
           'Parents and students cannot be told anything until these close.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(pending)::int n FROM cls) x WHERE x.n > 0

    UNION ALL
    SELECT 'never_in', 2, 'student_support'::task_type, 10,
           'Onboard ' || x.n || ' students who have never signed in',
           'Nothing they do is measured until they do.',
           public.resolve_flag_assignee(v_inst, 'institution', v_inst::text)
      FROM (SELECT sum(never_in)::int n FROM sc) x WHERE x.n > 0

    UNION ALL
    SELECT 'attendance_floor', 1, 'student_support'::task_type, 5,
           'Contact families of ' || x.n || ' students below the 75% attendance floor',
           'Board eligibility risk.',
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

/* --------------------------------------------------- needs by wing -------- */

-- Was 1,673ms for the same reason. The at-risk count is the only figure here
-- that genuinely needed the student atom, and it is the same rule the Students
-- section already publishes, so this now reads the cheap counters and reports
-- the two student facts it can compute directly. The at-risk line moves to the
-- Students section where its list already lives, rather than being recomputed
-- here to say a number the reader can already see.
CREATE OR REPLACE FUNCTION public.dash5_needs_by_wing(
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
  sc AS MATERIALIZED (SELECT * FROM public.dash5_student_counts(v_inst)),
  cls AS (
    SELECT a.class_id, a.wing_id,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done, sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*) FILTER (WHERE a.papers = 0)::int no_paper,
           sum(a.pending_grading)::int pending
      FROM a GROUP BY 1,2
  ),
  per_wing AS (
    SELECT w.id wing_id, w.name wing_name,
           count(*) FILTER (WHERE c.ch > 0
             AND (c.done*2 + c.part)*100.0/(c.ch*2) < v_pace)::int behind,
           count(*) FILTER (WHERE c.den > 0 AND c.num/c.den < 70)::int weak,
           COALESCE(sum(c.no_paper), 0)::int no_paper,
           COALESCE(sum(c.pending), 0)::int pending,
           COALESCE(max(k.never_in), 0)::int never_in,
           COALESCE(max(k.below_floor), 0)::int chronic
      FROM wings w
      LEFT JOIN cls c ON c.wing_id = w.id
      LEFT JOIN sc  k ON k.wing_id = w.id
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
     GROUP BY w.id, w.name
  ),
  items AS (
    SELECT p.wing_id, p.wing_name, i.sev, i.n,
           i.n || ' ' || i.title AS title, i.detail, i.cta
      FROM per_wing p
      CROSS JOIN LATERAL (VALUES
        ('High',   p.behind,   'classes behind the pace line',
                   'Coverage is the leading indicator: a class behind now is a class revising in the exam week.', 'academics'),
        ('High',   p.weak,     'classes averaging below 70%',
                   'Sustained across more than one cycle this is a teaching-support question, not a student-effort one.', 'overview'),
        ('High',   p.chronic,  'students below the 75% attendance floor',
                   'Board eligibility risk.', 'attendance'),
        ('Medium', p.no_paper, 'subject-class pairs with no paper this year',
                   'Nothing to grade means nothing to measure. These are invisible in every score above.', 'academics'),
        ('Medium', p.never_in, 'students have never signed in',
                   'Nothing they do is measured until they do.', 'students'),
        ('Medium', p.pending,  'papers written but not yet published',
                   'Results cannot reach parents until these close.', 'academics')
      ) AS i(sev, n, title, detail, cta)
     WHERE i.n > 0
  ),
  wing_json AS (
    SELECT p.wing_id, p.wing_name,
           (SELECT count(*)::int FROM items i WHERE i.wing_id = p.wing_id) cnt,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'severity', i.sev, 'title', i.title, 'detail', i.detail, 'goto', i.cta)
               ORDER BY CASE i.sev WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, i.n DESC)
             FROM items i WHERE i.wing_id = p.wing_id), '[]'::jsonb) items
      FROM per_wing p
  )
  SELECT jsonb_build_object(
    'pace', v_pace,
    'total', (SELECT count(*)::int FROM items),
    'wings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'wing_id', w.wing_id, 'wing_name', w.wing_name,
        'count', w.cnt, 'items', w.items) ORDER BY w.cnt DESC, w.wing_name)
      FROM wing_json w), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- Internal, trusts its institution argument, so no client role may call it.
REVOKE EXECUTE ON FUNCTION public.dash5_student_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dash5_student_counts(uuid) TO service_role;
