-- =============================================================
-- "Tested in an exam" means a paper actually happened.
-- -------------------------------------------------------------
-- dash_teacher_syllabus_chapters (My syllabus page, teacher dashboard card)
-- counted a paper as held on status alone: published or completed, dated in
-- the academic year. Checked on prod 2026-09-29: of 1,472 such papers, 456 had
-- no sitting (online, offline or hybrid) and no mark at all, and 7 were dated in the future, so a
-- chapter could read "Tested" (and a subject "N papers held") for papers
-- nobody sat. Held now also needs the day to have come and a sitting or a
-- mark on record. Body otherwise identical to 20260929120000.
--
-- dash5_atom_rows ("Papers" in the Command Center) still uses the status-only
-- rule; changing it is a separate, reviewed step (see the commit message).
-- =============================================================
CREATE OR REPLACE FUNCTION public.dash_teacher_syllabus_chapters(p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_pc uuid[]; v_ps uuid[]; v_tz text; v_today date; v_rows jsonb;
  v_ay_start date; v_ay_end date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_teacher_pairs() p;
  IF v_pc IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'subjects', '[]'::jsonb);
  END IF;

  -- Filters may only narrow: anything outside the caller's own pairs raises.
  IF p_class_id IS NOT NULL AND NOT (p_class_id = ANY(v_pc)) THEN
    RAISE EXCEPTION 'dashboard: class not in scope';
  END IF;
  IF p_subject_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(v_ps) AS s(sid) WHERE s.sid = p_subject_id) THEN
    RAISE EXCEPTION 'dashboard: subject not in scope';
  END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  -- The same academic-year window, and the same fallback, as dash5_atom_rows.
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  WITH pairs AS (
    SELECT DISTINCT pr.cid AS class_id, pr.sid AS subject_id
      FROM unnest(v_pc, v_ps) AS pr(cid, sid)
     WHERE pr.sid IS NOT NULL
       AND (p_class_id IS NULL OR pr.cid = p_class_id)
       AND (p_subject_id IS NULL OR pr.sid = p_subject_id)
  ),
  -- Chapter set: the class group's mapped chapters when the subject has any,
  -- else every active chapter of the subject. Same rule as dash5_atom_rows and
  -- dash_syllabus_coverage_build; keep them identical.
  chapters AS (
    SELECT p.class_id, p.subject_id, st.id AS topic_id, st.topic_name,
           st.chapter_number, st.display_order
      FROM pairs p
      JOIN classes cl ON cl.id = p.class_id
      JOIN syllabus_topics st
        ON st.is_active AND st.subject_id = p.subject_id
       AND (st.institution_id IS NULL OR st.institution_id = v_inst)
       AND ( EXISTS (SELECT 1 FROM topic_class_mappings tcm
                      WHERE tcm.class_group_id = cl.class_group_id AND tcm.topic_id = st.id)
             OR NOT EXISTS (
               SELECT 1 FROM topic_class_mappings t2
                 JOIN syllabus_topics s2 ON s2.id = t2.topic_id
                WHERE t2.class_group_id = cl.class_group_id AND s2.is_active
                  AND s2.subject_id = p.subject_id
                  AND (s2.institution_id IS NULL OR s2.institution_id = v_inst)) )
  ),
  progress AS (
    SELECT spe.class_id, spe.subject_id, spe.topic_id,
           bool_or(spe.action = 'completed') AS is_done,
           bool_or(spe.action = 'partial')   AS is_partial,
           max(spe.date)                     AS last_logged_on,
           min(spe.date) FILTER (WHERE spe.action = 'completed') AS first_completed_on,
           -- 2026-09-29: every logged date, so the My syllabus page can open any
           -- of them for editing. One row per (chapter, date): bounded by the year.
           jsonb_agg(jsonb_build_object('date', spe.date, 'action', spe.action) ORDER BY spe.date) AS logs
      FROM syllabus_progress_events spe
      JOIN pairs p ON p.class_id = spe.class_id AND p.subject_id = spe.subject_id
     GROUP BY spe.class_id, spe.subject_id, spe.topic_id
  ),
  planned AS (
    SELECT lp.class_id, lp.subject_id, lp.topic_id, min(lp.date) AS next_planned_on
      FROM tt_lesson_plans lp
      JOIN pairs p ON p.class_id = lp.class_id AND p.subject_id = lp.subject_id
     WHERE lp.topic_id IS NOT NULL
       AND lp.date >= v_today
     GROUP BY lp.class_id, lp.subject_id, lp.topic_id
  ),
  -- Papers HELD for the caller's classes this academic year, one row per
  -- (paper, class). Whoever set it: a paper is a paper for the class.
  held AS (
    SELECT DISTINCT e.id, e.title, ec.class_id,
           COALESCE(e.scheduled_date::date, e.published_at::date, e.created_at::date) AS held_on,
           COALESCE(e.is_results_only, false) AS results_only
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ANY (v_pc)
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
       -- 2026-09-29: held means it HAPPENED. Its day has come, and somebody sat
       -- it: an online/offline attempt (offline section marks hang off it), a
       -- hybrid sitting (hybrid_* is a separate data plane, CLAUDE.md section
       -- 11), or marks entered offline. Status alone is not evidence: 456
       -- published papers had none of the three and 7 were dated ahead, so a
       -- chapter read "Tested" by a paper nobody sat.
       AND COALESCE(e.scheduled_date::date, e.published_at::date, e.created_at::date) <= v_today
       AND (EXISTS (SELECT 1 FROM student_exam_attempts a WHERE a.exam_id = e.id)
            OR EXISTS (SELECT 1 FROM hybrid_exam_attempts h WHERE h.exam_id = e.id)
            OR EXISTS (SELECT 1 FROM offline_student_marks m WHERE m.exam_id = e.id))
  ),
  held_pair AS (
    SELECT DISTINCT h.id, h.title, h.class_id, h.held_on, h.results_only, es.subject_id
      FROM held h
      JOIN exam_subjects es ON es.exam_id = h.id
      JOIN pairs p ON p.class_id = h.class_id AND p.subject_id = es.subject_id
  ),
  tagged AS (
    SELECT DISTINCT et.exam_id, et.topic_id
      FROM exam_topics et
     WHERE et.topic_id IS NOT NULL
       AND et.exam_id IN (SELECT h.id FROM held h)
  ),
  chapter_exams AS (
    SELECT c.class_id, c.topic_id,
           count(*) AS n,
           jsonb_agg(jsonb_build_object(
             'id', h.id, 'title', h.title, 'held_on', h.held_on, 'results_only', h.results_only
           ) ORDER BY h.held_on, h.title) AS exams
      FROM chapters c
      JOIN tagged t ON t.topic_id = c.topic_id
      JOIN held h ON h.id = t.exam_id AND h.class_id = c.class_id
     GROUP BY c.class_id, c.topic_id
  ),
  pair_papers AS (
    SELECT hp.class_id, hp.subject_id,
           count(DISTINCT hp.id) AS papers,
           COALESCE(jsonb_agg(jsonb_build_object(
             'id', hp.id, 'title', hp.title, 'held_on', hp.held_on, 'results_only', hp.results_only
           ) ORDER BY hp.held_on, hp.title) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM tagged t
               JOIN syllabus_topics st ON st.id = t.topic_id
              WHERE t.exam_id = hp.id AND st.subject_id = hp.subject_id)), '[]'::jsonb) AS untagged
      FROM held_pair hp
     GROUP BY hp.class_id, hp.subject_id
  ),
  rows AS (
    SELECT c.class_id, c.subject_id,
           cl.name AS class_name, cl.section, us.name AS subject_name,
           c.topic_id, c.topic_name, c.chapter_number, c.display_order,
           CASE
             WHEN pg.is_done                THEN 'completed'
             WHEN pg.is_partial             THEN 'partial'
             WHEN pl.next_planned_on IS NOT NULL THEN 'scheduled'
             ELSE 'not_started'
           END AS status,
           pg.last_logged_on,
           pg.first_completed_on,
           COALESCE(pg.logs, '[]'::jsonb) AS logs,
           pl.next_planned_on,
           COALESCE(ce.n, 0) AS exams_count,
           COALESCE(ce.exams, '[]'::jsonb) AS exams,
           COALESCE(c.display_order, 9999) AS ord
      FROM chapters c
      JOIN classes cl ON cl.id = c.class_id
      JOIN universal_subjects us ON us.id = c.subject_id
      LEFT JOIN progress pg ON pg.class_id = c.class_id
                           AND pg.subject_id = c.subject_id
                           AND pg.topic_id = c.topic_id
      LEFT JOIN planned pl ON pl.class_id = c.class_id
                          AND pl.subject_id = c.subject_id
                          AND pl.topic_id = c.topic_id
      LEFT JOIN chapter_exams ce ON ce.class_id = c.class_id AND ce.topic_id = c.topic_id
  )
  SELECT COALESCE(jsonb_agg(sub ORDER BY subject_name, class_name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT r.subject_name, r.class_name,
           jsonb_build_object(
             'class_id',     r.class_id,
             'class_name',   r.class_name,
             'section',      r.section,
             'subject_id',   r.subject_id,
             'subject_name', r.subject_name,
             'total',        count(*),
             'completed',    count(*) FILTER (WHERE r.status = 'completed'),
             'partial',      count(*) FILTER (WHERE r.status = 'partial'),
             'scheduled',    count(*) FILTER (WHERE r.status = 'scheduled'),
             'not_started',  count(*) FILTER (WHERE r.status = 'not_started'),
             'exams_total',  sum(r.exams_count),
             'papers',       COALESCE(max(pp.papers), 0),
             'untagged_exams', COALESCE((array_agg(pp.untagged))[1], '[]'::jsonb),
             'chapters', jsonb_agg(jsonb_build_object(
                'topic_id',           r.topic_id,
                'name',               r.topic_name,
                'chapter_number',     r.chapter_number,
                'display_order',      r.display_order,
                'status',             r.status,
                'last_logged_on',     r.last_logged_on,
                'first_completed_on', r.first_completed_on,
                'next_planned_on',    r.next_planned_on,
                'exams_count',        r.exams_count,
                'exams',              r.exams,
                'logs',               r.logs
             ) ORDER BY r.ord, r.chapter_number NULLS LAST, r.topic_name)
           ) AS sub
      FROM rows r
      LEFT JOIN pair_papers pp ON pp.class_id = r.class_id AND pp.subject_id = r.subject_id
     GROUP BY r.class_id, r.class_name, r.section, r.subject_id, r.subject_name
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END
$function$;

REVOKE ALL ON FUNCTION public.dash_teacher_syllabus_chapters(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash_teacher_syllabus_chapters(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_syllabus_chapters(uuid, uuid) TO authenticated, service_role;