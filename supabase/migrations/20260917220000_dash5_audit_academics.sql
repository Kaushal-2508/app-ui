-- Admin Dashboard v5, audit round 3: the academics data.
--
-- Closes the last of the audit differences that needed data rather than markup:
--   1. the subject drawer had no homework, lesson-plan or paper figures, and its
--      "where this lands" note had lost the comparison against the class
--   2. the paper drawer could not say how a paper sits against its class or
--      against the school, which is the only thing that makes one paper's
--      average mean anything
--   3. the exam table had no pass rate and no teacher, so the reference's Table
--      view could not be reproduced
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

/* ------------------------------- 1. subject drawer: the rest of the story - */

CREATE OR REPLACE FUNCTION public.dash5_subject_chapters(
  p_class_id uuid, p_subject_id uuid, p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_cg uuid; v_rows jsonb; v_stats jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT c.class_group_id INTO v_cg FROM classes c
   WHERE c.id = p_class_id AND c.institution_id = v_inst;
  IF NOT FOUND THEN RAISE EXCEPTION 'dash5: class not in institution'; END IF;

  WITH chapset AS (
    SELECT st.id, st.topic_name, st.chapter_number, st.display_order
      FROM syllabus_topics st
     WHERE st.is_active AND st.subject_id = p_subject_id
       AND (st.institution_id IS NULL OR st.institution_id = v_inst)
       AND ( EXISTS (SELECT 1 FROM topic_class_mappings tcm
                      WHERE tcm.class_group_id = v_cg AND tcm.topic_id = st.id)
             OR NOT EXISTS (
               SELECT 1 FROM topic_class_mappings t2
                 JOIN syllabus_topics s2 ON s2.id = t2.topic_id
                WHERE t2.class_group_id = v_cg AND s2.is_active AND s2.subject_id = p_subject_id
                  AND (s2.institution_id IS NULL OR s2.institution_id = v_inst)) )
  ),
  prog AS (
    SELECT e.topic_id,
           bool_or(e.action = 'completed') done,
           bool_or(e.action = 'partial')   part,
           max(e.date) last_on
      FROM syllabus_progress_events e
     WHERE e.institution_id = v_inst AND e.class_id = p_class_id AND e.subject_id = p_subject_id
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'topic_id', c.id, 'name', c.topic_name, 'chapter_number', c.chapter_number,
           'state', CASE WHEN p.done THEN 'done' WHEN p.part THEN 'partial' ELSE 'none' END,
           'last_logged_on', p.last_on
         ) ORDER BY COALESCE(c.display_order, 9999), c.chapter_number NULLS LAST, c.topic_name), '[]'::jsonb)
    INTO v_rows
    FROM chapset c LEFT JOIN prog p ON p.topic_id = c.id;

  -- The figures the drawer needs beside the chapter list: this subject's own
  -- performance, and the class it sits in, so the note can say "N points below
  -- the class" instead of leaving the reader to work it out.
  WITH a AS MATERIALIZED (
    SELECT x.* FROM public.dash5_atom_rows(v_inst) x WHERE x.class_id = p_class_id
  ),
  me AS (SELECT * FROM a WHERE a.subject_id = p_subject_id),
  cl AS (
    SELECT sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*)::int pairs,
           count(*) FILTER (WHERE a.papers > 0)::int assessed
      FROM a
  )
  SELECT jsonb_build_object(
    'accuracy', (SELECT round(me.acc, 1) FROM me),
    'attempts', (SELECT me.attempts FROM me),
    'papers', (SELECT me.papers FROM me),
    'students', (SELECT me.students FROM me),
    'lessons_taught', (SELECT me.lessons_taught FROM me),
    'lessons_planned', (SELECT me.lessons_planned FROM me),
    'homework_pct', (SELECT CASE WHEN me.hw_slots > 0
                        THEN round(me.hw_submitted*100.0/me.hw_slots, 1) END FROM me),
    'pending_grading', (SELECT me.pending_grading FROM me),
    'class_accuracy', (SELECT CASE WHEN cl.den > 0 THEN round(cl.num/cl.den, 1) END FROM cl),
    'class_subjects', (SELECT cl.pairs FROM cl),
    'class_subjects_assessed', (SELECT cl.assessed FROM cl),
    'teacher', (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
                  FROM class_assignments ca
                  JOIN profiles pf ON pf.id = ca.user_id
                 WHERE ca.class_id = p_class_id AND ca.subject_id = p_subject_id
                   AND ca.role::text = 'teacher')
  ) INTO v_stats;

  RETURN jsonb_build_object(
    'class_id', p_class_id, 'subject_id', p_subject_id,
    'subject_name', (SELECT us.name FROM universal_subjects us WHERE us.id = p_subject_id),
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'stats', v_stats,
    'chapters', v_rows);
END
$function$;

/* ------------------------- 2. paper detail: where this paper sits ---------- */

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
  -- The two baselines. A paper's 42% means nothing on its own; against a class
  -- that averages 64% and a school that averages 58% it means something.
  atoms AS MATERIALIZED (SELECT x.* FROM public.dash5_atom_rows(v_inst) x),
  cl AS (
    SELECT CASE WHEN sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL) > 0
                THEN round(sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL)
                         / sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL), 1) END v
      FROM atoms a WHERE p_class_id IS NULL OR a.class_id = p_class_id
  ),
  sch AS (
    SELECT CASE WHEN sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL) > 0
                THEN round(sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL)
                         / sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL), 1) END v
      FROM atoms a
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
    'exam_type', e.exam_type::text,
    'total_marks', e.total_marks,
    'pass_marks', e.pass_marks,
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'subjects', COALESCE((SELECT string_agg(DISTINCT us.name, ', ')
                            FROM exam_subjects es
                            JOIN universal_subjects us ON us.id = es.subject_id
                           WHERE es.exam_id = e.id), null),
    'teacher', (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
                  FROM exam_subjects es
                  JOIN class_assignments ca ON ca.subject_id = es.subject_id
                                           AND ca.class_id = p_class_id
                                           AND ca.role::text = 'teacher'
                  JOIN profiles pf ON pf.id = ca.user_id
                 WHERE es.exam_id = e.id),
    'roster', (SELECT n FROM roster),
    'appeared', (SELECT count(*)::int FROM sat),
    'absent', (SELECT count(*)::int FROM r WHERE COALESCE(r.is_absent, false)),
    'unpublished', (SELECT count(*)::int FROM r WHERE r.is_published IS NOT TRUE),
    'avg_pct', (SELECT round(avg(sat.pct), 1) FROM sat),
    'median_pct', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sat.pct)::numeric, 1) FROM sat),
    'pass_pct', (SELECT CASE WHEN count(*) > 0
                   THEN round(count(*) FILTER (WHERE sat.pct >= 35)*100.0/count(*), 1) END FROM sat),
    'top_pct', (SELECT round(max(sat.pct), 1) FROM sat),
    'class_avg_pct', (SELECT v FROM cl),
    'school_avg_pct', (SELECT v FROM sch),
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

/* ------------------------- 3. exam papers: pass rate and teacher ---------- */

-- The reference's Table view has seven columns including Cycle and Pass rate.
-- Neither was returned, so the build's table could only ever be a short list.
CREATE OR REPLACE FUNCTION public.dash5_exam_papers(
  p_wing_id  uuid DEFAULT NULL,
  p_class_id uuid DEFAULT NULL,
  p_from     date DEFAULT NULL,
  p_to       date DEFAULT NULL,
  p_limit    int  DEFAULT 400,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_from date; v_to date; v_lim int; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 400), 1), 400);

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_from := COALESCE(p_from, v_ay_start, v_today - INTERVAL '12 months')::date;
  v_to   := COALESCE(p_to, v_today)::date;

  WITH ev AS (
    SELECT e.id exam_id, e.title, e.exam_type::text cycle,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) d,
           ec.class_id, es.subject_id,
           CASE WHEN e.is_results_only THEN 'Marks only'
                WHEN e.is_offline THEN 'Offline' ELSE 'Online' END mode,
           e.total_marks
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
  sc AS (
    SELECT ev.exam_id, ev.class_id,
           count(*)::int appeared,
           round(avg(fr.percentage), 1) avg_pct,
           round(count(*) FILTER (WHERE fr.percentage >= 35)*100.0/NULLIF(count(*),0), 1) pass_pct,
           round(max(fr.percentage), 1) top_pct
      FROM ev
      JOIN student_exam_attempts a ON a.exam_id = ev.exam_id AND a.class_id = ev.class_id
      JOIN final_results fr ON fr.attempt_id = a.id
     WHERE COALESCE(fr.is_absent, false) = false
     GROUP BY 1,2
  ),
  rost AS (
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
      LEFT JOIN sc ON sc.exam_id = ev.exam_id AND sc.class_id = ev.class_id
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

/* ------------------------------------------------------------- grants ----- */

REVOKE EXECUTE ON FUNCTION public.dash5_subject_chapters(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_subject_chapters(uuid,uuid,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_paper_detail(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_paper_detail(uuid,uuid,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_exam_papers(uuid,uuid,date,date,int,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_exam_papers(uuid,uuid,date,date,int,uuid) TO authenticated, service_role;
