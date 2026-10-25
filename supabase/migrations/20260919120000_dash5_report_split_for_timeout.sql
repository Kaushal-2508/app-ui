-- The School Performance Report, split into three so it fits the timeout.
--
-- THE BUG. dash5_report_snapshot() took 10.9s on Alliance and the report card
-- showed "Couldn't load the figures" for every real user, while it worked
-- perfectly through the Management API. The difference is the role: postgres
-- has no statement_timeout, `authenticated` is pinned to 8s
-- (pg_roles.rolconfig), so PostgREST cancelled the query every time. Verified
-- by timing each call it makes, as the caller, with the timeout lifted:
--
--     1704 ms  chronic_absentees      x2  = 3408
--     1512 ms  student_tree
--     1431 ms  students_at_risk
--     1430 ms  band_donut
--     1395 ms  never_signed_in
--      277 ms  atom_rows
--      270 ms  teacher_activity
--      255 ms  exam_pipeline          x5  = 1275
--    -------
--    10879 ms  the whole snapshot
--
-- No single call is slow. The total is, and nothing inside one plpgsql
-- function can run concurrently, so the fix is to stop asking it to. The work
-- splits along three seams that share no intermediate state, and the client
-- fires all three at once:
--
--     dash5_report_core        ~2.2s   the atom, wings, classes, subjects,
--                                      teachers, and the exam pipeline
--     dash5_report_students    ~4.4s   roll-up, score bands, at-risk list
--     dash5_report_attendance  ~4.8s   absentees, streaks, never-signed-in
--
-- Wall clock is now the slowest of the three, about 4.8s, with every one of
-- them comfortably inside the 8s ceiling. Raising the ceiling with a
-- per-function SET statement_timeout was the other option and is the wrong
-- one: it would leave a principal watching a spinner for eleven seconds while
-- holding a pooled connection, which CLAUDE.md 23 warns about directly.
--
-- Arithmetic is unchanged: still one dash5_atom_rows scan in core, still
-- dash5_tree's weighting, still the sibling functions owning every other
-- definition so the report cannot disagree with the dashboard.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

DROP FUNCTION IF EXISTS public.dash5_report_snapshot(uuid);

/* ========================================================== core ======= */

CREATE OR REPLACE FUNCTION public.dash5_report_core(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_name text; v_out jsonb;
  v_ay_start date; v_ay_end date; v_year text;
  v_pipe jsonb; v_teach jsonb; v_att_days int;
  c_att_days constant int := 100;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  SELECT name, COALESCE(timezone, 'Asia/Kolkata') INTO v_name, v_tz
    FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_year := CASE
    WHEN v_ay_start IS NULL THEN 'Academic year'
    ELSE 'Academic Year ' || to_char(v_ay_start, 'YYYY') || ' to '
         || to_char(COALESCE(v_ay_end, v_ay_start + INTERVAL '1 year'), 'YYYY')
  END;

  -- School days the register was actually taken on, which is what the
  -- attendance footnote claims to be counting.
  SELECT count(DISTINCT ar.date)::int INTO v_att_days
    FROM attendance_records ar
   WHERE ar.institution_id = v_inst AND ar.date > v_today - c_att_days;

  v_pipe  := public.dash5_exam_pipeline(NULL, NULL, NULL, v_inst);
  v_teach := public.dash5_teacher_activity(NULL, v_inst);

  WITH
  a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  -- Roster size and attendance are CLASS facts (dash5_tree says the same);
  -- summing them per atom would multiply them by the subject count.
  pc AS (SELECT DISTINCT x.class_id, x.wing_id, x.students, x.att_present, x.att_total FROM a x),
  -- Class teacher: a class_assignments row with NO subject, as every other
  -- dash5 function resolves it.
  ct AS (
    SELECT ca.class_id, string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ') nm
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.subject_id IS NULL AND ca.role::text = 'teacher'
       AND pf.is_active IS NOT FALSE
     GROUP BY 1
  ),
  wagg AS (
    SELECT x.wing_id,
           count(*)::int subject_pairs, count(DISTINCT x.subject_key)::int subject_count,
           sum(x.chapters)::int chapters, sum(x.chapters_done)::int chapters_done,
           sum(x.chapters_partial)::int chapters_partial,
           sum(x.lessons_planned)::int lessons_planned, sum(x.lessons_taught)::int lessons_taught,
           sum(x.papers)::int papers, sum(x.wk_done)::int wk_done, sum(x.wk_planned)::int wk_planned,
           sum(x.attempts)::int attempts,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den,
           sum(x.hw_slots)::int hw_slots, sum(x.hw_submitted)::int hw_submitted
      FROM a x GROUP BY x.wing_id
  ),
  wros AS (
    SELECT p.wing_id, count(*)::int class_count, sum(p.students)::int students,
           sum(p.att_present)::int att_present, sum(p.att_total)::int att_total
      FROM pc p GROUP BY p.wing_id
  ),
  cagg AS (
    SELECT x.class_id,
           sum(x.chapters)::int chapters, sum(x.chapters_done)::int chapters_done,
           sum(x.chapters_partial)::int chapters_partial,
           sum(x.papers)::int papers,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den
      FROM a x GROUP BY x.class_id
  ),
  -- One row per distinct subject, the same weighting the tree uses elsewhere.
  sagg AS (
    SELECT x.subject_key, max(s.name) nm,
           count(DISTINCT x.class_id)::int classes,
           sum(x.papers)::int papers, sum(x.attempts)::int attempts,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den,
           sum(x.chapters)::int chapters, sum(x.chapters_done)::int chapters_done,
           sum(x.chapters_partial)::int chapters_partial
      FROM a x LEFT JOIN subjects s ON s.id = x.subject_id
     GROUP BY x.subject_key
  ),
  sch AS (
    SELECT (SELECT COALESCE(sum(p.students), 0)::int FROM pc p) students,
           (SELECT count(*)::int FROM pc p) class_count,
           (SELECT COALESCE(sum(p.att_present), 0)::int FROM pc p) att_present,
           (SELECT COALESCE(sum(p.att_total), 0)::int FROM pc p) att_total,
           count(*)::int subject_pairs, count(DISTINCT x.subject_key)::int subject_count,
           COALESCE(sum(x.chapters), 0)::int chapters,
           COALESCE(sum(x.chapters_done), 0)::int chapters_done,
           COALESCE(sum(x.chapters_partial), 0)::int chapters_partial,
           COALESCE(sum(x.lessons_planned), 0)::int lessons_planned,
           COALESCE(sum(x.lessons_taught), 0)::int lessons_taught,
           COALESCE(sum(x.papers), 0)::int papers,
           COALESCE(sum(x.wk_done), 0)::int wk_done,
           COALESCE(sum(x.wk_planned), 0)::int wk_planned,
           COALESCE(sum(x.attempts), 0)::int attempts,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den,
           COALESCE(sum(x.hw_slots), 0)::int hw_slots,
           COALESCE(sum(x.hw_submitted), 0)::int hw_submitted,
           count(*) FILTER (WHERE x.papers = 0)::int pairs_no_paper
      FROM a x
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'school', v_name, 'year', v_year,
      'asOf', to_char(v_today, 'DD Mon YYYY'),
      'yearGone', (v_pipe ->> 'year_elapsed_pct')::numeric,
      'attDays', COALESCE(v_att_days, 0)),

    'school', (
      SELECT jsonb_build_object(
        'students', s.students, 'classCount', s.class_count,
        'subjectPairs', s.subject_pairs, 'subjectCount', s.subject_count,
        'pairsNoPaper', s.pairs_no_paper,
        'attendance', CASE WHEN s.att_total > 0 THEN round(s.att_present * 100.0 / s.att_total, 1) END,
        'syllabus', CASE WHEN s.chapters > 0
          THEN round((s.chapters_done * 2 + s.chapters_partial) * 100.0 / (s.chapters * 2), 1) END,
        'lessonsTaught', s.lessons_taught, 'lessonsPlanned', s.lessons_planned,
        'lessonPct', CASE WHEN s.lessons_planned > 0
          THEN round(s.lessons_taught * 100.0 / s.lessons_planned, 1) END,
        'papers', s.papers,
        'papersPlanned',   COALESCE((v_pipe ->> 'planned')::int, 0),
        'papersPublished', COALESCE((v_pipe ->> 'held_results_out')::int, 0),
        'pendingGrading',  COALESCE((v_pipe ->> 'held_results_pending')::int, 0),
        'papersScheduled', COALESCE((v_pipe ->> 'on_calendar')::int, 0),
        'papersDraft',     COALESCE((v_pipe ->> 'in_draft')::int, 0),
        'wkDone', s.wk_done, 'wkPlanned', s.wk_planned,
        'accuracy', CASE WHEN s.acc_den > 0 THEN round(s.acc_num / s.acc_den, 1) END,
        'attempts', s.attempts,
        'homework', CASE WHEN s.hw_slots > 0 THEN round(s.hw_submitted * 100.0 / s.hw_slots, 1) END,
        'chapters', s.chapters, 'chaptersDone', s.chapters_done,
        'chaptersPartial', s.chapters_partial,
        'band', public.dash5_band(CASE WHEN s.acc_den > 0 THEN round(s.acc_num / s.acc_den, 1) END)
      ) FROM sch s),

    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wg.id, 'name', wg.name,
        -- The sub-line under a wing name: the school's own description when
        -- it set one, otherwise the range of classes mapped to the wing.
        'span', COALESCE(NULLIF(btrim(wg.description), ''), (
          SELECT CASE WHEN min(c2.name) = max(c2.name) THEN min(c2.name)
                      ELSE min(c2.name) || ' to ' || max(c2.name) END
            FROM wing_class_mappings m2
            JOIN classes c2 ON c2.id = m2.class_id
           WHERE m2.wing_id = wg.id), ''),
        'head', COALESCE((
          SELECT string_agg(COALESCE(pf.full_name, pf.email), ', ')
            FROM wing_assignments wa
            JOIN profiles pf ON pf.id = wa.user_id
            JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
           WHERE wa.wing_id = wg.id AND pf.is_active IS NOT FALSE), 'No coordinator assigned'),
        'students', COALESCE(k.students, 0), 'classCount', COALESCE(k.class_count, 0),
        'subjectPairs', COALESCE(g.subject_pairs, 0), 'subjectCount', COALESCE(g.subject_count, 0),
        'attendance', CASE WHEN k.att_total > 0 THEN round(k.att_present * 100.0 / k.att_total, 1) END,
        'syllabus', CASE WHEN g.chapters > 0
          THEN round((g.chapters_done * 2 + g.chapters_partial) * 100.0 / (g.chapters * 2), 1) END,
        'lessonsTaught', COALESCE(g.lessons_taught, 0),
        'lessonsPlanned', COALESCE(g.lessons_planned, 0),
        'lessonPct', CASE WHEN g.lessons_planned > 0
          THEN round(g.lessons_taught * 100.0 / g.lessons_planned, 1) END,
        'papers', COALESCE(g.papers, 0),
        'papersPlanned',   COALESCE((wp.p ->> 'planned')::int, 0),
        'papersPublished', COALESCE((wp.p ->> 'held_results_out')::int, 0),
        'pendingGrading',  COALESCE((wp.p ->> 'held_results_pending')::int, 0),
        'papersScheduled', COALESCE((wp.p ->> 'on_calendar')::int, 0),
        'papersDraft',     COALESCE((wp.p ->> 'in_draft')::int, 0),
        'wkDone', COALESCE(g.wk_done, 0), 'wkPlanned', COALESCE(g.wk_planned, 0),
        'accuracy', CASE WHEN g.acc_den > 0 THEN round(g.acc_num / g.acc_den, 1) END,
        'attempts', COALESCE(g.attempts, 0),
        'homework', CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted * 100.0 / g.hw_slots, 1) END,
        'chapters', COALESCE(g.chapters, 0), 'chaptersDone', COALESCE(g.chapters_done, 0),
        'chaptersPartial', COALESCE(g.chapters_partial, 0),
        'band', public.dash5_band(CASE WHEN g.acc_den > 0 THEN round(g.acc_num / g.acc_den, 1) END),
        'classes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', c.id,
            'code', c.name || COALESCE(' ' || NULLIF(c.section, ''), ''),
            'teacherName', COALESCE(ct.nm, 'No class teacher'),
            'students', COALESCE(p.students, 0),
            'attendance', CASE WHEN p.att_total > 0
              THEN round(p.att_present * 100.0 / p.att_total, 1) END,
            'syllabus', CASE WHEN cg.chapters > 0
              THEN round((cg.chapters_done * 2 + cg.chapters_partial) * 100.0 / (cg.chapters * 2), 1) END,
            'chapters', COALESCE(cg.chapters, 0), 'chaptersDone', COALESCE(cg.chapters_done, 0),
            'chaptersPartial', COALESCE(cg.chapters_partial, 0),
            'papers', COALESCE(cg.papers, 0),
            'accuracy', CASE WHEN cg.acc_den > 0 THEN round(cg.acc_num / cg.acc_den, 1) END,
            'band', public.dash5_band(CASE WHEN cg.acc_den > 0 THEN round(cg.acc_num / cg.acc_den, 1) END))
            ORDER BY c.name, c.section)
            FROM pc p
            JOIN classes c ON c.id = p.class_id
            LEFT JOIN cagg cg ON cg.class_id = p.class_id
            LEFT JOIN ct ON ct.class_id = p.class_id
           WHERE p.wing_id = wg.id), '[]'::jsonb))
        ORDER BY wg.display_order NULLS LAST, wg.name)
        FROM wings wg
        LEFT JOIN wagg g ON g.wing_id = wg.id
        LEFT JOIN wros k ON k.wing_id = wg.id
        LEFT JOIN LATERAL (SELECT public.dash5_exam_pipeline(wg.id, NULL, NULL, v_inst) p) wp ON true
       WHERE wg.institution_id = v_inst AND wg.is_active IS NOT FALSE), '[]'::jsonb),

    'subjRollup', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', COALESCE(g.nm, initcap(g.subject_key)),
        'attempts', g.attempts, 'papers', g.papers, 'classes', g.classes,
        'acc', CASE WHEN g.acc_den > 0 THEN round(g.acc_num / g.acc_den, 1) END,
        'cov', CASE WHEN g.chapters > 0
          THEN round((g.chapters_done * 2 + g.chapters_partial) * 100.0 / (g.chapters * 2), 1) END)
        ORDER BY COALESCE(g.nm, g.subject_key))
        FROM sagg g), '[]'::jsonb),

    'teachers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', e ->> 'name', 'wingId', e ->> 'wing_id',
        'classes', COALESCE((e ->> 'classes')::int, 0),
        'subjects', COALESCE(e ->> 'subject_names', ''),
        'tests', COALESCE((e ->> 'tests')::int, 0),
        'hwGiven', COALESCE((e ->> 'homework_given')::int, 0),
        'lessons', COALESCE((e ->> 'lessons')::int, 0),
        'avgScore', (e ->> 'avg_score')::numeric,
        'lastSeen', (e ->> 'last_seen_days')::int,
        'level', e ->> 'level'))
        FROM jsonb_array_elements(COALESCE(v_teach -> 'rows', '[]'::jsonb)) e), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ====================================================== students ======= */

CREATE OR REPLACE FUNCTION public.dash5_report_students(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_stu jsonb; v_bands jsonb; v_risk jsonb;
  -- The report prints ten at-risk students; fetching more would be shipping
  -- rows nothing renders.
  c_risk_rows constant int := 10;
BEGIN
  v_inst  := public.dash_resolve_institution(p_institution_id);
  v_stu   := public.dash5_student_tree('wings', NULL, NULL, v_inst);
  v_bands := public.dash5_band_donut(NULL, v_inst);
  v_risk  := public.dash5_students_at_risk(NULL, NULL, c_risk_rows, 0, v_inst);

  RETURN jsonb_build_object(
    'schoolStu', COALESCE(v_stu -> 'total', '{}'::jsonb),
    'wingStu', COALESCE((
      SELECT jsonb_object_agg(e ->> 'id', e)
        FROM jsonb_array_elements(COALESCE(v_stu -> 'rows', '[]'::jsonb)) e
       WHERE e ->> 'id' IS NOT NULL), '{}'::jsonb),

    'bands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'band', e ->> 'band', 'n', (e ->> 'n')::int, 'pct', (e ->> 'pct')::numeric))
        FROM jsonb_array_elements(COALESCE(v_bands -> 'bands', '[]'::jsonb)) e), '[]'::jsonb),

    'atRisk', jsonb_build_object(
      'total', COALESCE((v_risk ->> 'total')::int, 0),
      'byWing', COALESCE((
        SELECT jsonb_object_agg(e ->> 'wing_id', (e ->> 'n')::int)
          FROM jsonb_array_elements(COALESCE(v_risk -> 'by_wing', '[]'::jsonb)) e
         WHERE e ->> 'wing_id' IS NOT NULL), '{}'::jsonb),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', e ->> 'name', 'cls', e ->> 'class_label', 'wingId', e ->> 'wing_id',
          'roll', e ->> 'roll',
          'classTeacher', COALESCE(e ->> 'class_teacher', 'No class teacher'),
          'score', (e ->> 'score')::numeric,
          'attendance', (e ->> 'attendance_pct')::numeric,
          'homework', (e ->> 'homework_pct')::numeric,
          'submission', (e ->> 'submission_pct')::numeric,
          'neverIn', COALESCE((e ->> 'never_in')::boolean, false),
          'riskScore', (e ->> 'rank_score')::numeric,
          'band', e ->> 'band'))
          FROM jsonb_array_elements(COALESCE(v_risk -> 'rows', '[]'::jsonb)) e), '[]'::jsonb))
  );
END
$function$;

/* ==================================================== attendance ======= */

CREATE OR REPLACE FUNCTION public.dash5_report_attendance(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_never jsonb; v_abs jsonb; v_streak int;
  c_att_days constant int := 100;
BEGIN
  v_inst  := public.dash_resolve_institution(p_institution_id);
  v_never := public.dash5_never_signed_in(NULL, 1, v_inst);
  v_abs   := public.dash5_chronic_absentees(NULL, NULL, c_att_days, 75, 0, 1, v_inst);
  -- The same query with the streak filter on: its total IS the streak count,
  -- so the report never has to hold an absentee row in order to count one.
  v_streak := (public.dash5_chronic_absentees(NULL, NULL, c_att_days, 75, 3, 1, v_inst) ->> 'total')::int;

  RETURN jsonb_build_object(
    'neverTotal', COALESCE((v_never ->> 'total')::int, 0),
    'neverByWing', COALESCE((
      SELECT jsonb_object_agg(e ->> 'wing_id', (e ->> 'never_in')::int)
        FROM jsonb_array_elements(COALESCE(v_never -> 'wings', '[]'::jsonb)) e
       WHERE e ->> 'wing_id' IS NOT NULL), '{}'::jsonb),
    -- Counts only: the report never prints an absentee's name.
    'absentees', jsonb_build_object(
      'total', COALESCE((v_abs ->> 'total')::int, 0),
      'streak', COALESCE(v_streak, 0),
      'byWing', COALESCE((
        SELECT jsonb_object_agg(e ->> 'wing_id', (e ->> 'n')::int)
          FROM jsonb_array_elements(COALESCE(v_abs -> 'by_wing', '[]'::jsonb)) e
         WHERE e ->> 'wing_id' IS NOT NULL), '{}'::jsonb))
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_report_core(uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_report_students(uuid)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_report_attendance(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_report_core(uuid)       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.dash5_report_students(uuid)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.dash5_report_attendance(uuid) TO authenticated, service_role;
