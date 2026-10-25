-- Per-chapter syllabus detail for the teacher dashboard.
--
-- The summary card only ever said "17 of 30 chapters". This returns the chapter
-- list behind that number, so a teacher can see WHICH are done, which are part
-- done, which are scheduled, which are untouched, and how many of their own
-- exams have covered each one.
--
-- STATUS is derived, in this precedence order:
--   completed   — a syllabus_progress_events row with action='completed'
--   partial     — action='partial' only
--   scheduled   — no progress yet, but a tt_lesson_plans row dated today or later
--   not_started — nothing at all
--
-- Measured for Teacher2 / English Core / Class 12 Science Non-Medical A:
--   30 chapters · 17 completed · 10 partial · 7 chapters carry exams (36 links)
--   · 17 lesson plans, none of them future-dated — so 'scheduled' will be empty
--   until lessons are actually planned ahead. That is a real state, not a bug,
--   and the UI must not imply otherwise.
--
-- Deliberately NO "on track / behind" anywhere: there is still no per-chapter
-- due date in the schema to judge against.
CREATE OR REPLACE FUNCTION public.dash_teacher_syllabus_chapters(
  p_class_id   uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_pc uuid[]; v_ps uuid[]; v_tz text; v_today date; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_scoped_pairs() p;
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

  WITH pairs AS (
    SELECT DISTINCT pr.cid AS class_id, pr.sid AS subject_id
      FROM unnest(v_pc, v_ps) AS pr(cid, sid)
     WHERE pr.sid IS NOT NULL
       AND (p_class_id IS NULL OR pr.cid = p_class_id)
       AND (p_subject_id IS NULL OR pr.sid = p_subject_id)
  ),
  chapters AS (
    SELECT p.class_id, p.subject_id, st.id AS topic_id, st.topic_name,
           st.chapter_number, st.display_order
      FROM pairs p
      JOIN syllabus_topics st ON st.subject_id = p.subject_id
                             AND COALESCE(st.is_active, true)
  ),
  progress AS (
    SELECT spe.class_id, spe.subject_id, spe.topic_id,
           bool_or(spe.action = 'completed') AS is_done,
           bool_or(spe.action = 'partial')   AS is_partial,
           max(spe.date)                     AS last_logged_on
      FROM syllabus_progress_events spe
     WHERE spe.institution_id = v_inst
     GROUP BY spe.class_id, spe.subject_id, spe.topic_id
  ),
  planned AS (
    SELECT lp.class_id, lp.subject_id, lp.topic_id, min(lp.date) AS next_planned_on
      FROM tt_lesson_plans lp
     WHERE lp.institution_id = v_inst AND lp.topic_id IS NOT NULL
       AND lp.date >= v_today
     GROUP BY lp.class_id, lp.subject_id, lp.topic_id
  ),
  exams AS (
    -- The teacher's OWN exams that name this chapter, in this class.
    SELECT et.topic_id, ec.class_id, count(DISTINCT e.id) AS exams_count
      FROM exam_topics et
      JOIN exams e ON e.id = et.exam_id AND e.created_by = v_uid
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.status IN ('published','active','completed')
     GROUP BY et.topic_id, ec.class_id
  ),
  rows AS (
    SELECT c.class_id, c.subject_id,
           cl.name AS class_name, cl.section, us.name AS subject_name,
           c.topic_id, c.topic_name, c.chapter_number,
           CASE
             WHEN pg.is_done                THEN 'completed'
             WHEN pg.is_partial             THEN 'partial'
             WHEN pl.next_planned_on IS NOT NULL THEN 'scheduled'
             ELSE 'not_started'
           END AS status,
           pg.last_logged_on,
           pl.next_planned_on,
           COALESCE(ex.exams_count, 0) AS exams_count,
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
      LEFT JOIN exams ex ON ex.topic_id = c.topic_id AND ex.class_id = c.class_id
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
             'chapters', jsonb_agg(jsonb_build_object(
                'topic_id',        r.topic_id,
                'name',            r.topic_name,
                'chapter_number',  r.chapter_number,
                'status',          r.status,
                'last_logged_on',  r.last_logged_on,
                'next_planned_on', r.next_planned_on,
                'exams_count',     r.exams_count
             ) ORDER BY r.ord, r.chapter_number NULLS LAST, r.topic_name)
           ) AS sub
      FROM rows r
     GROUP BY r.class_id, r.class_name, r.section, r.subject_id, r.subject_name
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_syllabus_chapters(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_syllabus_chapters(uuid, uuid) TO authenticated;
