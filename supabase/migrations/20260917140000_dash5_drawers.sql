-- Admin Dashboard v5: the data behind the detail drawers.
--
-- Everything on the page so far is a READ. The reference's drawers are where a
-- principal stops reading and does something, so each one needs a person to
-- send the work to and the few extra figures that justify sending it. None of
-- the existing dash5_* functions carry a profile id: they carry names, which
-- are fine to print and useless to assign to.
--
-- Five functions, one per drawer that needed server data:
--   dash5_assign_context   wing / class / subject  -> who owns it + what to ask
--   dash5_subject_roster   one subject in one class, worst student first
--   dash5_paper_detail     one paper, how the marks fell
--   dash5_never_signed_in  the accounts that were created and never used
--   dash5_student_context  one student's guardian and standing
--
-- All five are SECURITY DEFINER over dash_resolve_institution, so a caller can
-- only ever see their own school, and every list is bounded with its true total
-- disclosed alongside (CLAUDE.md 23).

/* ------------------------------------------------- 1. assign context ------- */

-- Answers "who do I send this to, and what is worth asking them for?" for a
-- wing, a class, or one subject in one class. The three assign drawers in the
-- reference differ only in scope, so they share one function rather than three
-- that would drift apart.
--
-- The owner is resolved narrowest-first and FALLS BACK rather than returning
-- nobody: an unstaffed subject still has a class teacher, and an unstaffed class
-- still has a wing coordinator. `target.exact` says whether the person named is
-- the natural owner or a stand-in, so the drawer can say so out loud instead of
-- quietly assigning a subject task to a coordinator.
CREATE OR REPLACE FUNCTION public.dash5_assign_context(
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
  v_pace numeric; v_scope text; v_label text; v_sublabel text;
  v_wing uuid; v_tid uuid; v_tname text; v_trole text; v_exact boolean := true;
  v_full text;
  v_out jsonb;
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
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  -- Pace is how much of the year has gone, not a hardcoded 74%. A school three
  -- weeks into the session is not "behind" for having covered a fifth of the
  -- book, and a fixed line would tell it that it is.
  v_pace := round(LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0) * 100, 1);

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
     ORDER BY pf.full_name LIMIT 1;
    v_trole := 'Subject teacher';
  END IF;

  IF v_tid IS NULL AND p_class_id IS NOT NULL THEN
    IF v_scope = 'subject' THEN v_exact := false; END IF;
    SELECT ca.user_id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
     WHERE ca.class_id = p_class_id AND ca.subject_id IS NULL
       AND ca.role::text = 'teacher' AND pf.is_active IS NOT FALSE
     ORDER BY pf.full_name LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'Class teacher'; END IF;
  END IF;

  IF v_tid IS NULL AND v_wing IS NOT NULL THEN
    IF v_scope <> 'wing' THEN v_exact := false; END IF;
    SELECT wa.user_id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM wing_assignments wa
      JOIN profiles pf ON pf.id = wa.user_id
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
     WHERE wa.wing_id = v_wing AND pf.is_active IS NOT FALSE
     ORDER BY pf.full_name LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'Wing coordinator'; END IF;
  END IF;

  IF v_tid IS NULL THEN
    v_exact := false;
    SELECT pf.id, COALESCE(pf.full_name, pf.email) INTO v_tid, v_tname
      FROM profiles pf
      JOIN user_roles ur ON ur.user_id = pf.id
     WHERE pf.institution_id = v_inst AND pf.is_active IS NOT FALSE
       AND ur.role::text IN ('school_admin','super_school_admin')
     ORDER BY pf.full_name LIMIT 1;
    IF v_tid IS NOT NULL THEN v_trole := 'School admin'; END IF;
  END IF;

  /* ---- the figures the ask has to stand on ---- */
  WITH a AS MATERIALIZED (
    SELECT x.* FROM public.dash5_atom_rows(v_inst) x
     WHERE (v_wing IS NULL OR p_class_id IS NOT NULL OR x.wing_id = v_wing)
       AND (p_class_id IS NULL OR x.class_id = p_class_id)
       AND (p_subject_id IS NULL OR x.subject_id = p_subject_id)
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
           COALESCE(sum(a.pending_grading),0)::int pending,
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
      FROM (SELECT DISTINCT a.class_id, a.students, a.att_present, a.att_total FROM a) p
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
                 'Conduct a first paper in ' || m.pairs_no_paper || ' subject'
                   || CASE WHEN m.pairs_no_paper = 1 THEN '' ELSE 's' END,
                 m.pairs_no_paper || ' of ' || m.pairs || ' subject-class pairs have had no paper this year, so they are unmeasured in every score on the dashboard.'
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
                 'Attendance is ' || m.att || '%, below the 75% floor board eligibility needs.'
           WHERE m.att IS NOT NULL AND m.att < 75

          UNION ALL
          SELECT 2, 'academic_content'::task_type, 7,
                 'Raise homework submission in ' || v_full,
                 'Submission is running at ' || m.hw || '% of what has been set.'
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

/* ------------------------------------------------- 2. subject roster ------- */

-- Every student taking one subject in one class, worst mark first. The subject
-- mark uses the SAME definition as the tree (published or completed papers this
-- academic year, absent sitters excluded), so a principal who drills from a 46%
-- subject average into this list sees numbers that add back up to 46%.
CREATE OR REPLACE FUNCTION public.dash5_subject_roster(
  p_class_id   uuid,
  p_subject_id uuid,
  p_limit      int DEFAULT 200,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_lim int; v_key text; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 400);

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  -- universal_subjects holds one row per subject PER GRADE, so matching on the
  -- id alone would miss papers filed against a sibling row of the same subject.
  SELECT initcap(lower(btrim(us.name))) INTO v_key
    FROM universal_subjects us WHERE us.id = p_subject_id;

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x WHERE x.class_id = p_class_id
  ),
  marks AS (
    SELECT a.student_id, round(avg(fr.percentage), 1) pct, count(*)::int papers
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
      JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
       AND COALESCE(fr.is_absent, false) = false
       AND initcap(lower(btrim(us.name))) = v_key
       AND a.student_id IN (SELECT s.student_id FROM s)
     GROUP BY 1
  ),
  j AS (
    SELECT s.student_id, s.full_name, s.roll, s.never_in,
           s.score, s.attendance_pct, s.homework_pct,
           m.pct subject_pct, COALESCE(m.papers, 0) subject_papers
      FROM s LEFT JOIN marks m ON m.student_id = s.student_id
  )
  SELECT jsonb_build_object(
    'class_id', p_class_id,
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'subject_id', p_subject_id,
    'subject_name', (SELECT us.name FROM universal_subjects us WHERE us.id = p_subject_id),
    'total', (SELECT count(*)::int FROM j),
    'scored', (SELECT count(*)::int FROM j WHERE j.subject_pct IS NOT NULL),
    'lowest',  (SELECT min(j.subject_pct) FROM j),
    'median',  (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY j.subject_pct)::numeric, 1)
                  FROM j WHERE j.subject_pct IS NOT NULL),
    'highest', (SELECT max(j.subject_pct) FROM j),
    'count', (SELECT count(*)::int FROM (SELECT 1 FROM j LIMIT v_lim) z),
    -- Unmarked students sort last, not first: a missing mark is not a zero.
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'student_id', r.student_id, 'name', r.full_name, 'roll', r.roll,
               'never_in', r.never_in, 'subject_pct', r.subject_pct,
               'subject_papers', r.subject_papers, 'score', r.score,
               'attendance_pct', r.attendance_pct, 'homework_pct', r.homework_pct) ORDER BY r.ord)
        FROM (SELECT j.*, row_number() OVER (
                       ORDER BY j.subject_pct NULLS LAST, j.full_name) ord
                FROM j ORDER BY j.subject_pct NULLS LAST, j.full_name LIMIT v_lim) r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------- 3. paper detail --------- */

-- One paper in one class: how many sat it, how the marks fell across five
-- bands, and the five students at each end. The band buckets are marks, not the
-- composite band used elsewhere on the page, because a paper measures one thing.
CREATE OR REPLACE FUNCTION public.dash5_paper_detail(
  p_exam_id  uuid,
  p_class_id uuid,
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
  IF NOT EXISTS (SELECT 1 FROM exams WHERE id = p_exam_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: exam not in institution';
  END IF;

  WITH r AS (
    SELECT a.student_id, fr.percentage pct, fr.is_absent,
           fr.total_marks_obtained, fr.total_max_marks, fr.is_published,
           COALESCE(pf.full_name, pf.email) nm
      FROM student_exam_attempts a
      JOIN final_results fr ON fr.attempt_id = a.id
      JOIN profiles pf ON pf.id = a.student_id
     WHERE a.exam_id = p_exam_id
       AND (p_class_id IS NULL OR a.class_id = p_class_id)
  ),
  sat AS (SELECT * FROM r WHERE COALESCE(r.is_absent, false) = false AND r.pct IS NOT NULL),
  roster AS (
    SELECT count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
     WHERE ca.role::text = 'student'
       AND (p_class_id IS NULL OR ca.class_id = p_class_id)
       AND ca.user_id IN (SELECT z.student_id FROM public.institution_student_ids(v_inst) z)
  ),
  buckets(lo, hi, label, ord) AS (
    VALUES (80::numeric, 1000::numeric, '80% and above', 1),
           (65, 80, '65 to 79%', 2), (50, 65, '50 to 64%', 3),
           (35, 50, '35 to 49%', 4), (-1, 35, 'Below 35%', 5)
  )
  SELECT jsonb_build_object(
    'exam_id', e.id,
    'title', e.title,
    'date', COALESCE(e.scheduled_date::date, e.published_at::date, e.created_at::date),
    'status', e.status::text,
    'mode', CASE WHEN e.is_results_only THEN 'Marks only'
                 WHEN e.is_offline THEN 'Offline' ELSE 'Online' END,
    'total_marks', e.total_marks,
    'pass_marks', e.pass_marks,
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'subjects', COALESCE((SELECT string_agg(DISTINCT us.name, ', ')
                            FROM exam_subjects es
                            JOIN universal_subjects us ON us.id = es.subject_id
                           WHERE es.exam_id = e.id), null),
    'roster', (SELECT n FROM roster),
    'appeared', (SELECT count(*)::int FROM sat),
    'absent', (SELECT count(*)::int FROM r WHERE COALESCE(r.is_absent, false)),
    'unpublished', (SELECT count(*)::int FROM r WHERE r.is_published IS NOT TRUE),
    'avg_pct', (SELECT round(avg(sat.pct), 1) FROM sat),
    'median_pct', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sat.pct)::numeric, 1) FROM sat),
    'pass_pct', (SELECT CASE WHEN count(*) > 0
                   THEN round(count(*) FILTER (WHERE sat.pct >= 35)*100.0/count(*), 1) END FROM sat),
    'bands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'label', b.label,
               'n', (SELECT count(*)::int FROM sat WHERE sat.pct >= b.lo AND sat.pct < b.hi))
             ORDER BY b.ord) FROM buckets b), '[]'::jsonb),
    'bottom', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', x.nm, 'pct', round(x.pct,1),
               'obtained', x.total_marks_obtained, 'max', x.total_max_marks) ORDER BY x.pct)
        FROM (SELECT * FROM sat ORDER BY sat.pct LIMIT 5) x), '[]'::jsonb),
    'top', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', x.nm, 'pct', round(x.pct,1),
               'obtained', x.total_marks_obtained, 'max', x.total_max_marks) ORDER BY x.pct DESC)
        FROM (SELECT * FROM sat ORDER BY sat.pct DESC LIMIT 5) x), '[]'::jsonb)
  ) INTO v_out
  FROM exams e WHERE e.id = p_exam_id;

  RETURN v_out;
END
$function$;

/* ------------------------------------------- 4. never signed in ------------ */

-- Accounts that exist and have never been used. Grouped by wing with the
-- coordinator who can chase them, because the ask is always "get this wing
-- onboarded" and never "get this one child onboarded".
CREATE OR REPLACE FUNCTION public.dash5_never_signed_in(
  p_wing_id uuid DEFAULT NULL,
  p_limit   int  DEFAULT 100,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_lim int; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300);

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x
  ),
  n AS (SELECT * FROM s WHERE s.never_in),
  w AS (
    SELECT wg.id, wg.name,
           (SELECT count(*)::int FROM s WHERE s.wing_id = wg.id) students,
           (SELECT count(*)::int FROM n WHERE n.wing_id = wg.id) never_in,
           (SELECT wa.user_id FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = wg.id AND pf.is_active IS NOT FALSE
             ORDER BY pf.full_name LIMIT 1) coord_id,
           (SELECT COALESCE(pf.full_name, pf.email) FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = wg.id AND pf.is_active IS NOT FALSE
             ORDER BY pf.full_name LIMIT 1) coord_name
      FROM wings wg
     WHERE wg.institution_id = v_inst AND wg.is_active IS NOT FALSE
  ),
  f AS (SELECT * FROM n WHERE p_wing_id IS NULL OR n.wing_id = p_wing_id)
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM n),
    'students', (SELECT count(*)::int FROM s),
    'filtered_total', (SELECT count(*)::int FROM f),
    'count', (SELECT count(*)::int FROM (SELECT 1 FROM f LIMIT v_lim) z),
    'unmapped', (SELECT count(*)::int FROM n WHERE n.wing_id IS NULL),
    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'wing_id', w.id, 'wing_name', w.name, 'students', w.students,
               'never_in', w.never_in,
               'pct', CASE WHEN w.students > 0
                           THEN round(w.never_in*100.0/w.students, 1) END,
               'coordinator_id', w.coord_id, 'coordinator', w.coord_name)
             ORDER BY w.never_in DESC, w.name) FROM w), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'student_id', r.student_id, 'name', r.full_name, 'roll', r.roll,
               'class_label', r.class_label, 'wing_id', r.wing_id) ORDER BY r.class_label, r.full_name)
        FROM (SELECT * FROM f ORDER BY f.class_label, f.full_name LIMIT v_lim) r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------- 5. student context ------------ */

-- One student's standing plus the guardian on their record, for the drawer that
-- messages a parent about attendance. SALCI has no parent login, so the drawer
-- has to show the admin exactly which number the circular would reach, and say
-- so when there is not one.
CREATE OR REPLACE FUNCTION public.dash5_student_context(
  p_student_id uuid,
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
  IF NOT EXISTS (SELECT 1 FROM public.institution_student_ids(v_inst) z
                  WHERE z.student_id = p_student_id) THEN
    RAISE EXCEPTION 'dash5: student not in institution';
  END IF;

  WITH s AS (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x WHERE x.student_id = p_student_id
  ),
  ct AS (
    SELECT ca.user_id id, COALESCE(pf.full_name, pf.email) nm
      FROM class_assignments ca
      JOIN profiles pf ON pf.id = ca.user_id
      JOIN s ON s.class_id = ca.class_id
     WHERE ca.subject_id IS NULL AND ca.role::text = 'teacher'
       AND pf.is_active IS NOT FALSE
     ORDER BY pf.full_name LIMIT 1
  ),
  co AS (
    SELECT wa.user_id id, COALESCE(pf.full_name, pf.email) nm
      FROM wing_assignments wa
      JOIN profiles pf ON pf.id = wa.user_id
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
      JOIN s ON s.wing_id = wa.wing_id
     WHERE pf.is_active IS NOT FALSE
     ORDER BY pf.full_name LIMIT 1
  )
  SELECT jsonb_build_object(
    'student_id', s.student_id, 'name', s.full_name, 'roll', s.roll,
    'class_id', s.class_id, 'class_label', s.class_label, 'wing_id', s.wing_id,
    'never_in', s.never_in, 'at_risk', s.at_risk, 'band', s.band,
    'score', s.score, 'attendance_pct', s.attendance_pct,
    'homework_pct', s.homework_pct, 'submission_pct', s.submission_pct,
    'guardian', jsonb_build_object(
      'name',  (SELECT d.guardian_name  FROM student_personal_details d WHERE d.profile_id = s.student_id),
      'phone', (SELECT d.guardian_phone FROM student_personal_details d WHERE d.profile_id = s.student_id),
      'email', (SELECT d.guardian_email FROM student_personal_details d WHERE d.profile_id = s.student_id)),
    'class_teacher', (SELECT jsonb_build_object('id', ct.id, 'name', ct.nm) FROM ct),
    'coordinator',   (SELECT jsonb_build_object('id', co.id, 'name', co.nm) FROM co)
  ) INTO v_out FROM s;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------------------- grants ------ */
-- Supabase grants EXECUTE to anon by default and REVOKE FROM PUBLIC does not
-- strip it, so every one of these is revoked BY NAME (CLAUDE.md 26).

REVOKE EXECUTE ON FUNCTION public.dash5_assign_context(uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_assign_context(uuid,uuid,uuid,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_subject_roster(uuid,uuid,int,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_subject_roster(uuid,uuid,int,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_paper_detail(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_paper_detail(uuid,uuid,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_never_signed_in(uuid,int,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_never_signed_in(uuid,int,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_student_context(uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_student_context(uuid,uuid) TO authenticated, service_role;
