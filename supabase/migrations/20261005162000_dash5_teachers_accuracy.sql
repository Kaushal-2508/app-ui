-- Admin dashboard accuracy pass: the "Teachers & staff" section.
-- Audit: docs/admin-dashboard-audit-2026-10-05.md (R2, R3, R10, R14, R17, R6).
-- Owner decisions, Tushar 2026-10-05: averages use PUBLISHED marks only and
-- leave blank papers out (dash5_counted_results); teacher engagement is
-- work-based; a missing badge input is skipped, not scored 0.
--
-- dash5_teacher_activity
--   * last_seen_days is real session time (R3): the later of the last password
--     sign-in and the last time a session was refreshed. last_sign_in_at only
--     moves on a password sign-in, so 75 of Alliance's 90 teachers read days or
--     months stale. "Never" stays last_sign_in_at IS NULL.
--   * level is the owner's work-based rule (R10). Work = the last 30 school
--     days (today and the 29 before it), one point each for:
--       - a paper the teacher created that was HELD in the window and has
--         counted (published, non-blank) results in dash5_counted_results;
--       - a homework the teacher published (not a draft) in the window;
--       - a lesson the teacher logged: a distinct (class, subject, day) in
--         syllabus_progress_events.recorded_by (never tt_lesson_plans.status);
--       - a day on which the teacher marked an attendance register
--         (distinct attendance_records.date with marked_by = the teacher).
--     Minimal  = no work in the window, OR not seen for 7+ days (or never).
--     Strong   = seen in the last 3 days AND in the top third of the SCHOOL's
--                teachers by work (fewer than a third have more work; ties
--                share a place). Ranked school-wide even under a wing filter.
--     Moderate = everyone else. The old rule forced Minimal below 2 papers
--     and needed 45 homework all time for Strong.
--   * 'engagement' now carries the 30-day work score (only the sort used it).
--     New keys: 'work_30d' (the four counts and the total), 'strong_min_work',
--     'window_days', 'wing_ids', 'wing_first_name', 'results', and
--     'class_results' (per-class sums of this year's counted results, which
--     dash5_coordinators reads instead of a second dash5_counted_results pass).
--   * Wings by MEMBERSHIP (R17): wing_ids = every active wing the teacher has a
--     class in, wing_name lists all of them, and the wing filter keeps a teacher
--     who teaches in that wing at all. wing_id stays one id (the first wing by
--     display order) because the Assign button and dash5_report_core read it.
--     It was the lowest uuid, so a wing filter showed 13 of Junior's 25.
--   * avg_score reads dash5_counted_results within the academic year and maps
--     each result onto the teacher's (class, subject) pairs by exact subject id
--     first, else by subject_key (R2): universal_subjects has one row per grade,
--     so 22 of Urvashi Sharma's Science papers were dropped. Unpublished marks
--     and blank papers are no longer averaged.
--   * tests = papers the teacher created this academic year, drafts left out,
--     dated by the day held (the dash5_counted_results date rule).
--     homework_given = homework published this academic year, drafts left out.
--     lessons = lessons logged this year (evidence), not "done" claims.
--
-- dash5_coordinators
--   * Tasks closed / Overdue (R14) read task_assignments to the wing's
--     coordinators. tasks.wing_id is NULL on every row and nothing writes it, so
--     both columns were always empty. Cancelled tasks are left out; overdue is
--     a due date before today in school time.
--   * "N minimal use" and the teacher count are by membership (R17), from the
--     same rows as the teacher card, so the two numbers share one population.
--   * Wing average, coverage, attendance, lessons and band now follow
--     dash5_tree's wing row exactly, so this card and the performance tree on
--     the same page agree: the average is every counted result of the wing's
--     classes this year (R2, R4, blank papers out), coverage leaves out
--     classes with no students, the rest come from dash5_atom_rows (R1, R5).
--   * band = dash5_band_or_null(dash5_composite(score, coverage, attendance,
--     lessons, dash5_year_pace)) (R6): a missing input is skipped, coverage is
--     judged against the share of the year gone, and a wing with no students
--     or nothing measured is "Not assessed" (it read "Attention").
--   * New keys: 'lessons_pct', 'standing_score'.
--
-- Signatures, return types and every key the current UI reads are unchanged.

CREATE OR REPLACE FUNCTION public.dash5_teacher_activity(p_wing_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_from30 date; v_t0 timestamptz; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;
  -- The work window: today and the 29 school-local days before it, the range
  -- teacher_work_totals uses for its 30-day export.
  v_from30 := v_today - 29;
  v_t0     := v_from30::timestamp AT TIME ZONE v_tz;

  WITH staff AS MATERIALIZED (
    SELECT DISTINCT pf.id, COALESCE(pf.full_name, pf.email) nm
      FROM profiles pf
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role = 'teacher'::app_role
     WHERE pf.institution_id = v_inst AND pf.is_active IS NOT FALSE
  ),
  -- The pairs a teacher holds. A row with no subject is the pastoral
  -- class-teacher assignment: it counts as a class, never as a subject
  -- (CLAUDE.md 25). role is compared as the enum so the planner keeps its
  -- statistics.
  pairs AS MATERIALIZED (
    SELECT ca.user_id, ca.class_id, ca.subject_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
     WHERE ca.role = 'teacher'::app_role
       AND ca.user_id IN (SELECT s.id FROM staff s)
  ),
  scope AS (
    SELECT p.user_id,
           count(DISTINCT p.class_id)::int classes,
           count(DISTINCT p.subject_id) FILTER (WHERE p.subject_id IS NOT NULL)::int subjects,
           string_agg(DISTINCT us.name, ', ') subject_names
      FROM pairs p
      LEFT JOIN universal_subjects us ON us.id = p.subject_id
     GROUP BY p.user_id
  ),
  -- Every active wing a teacher has a class in (R17).
  wmem AS (
    SELECT DISTINCT p.user_id, w.id wing_id, w.name, w.display_order
      FROM pairs p
      JOIN wing_class_mappings m ON m.class_id = p.class_id
      JOIN wings w ON w.id = m.wing_id AND w.institution_id = v_inst AND w.is_active IS NOT FALSE
  ),
  wagg AS (
    SELECT x.user_id,
           array_agg(x.wing_id ORDER BY x.display_order NULLS LAST, x.name, x.wing_id) wing_ids,
           string_agg(x.name, ', ' ORDER BY x.display_order NULLS LAST, x.name, x.wing_id) wing_names,
           (array_agg(x.name ORDER BY x.display_order NULLS LAST, x.name, x.wing_id))[1] wing_first_name
      FROM wmem x
     GROUP BY x.user_id
  ),
  -- A teacher's (class, subject) pairs with the subject's normalised name.
  tp AS MATERIALIZED (
    SELECT DISTINCT p.user_id, p.class_id, p.subject_id, initcap(lower(btrim(us.name))) skey
      FROM pairs p
      JOIN universal_subjects us ON us.id = p.subject_id
  ),
  -- Subjects a class already has under their exact id: a result on one of
  -- these belongs to that subject only, never to a same-name sibling.
  known AS MATERIALIZED (
    SELECT scm.class_id, scm.subject_id
      FROM subject_class_mappings scm
     WHERE scm.institution_id = v_inst
    UNION
    SELECT t.class_id, t.subject_id FROM tp t
  ),
  -- Counted results (published, not absent, not blank). The lower bound also
  -- reaches back into the work window so a paper held in the last 30 days
  -- still counts as work in the first month of a new year.
  res AS MATERIALIZED (
    SELECT r.exam_id, r.class_id, r.exam_subject_id, r.subject_key, r.percentage, r.exam_date
      FROM public.dash5_counted_results(v_inst) r
     WHERE r.exam_date BETWEEN LEAST(v_ay_start, v_from30) AND GREATEST(v_ay_end, v_today)
  ),
  -- This year's results folded to one row per (class, paper subject): a few
  -- hundred rows, so the id-or-name subject match runs on the small set and
  -- never joins the results themselves (a join of the ~22k results to the
  -- pairs was planned as a nested loop over 13M rows, 8 s on Alliance).
  -- exact_known: the class has a subject under the paper's exact subject id.
  rg AS MATERIALIZED (
    SELECT g.class_id, g.exam_subject_id, g.subject_key, g.n, g.s,
           EXISTS (SELECT 1 FROM known k
                    WHERE k.class_id = g.class_id AND k.subject_id = g.exam_subject_id) exact_known
      FROM (SELECT r.class_id, r.exam_subject_id, r.subject_key,
                   count(*)::numeric n, sum(r.percentage) s
              FROM res r
             WHERE r.exam_date BETWEEN v_ay_start AND v_ay_end
             GROUP BY 1, 2, 3) g
  ),
  -- Which teacher a (class, paper subject) belongs to: the pair with the same
  -- subject id when the class has that exact subject, else the pairs with the
  -- same subject_key (R2). DISTINCT so a teacher holding two same-name rows
  -- in one class counts the results once.
  rmap AS (
    SELECT t.user_id, g.class_id, g.exam_subject_id, g.subject_key, g.n, g.s
      FROM rg g
      JOIN tp t ON t.class_id = g.class_id AND t.subject_id = g.exam_subject_id
     WHERE g.exact_known
    UNION
    SELECT t.user_id, g.class_id, g.exam_subject_id, g.subject_key, g.n, g.s
      FROM rg g
      JOIN tp t ON t.class_id = g.class_id AND t.skey = g.subject_key
     WHERE NOT g.exact_known
  ),
  acc AS (
    SELECT m.user_id, round(sum(m.s) / sum(m.n), 1) avg_score, sum(m.n)::int n
      FROM rmap m GROUP BY m.user_id
  ),
  -- Papers set this academic year: drafts left out, dated by the day the
  -- paper was held (the dash5_counted_results date rule).
  made AS (
    SELECT e.created_by uid, count(*)::int n
      FROM exams e
     WHERE e.institution_id = v_inst
       AND e.status::text <> 'draft'
       AND e.created_by IN (SELECT s.id FROM staff s)
       AND (COALESCE(
              CASE WHEN e.scheduled_date BETWEEN e.created_at - INTERVAL '400 days'
                                             AND e.created_at + INTERVAL '400 days'
                   THEN e.scheduled_date END,
              e.start_time, e.published_at, e.created_at)
            AT TIME ZONE v_tz)::date BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  ),
  -- Work: papers the teacher created that were held in the window and have
  -- counted results.
  held30 AS (
    SELECT e.created_by uid, count(*)::int n
      FROM (SELECT DISTINCT r.exam_id FROM res r
             WHERE r.exam_date BETWEEN v_from30 AND v_today) x
      JOIN exams e ON e.id = x.exam_id
     WHERE e.created_by IN (SELECT s.id FROM staff s)
     GROUP BY 1
  ),
  hw AS (
    SELECT h.created_by uid,
           count(*) FILTER (WHERE (COALESCE(h.published_at, h.created_at) AT TIME ZONE v_tz)::date
                                  BETWEEN v_ay_start AND v_ay_end)::int n_ay,
           count(*) FILTER (WHERE COALESCE(h.published_at, h.created_at) >= v_t0)::int n_30
      FROM homework_assignments h
     WHERE h.institution_id = v_inst
       AND h.status IS DISTINCT FROM 'draft'
       AND h.created_by IN (SELECT s.id FROM staff s)
     GROUP BY 1
  ),
  -- Lessons logged: a distinct (class, subject, day) in the syllabus log.
  les AS (
    SELECT e.recorded_by uid,
           count(DISTINCT (e.class_id, e.subject_id, e.date))
             FILTER (WHERE e.date BETWEEN v_ay_start AND v_ay_end)::int n_ay,
           count(DISTINCT (e.class_id, e.subject_id, e.date))
             FILTER (WHERE e.date BETWEEN v_from30 AND v_today)::int n_30
      FROM syllabus_progress_events e
     WHERE e.institution_id = v_inst
       AND e.recorded_by IN (SELECT s.id FROM staff s)
     GROUP BY 1
  ),
  -- Registers: distinct days the teacher marked any attendance register.
  reg AS (
    SELECT ar.marked_by uid, count(DISTINCT ar.date)::int n_30
      FROM attendance_records ar
     WHERE ar.institution_id = v_inst
       AND ar.date BETWEEN v_from30 AND v_today
       AND ar.marked_by IN (SELECT s.id FROM staff s)
     GROUP BY 1
  ),
  -- Real last seen (R3). NULL when the account never signed in.
  seen AS (
    SELECT s.id uid,
           CASE WHEN u.last_sign_in_at IS NULL THEN NULL
                ELSE GREATEST(0, v_today - (GREATEST(
                       u.last_sign_in_at,
                       (SELECT max(GREATEST(x.refreshed_at AT TIME ZONE 'UTC', x.updated_at))
                          FROM auth.sessions x WHERE x.user_id = s.id))
                     AT TIME ZONE v_tz)::date)
           END days
      FROM staff s
      JOIN auth.users u ON u.id = s.id
  ),
  j AS (
    SELECT s.id, s.nm, wa.wing_ids, wa.wing_names, wa.wing_first_name,
           COALESCE(sc.classes, 0) classes, COALESCE(sc.subjects, 0) subjects, sc.subject_names,
           COALESCE(m.n, 0) tests, COALESCE(h.n_ay, 0) hw_given, COALESCE(l.n_ay, 0) lessons,
           a.avg_score, COALESCE(a.n, 0) results,
           se.days last_seen_days,
           COALESCE(h3.n, 0) w_papers, COALESCE(h.n_30, 0) w_hw,
           COALESCE(l.n_30, 0) w_lessons, COALESCE(rg.n_30, 0) w_registers
      FROM staff s
      LEFT JOIN scope  sc ON sc.user_id = s.id
      LEFT JOIN wagg   wa ON wa.user_id = s.id
      LEFT JOIN acc    a  ON a.user_id = s.id
      LEFT JOIN made   m  ON m.uid = s.id
      LEFT JOIN held30 h3 ON h3.uid = s.id
      LEFT JOIN hw     h  ON h.uid = s.id
      LEFT JOIN les    l  ON l.uid = s.id
      LEFT JOIN reg    rg ON rg.uid = s.id
      LEFT JOIN seen   se ON se.uid = s.id
  ),
  -- Ranked over the whole school BEFORE any wing filter: "top third of the
  -- school". rank() lets tied teachers share a place.
  ranked AS (
    SELECT j.*,
           (j.w_papers + j.w_hw + j.w_lessons + j.w_registers) work,
           rank() OVER (ORDER BY (j.w_papers + j.w_hw + j.w_lessons + j.w_registers) DESC) work_rank,
           count(*) OVER () n_staff
      FROM j
  ),
  scored AS (
    SELECT r.*,
           CASE
             WHEN r.work = 0 OR r.last_seen_days IS NULL OR r.last_seen_days >= 7 THEN 'Minimal'
             WHEN r.last_seen_days <= 3 AND (r.work_rank - 1) < r.n_staff / 3.0 THEN 'Strong'
             ELSE 'Moderate'
           END level
      FROM ranked r
  ),
  shown AS (
    SELECT sc.* FROM scored sc
     WHERE p_wing_id IS NULL OR p_wing_id = ANY (sc.wing_ids)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM shown),
    'minimal', (SELECT count(*)::int FROM shown WHERE level = 'Minimal'),
    'window_days', 30,
    -- Per-class sums of this year's counted results (every subject), read by
    -- dash5_coordinators for the wing average so it does not run
    -- dash5_counted_results a second time.
    'class_results', COALESCE((SELECT jsonb_agg(jsonb_build_object('class_id', c.class_id, 'n', c.n, 's', c.s))
                                 FROM (SELECT g.class_id, sum(g.n) n, sum(g.s) s FROM rg g GROUP BY g.class_id) c),
                              '[]'::jsonb),
    -- The fewest work points that still reach the school's top third today.
    'strong_min_work', (SELECT min(r.work) FROM ranked r
                         WHERE r.work > 0 AND (r.work_rank - 1) < r.n_staff / 3.0),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.nm,
        'wing_id', r.wing_ids[1],
        'wing_ids', COALESCE(to_jsonb(r.wing_ids), '[]'::jsonb),
        'wing_name', r.wing_names,
        'wing_first_name', r.wing_first_name,
        'classes', r.classes, 'subjects', r.subjects, 'subject_names', r.subject_names,
        'last_seen_days', r.last_seen_days,
        'tests', r.tests, 'homework_given', r.hw_given, 'lessons', r.lessons,
        'avg_score', r.avg_score, 'results', r.results,
        'engagement', r.work,
        'work_30d', jsonb_build_object(
           'papers', r.w_papers, 'homework', r.w_hw,
           'lessons', r.w_lessons, 'registers', r.w_registers, 'total', r.work),
        'level', r.level
      ) ORDER BY CASE r.level WHEN 'Minimal' THEN 0 WHEN 'Moderate' THEN 1 ELSE 2 END,
                 r.work, r.last_seen_days DESC NULLS FIRST, r.nm) FROM shown r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.dash5_coordinators(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_pace numeric; v_out jsonb; v_act jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_pace := public.dash5_year_pace(v_inst);

  -- plan_cache_mode force_custom_plan (in the header) reaches the
  -- dash5_atom_rows() call below: from a session's 6th call its generic
  -- plan sizes every school as the average one.

  -- The teacher rows come from dash5_teacher_activity rather than recomputing
  -- the engagement rule here: two copies of that rule would drift, and the
  -- two cards sit on the same screen.
  v_act := public.dash5_teacher_activity(NULL, v_inst);

  -- Wing score, coverage, attendance, lessons and band follow dash5_tree's
  -- wing row exactly, so this card and the performance tree on the same page
  -- never disagree about a wing.
  WITH atoms AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  pc AS (SELECT DISTINCT a.class_id, a.wing_id, a.students, a.att_present, a.att_total FROM atoms a),
  wagg AS (
    SELECT a.wing_id,
           -- A class with no students cannot be behind on its syllabus.
           sum(a.chapters)         FILTER (WHERE a.students > 0)::int chapters,
           sum(a.chapters_done)    FILTER (WHERE a.students > 0)::int done,
           sum(a.chapters_partial) FILTER (WHERE a.students > 0)::int part,
           sum(a.lessons_planned)::int lp, sum(a.lessons_taught)::int lt
      FROM atoms a GROUP BY a.wing_id
  ),
  wc AS (
    SELECT pc.wing_id, count(*)::int classes, sum(pc.students)::int students,
           sum(pc.att_present)::int ap, sum(pc.att_total)::int at2
      FROM pc GROUP BY pc.wing_id
  ),
  -- Every counted result (published, present, not a blank paper) of each
  -- class this academic year, whatever subject it was filed under: the sums
  -- dash5_teacher_activity already built from dash5_counted_results.
  cagg AS (
    SELECT (x->>'class_id')::uuid class_id, (x->>'n')::numeric n, (x->>'s')::numeric s
      FROM jsonb_array_elements(COALESCE(v_act->'class_results', '[]'::jsonb)) x
  ),
  wacc AS (
    SELECT p.wing_id, sum(c.n) n, sum(c.s) s
      FROM (SELECT DISTINCT pc.class_id, pc.wing_id FROM pc) p
      JOIN cagg c ON c.class_id = p.class_id
     GROUP BY 1
  ),
  coord AS (
    SELECT wa.wing_id, wa.user_id uid, COALESCE(pf.full_name, pf.email) nm
      FROM wing_assignments wa
      JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
     WHERE EXISTS (SELECT 1 FROM user_roles ur
                    WHERE ur.user_id = pf.id AND ur.role::text = 'coordinator')
  ),
  -- Each teacher once per wing they teach in (R17), with the card's level.
  mem AS (
    SELECT wid::uuid wing_id, r->>'id' tid, r->>'level' lvl
      FROM jsonb_array_elements(COALESCE(v_act->'rows', '[]'::jsonb)) r
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r->'wing_ids', '[]'::jsonb)) wid
  ),
  quiet AS (
    SELECT m.wing_id,
           count(DISTINCT m.tid)::int teachers,
           count(DISTINCT m.tid) FILTER (WHERE m.lvl = 'Minimal')::int minimal
      FROM mem m GROUP BY m.wing_id
  ),
  -- Tasks assigned TO the wing's coordinator(s) (R14). Cancelled tasks are
  -- left out; overdue = due before today in school time and not finished.
  tsk AS (
    SELECT c.wing_id,
           count(DISTINCT t.id)::int total,
           count(DISTINCT t.id) FILTER (WHERE t.status::text = 'completed')::int closed,
           count(DISTINCT t.id) FILTER (WHERE t.due_date IS NOT NULL
                                  AND (t.due_date AT TIME ZONE v_tz)::date < v_today
                                  AND t.status::text NOT IN ('completed','rejected'))::int overdue
      FROM coord c
      JOIN task_assignments ta ON ta.assignee_id = c.uid
      JOIN tasks t ON t.id = ta.task_id AND t.institution_id = v_inst AND t.cancelled_at IS NULL
     GROUP BY c.wing_id
  ),
  wrow AS (
    SELECT w.id, w.name,
           COALESCE(k.classes, 0) classes, COALESCE(k.students, 0) students,
           -- Rounded before the composite, as dash5_tree does, so the two
           -- badges agree to the decimal.
           CASE WHEN x.n > 0 THEN round(x.s / x.n, 1) END acc,
           CASE WHEN g.chapters > 0 THEN round((g.done*2 + g.part)*100.0/(g.chapters*2), 1) END cov,
           CASE WHEN k.at2 > 0 THEN round(k.ap*100.0/k.at2, 1) END att,
           CASE WHEN g.lp > 0 THEN g.lt*100.0/g.lp END les,
           COALESCE(qt.teachers, 0) teachers, COALESCE(qt.minimal, 0) minimal,
           COALESCE(t.closed, 0) closed, COALESCE(t.total, 0) total, COALESCE(t.overdue, 0) overdue
      FROM wings w
      LEFT JOIN wagg  g  ON g.wing_id = w.id
      LEFT JOIN wc    k  ON k.wing_id = w.id
      LEFT JOIN wacc  x  ON x.wing_id = w.id
      LEFT JOIN quiet qt ON qt.wing_id = w.id
      LEFT JOIN tsk   t  ON t.wing_id = w.id
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'wing_id', r.id, 'wing_name', r.name,
      'coordinator', (SELECT string_agg(c.nm, ', ' ORDER BY c.nm) FROM coord c WHERE c.wing_id = r.id),
      'coordinator_id', (SELECT c.uid FROM coord c WHERE c.wing_id = r.id ORDER BY c.nm LIMIT 1),
      'classes', r.classes,
      'students', r.students,
      'teachers', r.teachers,
      'teachers_minimal', r.minimal,
      'avg_score', round(r.acc, 1),
      'coverage_pct', round(r.cov, 1),
      'attendance_pct', round(r.att, 1),
      'lessons_pct', round(r.les, 1),
      'tasks_closed', r.closed, 'tasks_total', r.total,
      'tasks_overdue', r.overdue,
      -- A wing with no students is "Not assessed", as in dash5_tree.
      'standing_score', CASE WHEN r.students > 0
         THEN round(public.dash5_composite(r.acc, r.cov, r.att, r.les, v_pace), 1) END,
      'band', CASE WHEN r.students > 0
         THEN public.dash5_band_or_null(public.dash5_composite(r.acc, r.cov, r.att, r.les, v_pace)) END
    ) ORDER BY r.name), '[]'::jsonb)
  ) INTO v_out
  FROM wrow r;

  RETURN v_out;
END
$function$;
