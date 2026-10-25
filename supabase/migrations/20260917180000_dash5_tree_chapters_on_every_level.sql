-- Admin Dashboard v5: chapter counts on the wing and class rows too.
--
-- dash5_tree emitted `chapters`, `chapters_done` and `chapters_partial` only on
-- SUBJECT rows. It has always computed them at every level (syllabus_pct is
-- derived from them), it just never handed the wing and class rows the numbers
-- underneath the percentage.
--
-- That made the Syllabus Coverage card print "no chapters loaded" against every
-- wing and every class of a school with 2,454 chapters, and it made the card's
-- "Chapters done / Partly done / Not started" metric switch draw an empty chart
-- at those two levels. Caught by a reconciliation check, not by reading it: the
-- wing row's chapters_done came back NULL where the class rollup said 227.
--
-- Rebuilt from the live definition with four insertions, so nothing else in this
-- 400-line function moved.

CREATE OR REPLACE FUNCTION public.dash5_tree(p_level text DEFAULT 'wings'::text, p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
           COALESCE(g.chapters,0) chapters, COALESCE(g.chapters_done,0) chapters_done,
           COALESCE(g.chapters_partial,0) chapters_partial,
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
           COALESCE(g.chapters,0) chapters, COALESCE(g.chapters_done,0) chapters_done,
           COALESCE(g.chapters_partial,0) chapters_partial,
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
          'chapters', r.chapters, 'chapters_done', r.chapters_done,
          'chapters_partial', r.chapters_partial,
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
          'chapters', r.chapters, 'chapters_done', r.chapters_done,
          'chapters_partial', r.chapters_partial,
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
$function$
;
