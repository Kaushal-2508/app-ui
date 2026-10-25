-- Admin dashboard accuracy pass, part 3: the downloadable school report.
-- Audit: docs/admin-dashboard-audit-2026-10-05.md (R1, R2, R4).
--
-- dash5_report_core summed every atom row, so a class mapped into two wings
-- counted twice in the school totals and in its own class row (papers,
-- chapters, students); averages came from the subject-matched atoms only.
-- Now, like dash5_tree (20261005160500):
--   * school, class and subject figures read one atom per class x subject,
--     and one roster per class;
--   * school, wing and class averages and paper counts come from every
--     counted result of the class (published marks only, blank papers out);
--   * a band is NULL ("N/A" on paper) when there is no average, instead of
--     "Attention".
-- The wing list keeps per-wing atoms (a class in two wings belongs to both).
-- Same signature, owner and grants.

CREATE OR REPLACE FUNCTION public.dash5_report_core(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  -- One atom per class x subject for every school, class and subject figure.
  au AS (SELECT DISTINCT ON (x.class_id, x.subject_id) x.* FROM a x ORDER BY x.class_id, x.subject_id, x.wing_id),
  -- Roster size and attendance are CLASS facts.
  pc AS (SELECT DISTINCT x.class_id, x.wing_id, x.students, x.att_present, x.att_total FROM a x),
  pcu AS (SELECT DISTINCT ON (x.class_id) x.class_id, x.students, x.att_present, x.att_total
            FROM pc x ORDER BY x.class_id),
  -- Every counted result of an active class this year, whatever subject it
  -- was filed under.
  cres AS MATERIALIZED (
    SELECT c.exam_id, c.class_id, c.percentage
      FROM public.dash5_counted_results(v_inst) c
     WHERE c.exam_date BETWEEN COALESCE(v_ay_start, v_today - 365) AND COALESCE(v_ay_end, v_today)
       AND c.class_id IN (SELECT pcu.class_id FROM pcu)
  ),
  cacc AS (
    SELECT c.class_id, count(*)::int n, sum(c.percentage) s, count(DISTINCT c.exam_id)::int papers
      FROM cres c GROUP BY 1
  ),
  wacc AS (
    SELECT p.wing_id, count(*)::int n, sum(c.percentage) s, count(DISTINCT c.exam_id)::int papers
      FROM cres c JOIN pc p ON p.class_id = c.class_id GROUP BY 1
  ),
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
           sum(x.chapters) FILTER (WHERE x.students > 0)::int chapters,
           sum(x.chapters_done) FILTER (WHERE x.students > 0)::int chapters_done,
           sum(x.chapters_partial) FILTER (WHERE x.students > 0)::int chapters_partial,
           sum(x.lessons_planned)::int lessons_planned, sum(x.lessons_taught)::int lessons_taught,
           sum(x.wk_done)::int wk_done, sum(x.wk_planned)::int wk_planned,
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
           sum(x.chapters_partial)::int chapters_partial
      FROM au x GROUP BY x.class_id
  ),
  -- One row per distinct subject.
  sagg AS (
    SELECT x.subject_key, max(s.name) nm,
           count(DISTINCT x.class_id)::int classes,
           sum(x.papers)::int papers, sum(x.attempts)::int attempts,
           sum(x.acc * x.attempts) FILTER (WHERE x.acc IS NOT NULL) acc_num,
           sum(x.attempts)         FILTER (WHERE x.acc IS NOT NULL) acc_den,
           sum(x.chapters) FILTER (WHERE x.students > 0)::int chapters,
           sum(x.chapters_done) FILTER (WHERE x.students > 0)::int chapters_done,
           sum(x.chapters_partial) FILTER (WHERE x.students > 0)::int chapters_partial
      FROM au x LEFT JOIN subjects s ON s.id = x.subject_id
     GROUP BY x.subject_key
  ),
  sch AS (
    SELECT (SELECT COALESCE(sum(p.students), 0)::int FROM pcu p) students,
           (SELECT count(*)::int FROM pcu p) class_count,
           (SELECT COALESCE(sum(p.att_present), 0)::int FROM pcu p) att_present,
           (SELECT COALESCE(sum(p.att_total), 0)::int FROM pcu p) att_total,
           count(*)::int subject_pairs, count(DISTINCT x.subject_key)::int subject_count,
           COALESCE(sum(x.chapters) FILTER (WHERE x.students > 0), 0)::int chapters,
           COALESCE(sum(x.chapters_done) FILTER (WHERE x.students > 0), 0)::int chapters_done,
           COALESCE(sum(x.chapters_partial) FILTER (WHERE x.students > 0), 0)::int chapters_partial,
           COALESCE(sum(x.lessons_planned), 0)::int lessons_planned,
           COALESCE(sum(x.lessons_taught), 0)::int lessons_taught,
           (SELECT count(DISTINCT c.exam_id)::int FROM cres c) papers,
           COALESCE(sum(x.wk_done), 0)::int wk_done,
           COALESCE(sum(x.wk_planned), 0)::int wk_planned,
           (SELECT count(*)::int FROM cres c) attempts,
           (SELECT sum(c.percentage) FROM cres c) acc_num,
           (SELECT count(*) FROM cres c) acc_den,
           COALESCE(sum(x.hw_slots), 0)::int hw_slots,
           COALESCE(sum(x.hw_submitted), 0)::int hw_submitted,
           count(*) FILTER (WHERE x.papers = 0)::int pairs_no_paper
      FROM au x
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
        'band', public.dash5_band_or_null(CASE WHEN s.acc_den > 0 THEN round(s.acc_num / s.acc_den, 1) END)
      ) FROM sch s),

    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wg.id, 'name', wg.name,
        'span', COALESCE(NULLIF(btrim(wg.description), ''), (
          SELECT CASE WHEN min(c2.name) = max(c2.name) THEN min(c2.name)
                      ELSE min(c2.name) || ' to ' || max(c2.name) END
            FROM wing_class_mappings m2
            JOIN classes c2 ON c2.id = m2.class_id
           WHERE m2.wing_id = wg.id), ''),
        'head', COALESCE((
          SELECT string_agg(COALESCE(pf.full_name, pf.email), ', ' ORDER BY COALESCE(pf.full_name, pf.email))
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
        'papers', COALESCE(wa2.papers, 0),
        'papersPlanned',   COALESCE((wp.p ->> 'planned')::int, 0),
        'papersPublished', COALESCE((wp.p ->> 'held_results_out')::int, 0),
        'pendingGrading',  COALESCE((wp.p ->> 'held_results_pending')::int, 0),
        'papersScheduled', COALESCE((wp.p ->> 'on_calendar')::int, 0),
        'papersDraft',     COALESCE((wp.p ->> 'in_draft')::int, 0),
        'wkDone', COALESCE(g.wk_done, 0), 'wkPlanned', COALESCE(g.wk_planned, 0),
        'accuracy', CASE WHEN wa2.n > 0 THEN round(wa2.s / wa2.n, 1) END,
        'attempts', COALESCE(wa2.n, 0),
        'homework', CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted * 100.0 / g.hw_slots, 1) END,
        'chapters', COALESCE(g.chapters, 0), 'chaptersDone', COALESCE(g.chapters_done, 0),
        'chaptersPartial', COALESCE(g.chapters_partial, 0),
        'band', public.dash5_band_or_null(CASE WHEN wa2.n > 0 THEN round(wa2.s / wa2.n, 1) END),
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
            'papers', COALESCE(ca.papers, 0),
            'accuracy', CASE WHEN ca.n > 0 THEN round(ca.s / ca.n, 1) END,
            'band', public.dash5_band_or_null(CASE WHEN ca.n > 0 THEN round(ca.s / ca.n, 1) END))
            ORDER BY c.name, c.section)
            FROM pc p
            JOIN classes c ON c.id = p.class_id
            LEFT JOIN cagg cg ON cg.class_id = p.class_id
            LEFT JOIN cacc ca ON ca.class_id = p.class_id
            LEFT JOIN ct ON ct.class_id = p.class_id
           WHERE p.wing_id = wg.id), '[]'::jsonb))
        ORDER BY wg.display_order NULLS LAST, wg.name)
        FROM wings wg
        LEFT JOIN wagg g ON g.wing_id = wg.id
        LEFT JOIN wros k ON k.wing_id = wg.id
        LEFT JOIN wacc wa2 ON wa2.wing_id = wg.id
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
