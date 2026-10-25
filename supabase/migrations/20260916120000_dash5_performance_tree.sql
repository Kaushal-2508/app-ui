-- Admin Dashboard v5, phase 1: the performance tree.
-- Design: docs/superpowers/specs/2026-09-16-admin-dashboard-v5-design.md
-- Reference: public/report_reference/salci-admin-dashboard-v5.html
--
-- ONE atom - the (class, subject) row - and every level above it is the sum or
-- the weighted mean of the atoms inside it. Wings, classes and subjects are
-- therefore incapable of disagreeing with each other, which is the whole point
-- of the reference's "every number below a row is the sum of the rows inside it".
--
-- Measured on Alliance before shipping: 726 atoms over 53 active classes,
-- student total 1,545 (matches institution_student_ids exactly), ~1s.
--
-- Facts about THIS database that the shape depends on, all verified, none
-- assumed: exams.status is draft | published | completed (there is no 'active');
-- class_assignments.role is coordinator | student | teacher, so a class teacher
-- is the teacher row carrying no subject; syllabus_progress_events.action is
-- completed | partial; there is no format_class_label() to call.

/* ------------------------------------------------------------- helpers ---- */

-- The composite and its banding, declared ONCE. A second copy is how a KPI and
-- the table under it start disagreeing; SEVERITY_WEIGHTS already did that once.
CREATE OR REPLACE FUNCTION public.dash5_composite(
  p_accuracy numeric, p_syllabus numeric, p_attendance numeric, p_lesson_pct numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT 0.45 * COALESCE(p_accuracy, 0)
       + 0.25 * COALESCE(p_syllabus, 0)
       + 0.15 * COALESCE(p_attendance, 0)
       + 0.15 * COALESCE(p_lesson_pct, 0);
$$;

CREATE OR REPLACE FUNCTION public.dash5_band(p_score numeric) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_score IS NULL THEN 'att'
    WHEN p_score >= 84   THEN 'exc'
    WHEN p_score >= 75.5 THEN 'good'
    WHEN p_score >= 66   THEN 'watch'
    ELSE 'att' END;
$$;

/* ------------------------------------------------------------- the atom --- */

-- INTERNAL. Takes an institution id and trusts it, so it is revoked from every
-- client role; dash5_tree runs as owner and can therefore still call it, while
-- an authenticated caller cannot pass someone else's institution (audit S-1).
-- Dropped rather than replaced: the OUT columns changed when subject_key was
-- added, and CREATE OR REPLACE cannot change a function's return type.
DROP FUNCTION IF EXISTS public.dash5_atom_rows(uuid);
CREATE OR REPLACE FUNCTION public.dash5_atom_rows(p_inst uuid)
RETURNS TABLE (
  class_id uuid, subject_id uuid, subject_key text, wing_id uuid, class_group_id uuid,
  students int, chapters int, chapters_done int, chapters_partial int,
  lessons_planned int, lessons_taught int,
  papers int, wk_done int, wk_planned int, pending_grading int,
  attempts int, acc numeric,
  hw_slots int, hw_submitted int, att_present int, att_total int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text; v_today date; v_monday date; v_ay_start date; v_ay_end date;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_today  := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  v_monday := v_today - (extract(isodow FROM v_today)::int - 1);
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(p_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  WITH cls AS (
    SELECT c.id, c.class_group_id, m.wing_id
      FROM classes c
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE c.institution_id = p_inst AND c.is_active IS NOT FALSE
  ),
  prs AS (
    SELECT DISTINCT scm.class_id, scm.subject_id, cl.class_group_id, cl.wing_id
      FROM subject_class_mappings scm
      JOIN cls cl ON cl.id = scm.class_id
     WHERE scm.institution_id = p_inst
  ),
  roster AS (
    -- The one definition of a student. Never hand-count class_assignments.
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
      JOIN cls cl ON cl.id = ca.class_id
     WHERE ca.role::text = 'student'
       AND ca.user_id IN (SELECT s.student_id FROM public.institution_student_ids(p_inst) s)
     GROUP BY 1
  ),
  cg_subj AS (SELECT DISTINCT p.class_group_id, p.subject_id FROM prs p WHERE p.class_group_id IS NOT NULL),
  -- Chapter denominator, the rule dash_syllabus_coverage_build already uses:
  -- class-group mapped chapters when the subject has any, else every active
  -- chapter of the subject (institution-scoped or global).
  chapset AS (
    SELECT cs.class_group_id, cs.subject_id, st.id AS chapter_id
      FROM cg_subj cs
      JOIN syllabus_topics st
        ON st.is_active AND st.subject_id = cs.subject_id
       AND (st.institution_id IS NULL OR st.institution_id = p_inst)
       AND ( EXISTS (SELECT 1 FROM topic_class_mappings tcm
                      WHERE tcm.class_group_id = cs.class_group_id AND tcm.topic_id = st.id)
             OR NOT EXISTS (
               SELECT 1 FROM topic_class_mappings t2
                 JOIN syllabus_topics s2 ON s2.id = t2.topic_id
                WHERE t2.class_group_id = cs.class_group_id AND s2.is_active
                  AND s2.subject_id = cs.subject_id
                  AND (s2.institution_id IS NULL OR s2.institution_id = p_inst)) )
  ),
  chaptot AS (SELECT c.class_group_id, c.subject_id, count(*)::int total FROM chapset c GROUP BY 1,2),
  prog AS (
    SELECT e.class_id, e.subject_id, e.topic_id,
           bool_or(e.action = 'completed') done,
           bool_or(e.action = 'partial')   part
      FROM syllabus_progress_events e
     WHERE e.institution_id = p_inst
     GROUP BY 1,2,3
  ),
  chapstate AS (
    SELECT p.class_id, p.subject_id,
           count(*) FILTER (WHERE pr.done)::int done,
           count(*) FILTER (WHERE pr.part AND NOT pr.done)::int part
      FROM prs p
      JOIN chapset cs ON cs.class_group_id = p.class_group_id AND cs.subject_id = p.subject_id
      LEFT JOIN prog pr ON pr.class_id = p.class_id AND pr.subject_id = p.subject_id
                       AND pr.topic_id = cs.chapter_id
     GROUP BY 1,2
  ),
  lessons AS (
    SELECT lp.class_id, lp.subject_id,
           count(*)::int planned,
           count(*) FILTER (WHERE lp.status = 'done')::int taught
      FROM tt_lesson_plans lp
     WHERE lp.institution_id = p_inst AND lp.session_type = 'teaching'
     GROUP BY 1,2
  ),
  ex AS (
    SELECT ec.class_id, es.subject_id, e.id exam_id, e.status,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) d,
           e.scheduled_date::date sd
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = p_inst
  ),
  papers AS (
    SELECT x.class_id, x.subject_id,
           count(DISTINCT x.exam_id) FILTER (
             WHERE x.status IN ('published','completed') AND x.d BETWEEN v_ay_start AND v_ay_end)::int papers,
           count(DISTINCT x.exam_id) FILTER (
             WHERE x.status IN ('published','completed') AND x.d BETWEEN v_monday AND v_today)::int wk_done,
           -- Held, plus the ones the calendar promised and the class did not
           -- sit. NOT "scheduled this week": most papers here carry no
           -- scheduled_date at all, so that denominator produced 14 held out of
           -- 5 planned. The skipped ones are the number worth acting on.
           (count(DISTINCT x.exam_id) FILTER (
              WHERE x.status IN ('published','completed') AND x.d BETWEEN v_monday AND v_today)
            + count(DISTINCT x.exam_id) FILTER (
              WHERE x.sd BETWEEN v_monday AND v_today
                AND x.status NOT IN ('published','completed')))::int wk_planned
      FROM ex x
     GROUP BY 1,2
  ),
  -- Pending grading is not a status in this schema. A paper is outstanding
  -- while any of its results is still unpublished, which is what is owed.
  pend AS (
    SELECT a.class_id, es.subject_id, count(DISTINCT e.id)::int pending
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = p_inst AND fr.is_published IS NOT TRUE
     GROUP BY 1,2
  ),
  scores AS (
    -- Absent sitters are excluded: a zero for not turning up measures the
    -- register, not the teaching. The reference counts absentees separately.
    SELECT a.class_id, es.subject_id, count(*)::int attempts, avg(fr.percentage) acc
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = p_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
       AND COALESCE(fr.is_absent, false) = false
     GROUP BY 1,2
  ),
  hw AS (
    SELECT hc.class_id, hs.subject_id,
           count(DISTINCT h.id)::int assigned,
           count(DISTINCT sub.id)::int submitted
      FROM homework_assignments h
      JOIN homework_assignment_classes  hc ON hc.homework_assignment_id = h.id
      JOIN homework_assignment_subjects hs ON hs.homework_assignment_id = h.id
      LEFT JOIN homework_submissions sub ON sub.homework_assignment_id = h.id
     WHERE h.institution_id = p_inst
     GROUP BY 1,2
  ),
  att AS (
    SELECT ar.class_id,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::int present,
           count(*)::int total
      FROM attendance_records ar
     WHERE ar.institution_id = p_inst AND ar.date BETWEEN v_ay_start AND v_ay_end
     GROUP BY 1
  )
  SELECT p.class_id, p.subject_id, initcap(lower(btrim(us0.name))), p.wing_id, p.class_group_id,
         COALESCE(r.n, 0),
         COALESCE(ct.total, 0), COALESCE(cs2.done, 0), COALESCE(cs2.part, 0),
         COALESCE(l.planned, 0), COALESCE(l.taught, 0),
         COALESCE(pp.papers, 0), COALESCE(pp.wk_done, 0), COALESCE(pp.wk_planned, 0),
         COALESCE(pd.pending, 0),
         COALESCE(sc.attempts, 0), sc.acc,
         COALESCE(h.assigned, 0) * COALESCE(r.n, 0), COALESCE(h.submitted, 0),
         a2.present, a2.total
    FROM prs p
    JOIN universal_subjects us0 ON us0.id = p.subject_id
    LEFT JOIN roster    r   ON r.class_id = p.class_id
    LEFT JOIN chaptot   ct  ON ct.class_group_id = p.class_group_id AND ct.subject_id = p.subject_id
    LEFT JOIN chapstate cs2 ON cs2.class_id = p.class_id AND cs2.subject_id = p.subject_id
    LEFT JOIN lessons   l   ON l.class_id = p.class_id AND l.subject_id = p.subject_id
    LEFT JOIN papers    pp  ON pp.class_id = p.class_id AND pp.subject_id = p.subject_id
    LEFT JOIN pend      pd  ON pd.class_id = p.class_id AND pd.subject_id = p.subject_id
    LEFT JOIN scores    sc  ON sc.class_id = p.class_id AND sc.subject_id = p.subject_id
    LEFT JOIN hw        h   ON h.class_id = p.class_id AND h.subject_id = p.subject_id
    LEFT JOIN att       a2  ON a2.class_id = p.class_id;
END
$function$;

/* ---------------------------------------------------------------- tree ---- */

CREATE OR REPLACE FUNCTION public.dash5_tree(
  p_level          text DEFAULT 'wings',   -- 'wings' | 'classes' | 'subjects'
  p_wing_id        uuid DEFAULT NULL,
  p_class_id       uuid DEFAULT NULL,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_monday date;
  v_ay_start date; v_ay_end date; v_out jsonb;
  v_level text := lower(COALESCE(p_level, 'wings'));
BEGIN
  IF v_level NOT IN ('wings','classes','subjects') THEN
    RAISE EXCEPTION 'dash5: unknown level %', p_level;
  END IF;

  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today  := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  v_monday := v_today - (extract(isodow FROM v_today)::int - 1);
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);

  -- A filter may only narrow, and only inside the caller's own institution.
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;
  IF p_wing_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM wings WHERE id = p_wing_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: wing not in institution';
  END IF;
  IF v_level = 'subjects' AND p_class_id IS NULL THEN
    RAISE EXCEPTION 'dash5: the subject level needs a class';
  END IF;

  -- MATERIALIZED so the atom is computed exactly once per request, whatever the
  -- planner would otherwise do with a set-returning function referenced twice.
  WITH a AS MATERIALIZED (
    SELECT * FROM public.dash5_atom_rows(v_inst) x
     WHERE (v_level = 'wings')
        OR (v_level = 'classes'  AND (p_wing_id IS NULL OR x.wing_id = p_wing_id))
        OR (v_level = 'subjects' AND x.class_id = p_class_id)
  ),
  -- Roster size and attendance are CLASS facts. Summing them per atom would
  -- multiply them by however many subjects the class happens to teach.
  pc AS (SELECT DISTINCT a.class_id, a.wing_id, a.students, a.att_present, a.att_total FROM a),
  wing_rows AS (
    SELECT wg.id, wg.name,
           COALESCE(k.class_count,0) class_count, COALESCE(k.students,0) students,
           COALESCE(g.subject_pairs,0) subject_pairs, COALESCE(g.subject_count,0) subject_count,
           CASE WHEN k.att_total > 0 THEN round(k.att_present*100.0/k.att_total,1) END att_pct,
           CASE WHEN g.chapters > 0
                THEN round((g.chapters_done*2+g.chapters_partial)*100.0/(g.chapters*2),1) END syl_pct,
           COALESCE(g.lessons_taught,0) lt, COALESCE(g.lessons_planned,0) lp,
           COALESCE(g.papers,0) papers, COALESCE(g.wk_done,0) wk_done, COALESCE(g.wk_planned,0) wk_planned,
           CASE WHEN g.acc_den > 0 THEN round(g.acc_num/g.acc_den,1) END accuracy,
           COALESCE(g.attempts,0) attempts,
           CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted*100.0/g.hw_slots,1) END hw_pct,
           (SELECT string_agg(COALESCE(pf.full_name, pf.email), ', ')
              FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = wg.id AND pf.is_active IS NOT FALSE) head
      FROM wings wg
      LEFT JOIN (
        SELECT a.wing_id,
               count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
               sum(a.chapters)::int chapters, sum(a.chapters_done)::int chapters_done,
               sum(a.chapters_partial)::int chapters_partial,
               sum(a.lessons_planned)::int lessons_planned, sum(a.lessons_taught)::int lessons_taught,
               sum(a.papers)::int papers, sum(a.wk_done)::int wk_done, sum(a.wk_planned)::int wk_planned,
               sum(a.attempts)::int attempts,
               sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) acc_num,
               sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) acc_den,
               sum(a.hw_slots)::int hw_slots, sum(a.hw_submitted)::int hw_submitted
          FROM a GROUP BY a.wing_id) g ON g.wing_id = wg.id
      LEFT JOIN (
        SELECT pc.wing_id, count(*)::int class_count, sum(pc.students)::int students,
               sum(pc.att_present)::int att_present, sum(pc.att_total)::int att_total
          FROM pc GROUP BY pc.wing_id) k ON k.wing_id = wg.id
     WHERE wg.institution_id = v_inst AND wg.is_active IS NOT FALSE
  ),
  class_rows AS (
    SELECT c.id, c.name || COALESCE(' ' || NULLIF(c.section,''), '') label,
           pc.students,
           g.subject_pairs, g.subject_count,
           CASE WHEN pc.att_total > 0 THEN round(pc.att_present*100.0/pc.att_total,1) END att_pct,
           CASE WHEN g.chapters > 0
                THEN round((g.chapters_done*2+g.chapters_partial)*100.0/(g.chapters*2),1) END syl_pct,
           g.lessons_taught lt, g.lessons_planned lp,
           g.papers, g.wk_done, g.wk_planned,
           CASE WHEN g.acc_den > 0 THEN round(g.acc_num/g.acc_den,1) END accuracy,
           g.attempts,
           CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted*100.0/g.hw_slots,1) END hw_pct,
           (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
              FROM class_assignments ca
              JOIN profiles pf ON pf.id = ca.user_id
             WHERE ca.class_id = c.id AND ca.role::text = 'teacher'
               AND ca.subject_id IS NULL) teacher
      FROM pc
      JOIN classes c ON c.id = pc.class_id
      JOIN (
        SELECT a.class_id,
               count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
               sum(a.chapters)::int chapters, sum(a.chapters_done)::int chapters_done,
               sum(a.chapters_partial)::int chapters_partial,
               sum(a.lessons_planned)::int lessons_planned, sum(a.lessons_taught)::int lessons_taught,
               sum(a.papers)::int papers, sum(a.wk_done)::int wk_done, sum(a.wk_planned)::int wk_planned,
               sum(a.attempts)::int attempts,
               sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) acc_num,
               sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) acc_den,
               sum(a.hw_slots)::int hw_slots, sum(a.hw_submitted)::int hw_submitted
          FROM a GROUP BY a.class_id) g ON g.class_id = pc.class_id
  ),
  subject_rows AS (
    SELECT a.subject_id id, us.name subject_name, a.students,
           a.chapters, a.chapters_done, a.chapters_partial, a.pending_grading,
           CASE WHEN a.att_total > 0 THEN round(a.att_present*100.0/a.att_total,1) END att_pct,
           CASE WHEN a.chapters > 0
                THEN round((a.chapters_done*2+a.chapters_partial)*100.0/(a.chapters*2),1) END syl_pct,
           a.lessons_taught lt, a.lessons_planned lp,
           a.papers, a.wk_done, a.wk_planned, a.attempts, round(a.acc,1) accuracy,
           CASE WHEN a.hw_slots > 0 THEN round(a.hw_submitted*100.0/a.hw_slots,1) END hw_pct,
           (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
              FROM class_assignments ca
              JOIN profiles pf ON pf.id = ca.user_id
             WHERE ca.class_id = a.class_id AND ca.subject_id = a.subject_id
               AND ca.role::text = 'teacher') teacher
      FROM a JOIN universal_subjects us ON us.id = a.subject_id
  ),
  tot AS (
    SELECT (SELECT count(*)::int FROM pc) class_count,
           (SELECT COALESCE(sum(pc.students),0)::int FROM pc) students,
           (SELECT COALESCE(sum(pc.att_present),0)::int FROM pc) att_present,
           (SELECT COALESCE(sum(pc.att_total),0)::int FROM pc) att_total,
           count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
           COALESCE(sum(a.chapters),0)::int chapters,
           COALESCE(sum(a.chapters_done),0)::int chapters_done,
           COALESCE(sum(a.chapters_partial),0)::int chapters_partial,
           COALESCE(sum(a.lessons_planned),0)::int lp, COALESCE(sum(a.lessons_taught),0)::int lt,
           COALESCE(sum(a.papers),0)::int papers, COALESCE(sum(a.wk_done),0)::int wk_done,
           COALESCE(sum(a.wk_planned),0)::int wk_planned,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) acc_num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) acc_den,
           COALESCE(sum(a.hw_slots),0)::int hw_slots, COALESCE(sum(a.hw_submitted),0)::int hw_submitted
      FROM a
  )
  SELECT jsonb_build_object(
    'level', v_level,
    'scope', jsonb_build_object(
      'week_start', v_monday, 'today', v_today,
      'ay_start', v_ay_start, 'ay_end', v_ay_end,
      'wing_id', p_wing_id,
      'wing_name', (SELECT w.name FROM wings w WHERE w.id = p_wing_id),
      'class_id', p_class_id,
      'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                        FROM classes c WHERE c.id = p_class_id)),
    'rows', CASE v_level
      WHEN 'wings' THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'sub', r.head,
          'class_count', r.class_count, 'students', r.students,
          'subject_pairs', r.subject_pairs, 'subject_count', r.subject_count,
          'attendance_pct', r.att_pct, 'syllabus_pct', r.syl_pct,
          'lessons_taught', r.lt, 'lessons_planned', r.lp,
          'papers', r.papers, 'wk_done', r.wk_done, 'wk_planned', r.wk_planned,
          'accuracy', r.accuracy, 'attempts', r.attempts, 'homework_pct', r.hw_pct,
          'composite', round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END),1),
          'band', public.dash5_band(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END))
        ) ORDER BY r.name), '[]'::jsonb) FROM wing_rows r)
      WHEN 'classes' THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.label, 'sub', r.teacher,
          'students', r.students,
          'subject_pairs', r.subject_pairs, 'subject_count', r.subject_count,
          'attendance_pct', r.att_pct, 'syllabus_pct', r.syl_pct,
          'lessons_taught', r.lt, 'lessons_planned', r.lp,
          'papers', r.papers, 'wk_done', r.wk_done, 'wk_planned', r.wk_planned,
          'accuracy', r.accuracy, 'attempts', r.attempts, 'homework_pct', r.hw_pct,
          'composite', round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END),1),
          'band', public.dash5_band(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END))
        ) ORDER BY r.label), '[]'::jsonb) FROM class_rows r)
      ELSE (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.subject_name, 'teacher', r.teacher,
          'students', r.students,
          'chapters', r.chapters, 'chapters_done', r.chapters_done,
          'chapters_partial', r.chapters_partial, 'pending_grading', r.pending_grading,
          'attendance_pct', r.att_pct, 'syllabus_pct', r.syl_pct,
          'lessons_taught', r.lt, 'lessons_planned', r.lp,
          'papers', r.papers, 'wk_done', r.wk_done, 'wk_planned', r.wk_planned,
          'accuracy', r.accuracy, 'attempts', r.attempts, 'homework_pct', r.hw_pct,
          -- A subject nobody has examined is "not assessed", never a zero.
          'composite', CASE WHEN r.accuracy IS NOT NULL THEN
             round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
               CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END),1) END,
          'band', CASE WHEN r.accuracy IS NOT NULL THEN
             public.dash5_band(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
               CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END)) END
        ) ORDER BY r.subject_name), '[]'::jsonb) FROM subject_rows r)
    END,
    'total', (SELECT jsonb_build_object(
      'class_count', t.class_count, 'students', t.students,
      'chapters', t.chapters, 'chapters_done', t.chapters_done,
      'chapters_partial', t.chapters_partial,
      'subject_pairs', t.subject_pairs, 'subject_count', t.subject_count,
      'attendance_pct', CASE WHEN t.att_total > 0 THEN round(t.att_present*100.0/t.att_total,1) END,
      'syllabus_pct',   CASE WHEN t.chapters > 0
         THEN round((t.chapters_done*2+t.chapters_partial)*100.0/(t.chapters*2),1) END,
      'lessons_taught', t.lt, 'lessons_planned', t.lp,
      'papers', t.papers, 'wk_done', t.wk_done, 'wk_planned', t.wk_planned,
      'accuracy', CASE WHEN t.acc_den > 0 THEN round(t.acc_num/t.acc_den,1) END,
      'homework_pct', CASE WHEN t.hw_slots > 0 THEN round(t.hw_submitted*100.0/t.hw_slots,1) END,
      'band', public.dash5_band(public.dash5_composite(
         CASE WHEN t.acc_den > 0 THEN t.acc_num/t.acc_den END,
         CASE WHEN t.chapters > 0 THEN (t.chapters_done*2+t.chapters_partial)*100.0/(t.chapters*2) END,
         CASE WHEN t.att_total > 0 THEN t.att_present*100.0/t.att_total END,
         CASE WHEN t.lp > 0 THEN t.lt*100.0/t.lp END))
    ) FROM tot t)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------ subject chapter drawer -- */

CREATE OR REPLACE FUNCTION public.dash5_subject_chapters(
  p_class_id uuid, p_subject_id uuid, p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_cg uuid; v_rows jsonb;
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

  RETURN jsonb_build_object(
    'class_id', p_class_id, 'subject_id', p_subject_id,
    'subject_name', (SELECT us.name FROM universal_subjects us WHERE us.id = p_subject_id),
    'class_label', (SELECT c.name || COALESCE(' ' || NULLIF(c.section,''), '')
                      FROM classes c WHERE c.id = p_class_id),
    'chapters', v_rows);
END
$function$;

/* ----------------------------------------------------------- privileges --- */
-- Supabase's default privileges grant EXECUTE to anon on every new function and
-- REVOKE FROM PUBLIC does not strip it, so both go by name (CLAUDE.md 26).
REVOKE EXECUTE ON FUNCTION public.dash5_composite(numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_band(numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_tree(text,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_subject_chapters(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash5_composite(numeric,numeric,numeric,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_band(numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_tree(text,uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dash5_subject_chapters(uuid,uuid,uuid) TO authenticated, service_role;

-- dash5_atom_rows trusts its institution argument, so NO client role may call
-- it. dash5_tree is SECURITY DEFINER and runs as the owner, so it still can.
REVOKE EXECUTE ON FUNCTION public.dash5_atom_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dash5_atom_rows(uuid) TO service_role;
