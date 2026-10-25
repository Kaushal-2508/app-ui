-- Admin dashboard accuracy pass, part 2: the shared atom, the school
-- performance tree, its "Papers conducted" column, the headline cards, the
-- subject drawer and the downloadable report.
-- Audit: docs/admin-dashboard-audit-2026-10-05.md (R1, R2, R4, R5, R7, R9,
-- R16 and the tree / card rows). Counting rules: 20261005160000.
--
-- dash5_atom_rows keeps its exact columns (one row per class x subject x
-- wing: a class in two wings appears under both, which is right for per-wing
-- views). What changed in it:
--   * R2/R4 attempts, acc and papers come from dash5_counted_results within
--     the academic year (published marks only, blank papers out), and a
--     result lands on the class's own subject by normalised name when the
--     exam used another grade's copy of the subject. Alliance had 499 Science
--     results dropped; Salci National 2,016 of 2,065.
--   * papers = distinct papers with counted results (was: status only, 685
--     of Alliance's 1,827 had no marks at all).
--   * R1 chapters_done / partial are no longer multiplied by the number of
--     wings a class sits in (Salci National showed 170% for one subject).
--     A chapter's state is its LATEST log: completed then corrected to
--     partial is partial.
--   * R5 lessons_planned = teaching lessons dated from the year start up to
--     today (future rows were counted); lessons_taught = those with a
--     syllabus_progress_events row for the same class, subject and day, the
--     evidence (status 'done' is a claim: 329 Alliance "done" rows had no
--     record, 420 "planned" rows did).
--   * R16 homework counts published (not draft) homework this year, and a
--     submission only for the class whose student made it.
--
-- dash5_tree: school totals count each class and each class x subject once
-- (Salci National footer said 305 students / 60 classes for 252 / 42); class,
-- wing and school averages use EVERY counted result of the class, even a
-- paper filed under a subject not mapped to the class; papers at class / wing
-- / school level are distinct papers; bands use the fair composite, and a row
-- with no students is "Not assessed"; wing chapter sums leave out classes with
-- no students. The class list without a wing filter no longer repeats a class
-- once per wing.
--
-- dash5_tree_targets (R9): with no teacher target, "Papers conducted" and
-- "Homework set" count what was set to the ROW's classes this year (papers
-- with published results; homework not in draft). They used to add up each
-- teacher's output across the whole school, so papers made by an admin never
-- counted (Salci National Junior Wing: 0 shown, 9 set) and Alliance Middle
-- showed 643 for 351.
--
-- dash_admin_roster_counts (R7): staff.count and staff_present are TEACHERS
-- only (Alliance 97 staff incl. 7 admins who never check in; the card read
-- 74/97 for 74/90). New keys for the students card: sections_with_students,
-- sections_marked, unmarked_students.
--
-- dash5_subject_chapters: chapter state is the latest log, chapters sorted by
-- their number, stats read one atom per class x subject (a class in two
-- wings made the scalar subqueries return two rows), and the class average
-- is the tree's class average.
--
-- dash5_report_core: school and class figures de-duplicated as in the tree.
-- Same signatures, owners and grants throughout.

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_atom_rows(p_inst uuid)
 RETURNS TABLE(class_id uuid, subject_id uuid, subject_key text, wing_id uuid, class_group_id uuid, students integer, chapters integer, chapters_done integer, chapters_partial integer, lessons_planned integer, lessons_taught integer, papers integer, wk_done integer, wk_planned integer, pending_grading integer, attempts integer, acc numeric, hw_slots integer, hw_submitted integer, att_present integer, att_total integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text; v_today date; v_monday date; v_ay_start date; v_ay_end date;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_tz     := COALESCE(v_tz, 'Asia/Kolkata');
  v_today  := (now() AT TIME ZONE v_tz)::date;
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
  -- One row per class x subject, whatever the wing count. Every per-pair fact
  -- is computed on this, then fanned out to the wing rows at the end.
  pairs AS (SELECT DISTINCT p.class_id, p.subject_id, p.class_group_id FROM prs p),
  psub AS (
    SELECT q.class_id, q.subject_id, initcap(lower(btrim(u.name))) AS skey
      FROM pairs q JOIN universal_subjects u ON u.id = q.subject_id
  ),
  roster AS (
    -- The one definition of a student. Never hand-count class_assignments.
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
      JOIN (SELECT DISTINCT cl.id FROM cls cl) k ON k.id = ca.class_id
     WHERE ca.role::text = 'student'
       AND ca.user_id IN (SELECT s.student_id FROM public.institution_student_ids(p_inst) s)
     GROUP BY 1
  ),
  cg_subj AS (SELECT DISTINCT p.class_group_id, p.subject_id FROM pairs p WHERE p.class_group_id IS NOT NULL),
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
  -- A chapter's state is its latest log.
  prog AS (
    SELECT e.class_id, e.subject_id, e.topic_id,
           (array_agg(e.action ORDER BY e.date DESC, e.created_at DESC))[1] AS last_action
      FROM syllabus_progress_events e
     WHERE e.institution_id = p_inst
     GROUP BY 1,2,3
  ),
  chapstate AS (
    SELECT p.class_id, p.subject_id,
           count(*) FILTER (WHERE pr.last_action = 'completed')::int done,
           count(*) FILTER (WHERE pr.last_action = 'partial')::int part
      FROM pairs p
      JOIN chapset cs ON cs.class_group_id = p.class_group_id AND cs.subject_id = p.subject_id
      LEFT JOIN prog pr ON pr.class_id = p.class_id AND pr.subject_id = p.subject_id
                       AND pr.topic_id = cs.chapter_id
     GROUP BY 1,2
  ),
  -- Days with syllabus evidence per class x subject: what makes a lesson taught.
  evd AS (
    SELECT DISTINCT e.class_id, e.subject_id, e.date
      FROM syllabus_progress_events e
     WHERE e.institution_id = p_inst
  ),
  lessons AS (
    SELECT lp.class_id, lp.subject_id,
           count(*)::int planned,
           count(ev.date)::int taught
      FROM tt_lesson_plans lp
      LEFT JOIN evd ev ON ev.class_id = lp.class_id AND ev.subject_id = lp.subject_id
                      AND ev.date = lp.date
     WHERE lp.institution_id = p_inst AND lp.session_type = 'teaching'
       AND lp.date BETWEEN v_ay_start AND v_today
     GROUP BY 1,2
  ),
  -- Counted results this year (published, not absent, blank papers out),
  -- each placed on the class's own subject: same id first, else same name.
  cr AS MATERIALIZED (
    SELECT c.result_id, c.exam_id, c.class_id, c.exam_subject_id, c.subject_key,
           c.percentage, c.exam_date
      FROM public.dash5_counted_results(p_inst) c
     WHERE c.exam_date BETWEEN v_ay_start AND v_ay_end
  ),
  -- The id-or-name match is resolved once per distinct (class, exam subject),
  -- then every result joins on plain equality: an OR join over every result
  -- defeated the hash join and cost about 5 s at Alliance.
  cmap AS (
    SELECT DISTINCT ON (k.class_id, k.exam_subject_id) k.class_id, k.exam_subject_id, ps.subject_id AS subj
      FROM (SELECT DISTINCT c.class_id, c.exam_subject_id, c.subject_key FROM cr c) k
      JOIN psub ps ON ps.class_id = k.class_id
                  AND (ps.subject_id = k.exam_subject_id OR ps.skey = k.subject_key)
     ORDER BY k.class_id, k.exam_subject_id, (ps.subject_id = k.exam_subject_id) DESC, ps.subject_id
  ),
  crm AS (
    SELECT c.exam_id, c.class_id, m.subj, c.percentage, c.exam_date
      FROM cr c
      JOIN cmap m ON m.class_id = c.class_id AND m.exam_subject_id = c.exam_subject_id
  ),
  scores AS (
    SELECT m.class_id, m.subj AS subject_id, count(*)::int attempts, avg(m.percentage) acc
      FROM crm m GROUP BY 1,2
  ),
  papers AS (
    SELECT m.class_id, m.subj AS subject_id,
           count(DISTINCT m.exam_id)::int papers,
           count(DISTINCT m.exam_id) FILTER (WHERE m.exam_date BETWEEN v_monday AND v_today)::int wk_done
      FROM crm m GROUP BY 1,2
  ),
  -- Papers the calendar put in this week for the class that have no counted
  -- result yet: the ones worth chasing.
  wkplan AS (
    SELECT ec.class_id, es.subject_id, count(DISTINCT e.id)::int n
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE e.institution_id = p_inst
       AND (e.scheduled_date AT TIME ZONE v_tz)::date BETWEEN v_monday AND v_today
       AND NOT EXISTS (SELECT 1 FROM cr c WHERE c.exam_id = e.id AND c.class_id = ec.class_id)
     GROUP BY 1,2
  ),
  -- A paper is outstanding while any of its results is still unpublished.
  unp AS MATERIALIZED (
    SELECT DISTINCT a.class_id, e.id AS eid, es.subject_id AS esid, initcap(lower(btrim(us.name))) AS skey
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
      JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = p_inst AND fr.is_published IS NOT TRUE
  ),
  umap AS (
    SELECT DISTINCT ON (u.class_id, u.esid) u.class_id, u.esid, ps.subject_id AS subj
      FROM (SELECT DISTINCT x.class_id, x.esid, x.skey FROM unp x) u
      JOIN psub ps ON ps.class_id = u.class_id AND (ps.subject_id = u.esid OR ps.skey = u.skey)
     ORDER BY u.class_id, u.esid, (ps.subject_id = u.esid) DESC, ps.subject_id
  ),
  pend AS (
    SELECT u.class_id, m.subj AS subject_id, count(DISTINCT u.eid)::int pending
      FROM unp u JOIN umap m ON m.class_id = u.class_id AND m.esid = u.esid
     GROUP BY 1,2
  ),
  hw AS (
    SELECT hc.class_id, hs.subject_id,
           count(DISTINCT h.id)::int assigned,
           count(DISTINCT sub.id)::int submitted
      FROM homework_assignments h
      JOIN homework_assignment_classes  hc ON hc.homework_assignment_id = h.id
      JOIN homework_assignment_subjects hs ON hs.homework_assignment_id = h.id
      LEFT JOIN homework_submissions sub
             ON sub.homework_assignment_id = h.id
            AND EXISTS (SELECT 1 FROM class_assignments ca
                         WHERE ca.class_id = hc.class_id AND ca.user_id = sub.student_id
                           AND ca.role::text = 'student')
     WHERE h.institution_id = p_inst
       AND h.status IS DISTINCT FROM 'draft'
       AND COALESCE(h.published_at, h.created_at) >= (v_ay_start::timestamp AT TIME ZONE v_tz)
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
         COALESCE(pp.papers, 0), COALESCE(pp.wk_done, 0),
         (COALESCE(pp.wk_done, 0) + COALESCE(wk.n, 0))::int,
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
    LEFT JOIN wkplan    wk  ON wk.class_id = p.class_id AND wk.subject_id = p.subject_id
    LEFT JOIN pend      pd  ON pd.class_id = p.class_id AND pd.subject_id = p.subject_id
    LEFT JOIN scores    sc  ON sc.class_id = p.class_id AND sc.subject_id = p.subject_id
    LEFT JOIN hw        h   ON h.class_id = p.class_id AND h.subject_id = p.subject_id
    LEFT JOIN att       a2  ON a2.class_id = p.class_id;
END
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_tree(p_level text DEFAULT 'wings'::text, p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_monday date;
  v_ay_start date; v_ay_end date; v_out jsonb; v_pace numeric;
  v_level text := lower(COALESCE(p_level, 'wings'));
BEGIN
  IF v_level NOT IN ('wings','classes','subjects') THEN
    RAISE EXCEPTION 'dash5: unknown level %', p_level;
  END IF;

  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today  := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  v_monday := v_today - (extract(isodow FROM v_today)::int - 1);
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_pace := public.dash5_year_pace(v_inst);

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

  -- MATERIALIZED so the atom is computed exactly once per request.
  WITH aw AS MATERIALIZED (
    SELECT * FROM public.dash5_atom_rows(v_inst) x
     WHERE (v_level = 'wings')
        OR (v_level = 'classes'  AND (p_wing_id IS NULL OR x.wing_id = p_wing_id))
        OR (v_level = 'subjects' AND x.class_id = p_class_id)
  ),
  -- The same atoms once per class x subject: a class in two wings is counted
  -- once in a class list, a subject list and every total.
  au AS (SELECT DISTINCT ON (x.class_id, x.subject_id) x.* FROM aw x ORDER BY x.class_id, x.subject_id, x.wing_id),
  -- Roster size and attendance are CLASS facts.
  pcw AS (SELECT DISTINCT x.class_id, x.wing_id, x.students, x.att_present, x.att_total FROM aw x),
  pcu AS (SELECT DISTINCT ON (x.class_id) x.class_id, x.students, x.att_present, x.att_total
            FROM pcw x ORDER BY x.class_id),
  -- Every counted result of a class in scope, whatever subject it was filed
  -- under: class, wing and school averages and paper counts come from here.
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
      FROM cres c JOIN pcw p ON p.class_id = c.class_id GROUP BY 1
  ),
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
           COALESCE(wa.papers,0) papers, COALESCE(g.wk_done,0) wk_done, COALESCE(g.wk_planned,0) wk_planned,
           CASE WHEN wa.n > 0 THEN round(wa.s/wa.n,1) END accuracy,
           COALESCE(wa.n,0) attempts,
           CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted*100.0/g.hw_slots,1) END hw_pct,
           (SELECT string_agg(COALESCE(pf.full_name, pf.email), ', ' ORDER BY COALESCE(pf.full_name, pf.email))
              FROM wing_assignments wa2
              JOIN profiles pf ON pf.id = wa2.user_id
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa2.wing_id = wg.id AND pf.is_active IS NOT FALSE) head
      FROM wings wg
      LEFT JOIN (
        SELECT a.wing_id,
               count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
               -- A class with no students cannot be behind on its syllabus.
               sum(a.chapters) FILTER (WHERE a.students > 0)::int chapters,
               sum(a.chapters_done) FILTER (WHERE a.students > 0)::int chapters_done,
               sum(a.chapters_partial) FILTER (WHERE a.students > 0)::int chapters_partial,
               sum(a.lessons_planned)::int lessons_planned, sum(a.lessons_taught)::int lessons_taught,
               sum(a.wk_done)::int wk_done, sum(a.wk_planned)::int wk_planned,
               sum(a.hw_slots)::int hw_slots, sum(a.hw_submitted)::int hw_submitted
          FROM aw a GROUP BY a.wing_id) g ON g.wing_id = wg.id
      LEFT JOIN (
        SELECT pc.wing_id, count(*)::int class_count, sum(pc.students)::int students,
               sum(pc.att_present)::int att_present, sum(pc.att_total)::int att_total
          FROM pcw pc GROUP BY pc.wing_id) k ON k.wing_id = wg.id
      LEFT JOIN wacc wa ON wa.wing_id = wg.id
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
           COALESCE(ca.papers,0) papers, g.wk_done, g.wk_planned,
           CASE WHEN ca.n > 0 THEN round(ca.s/ca.n,1) END accuracy,
           COALESCE(ca.n,0) attempts,
           CASE WHEN g.hw_slots > 0 THEN round(g.hw_submitted*100.0/g.hw_slots,1) END hw_pct,
           (SELECT string_agg(DISTINCT COALESCE(pf.full_name, pf.email), ', ')
              FROM class_assignments cas
              JOIN profiles pf ON pf.id = cas.user_id
             WHERE cas.class_id = c.id AND cas.role::text = 'teacher'
               AND cas.subject_id IS NULL) teacher
      FROM pcu pc
      JOIN classes c ON c.id = pc.class_id
      JOIN (
        SELECT a.class_id,
               count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
               sum(a.chapters)::int chapters, sum(a.chapters_done)::int chapters_done,
               sum(a.chapters_partial)::int chapters_partial,
               sum(a.lessons_planned)::int lessons_planned, sum(a.lessons_taught)::int lessons_taught,
               sum(a.wk_done)::int wk_done, sum(a.wk_planned)::int wk_planned,
               sum(a.hw_slots)::int hw_slots, sum(a.hw_submitted)::int hw_submitted
          FROM au a GROUP BY a.class_id) g ON g.class_id = pc.class_id
      LEFT JOIN cacc ca ON ca.class_id = pc.class_id
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
              FROM class_assignments cas
              JOIN profiles pf ON pf.id = cas.user_id
             WHERE cas.class_id = a.class_id AND cas.subject_id = a.subject_id
               AND cas.role::text = 'teacher') teacher
      FROM au a JOIN universal_subjects us ON us.id = a.subject_id
  ),
  tot AS (
    SELECT (SELECT count(*)::int FROM pcu) class_count,
           (SELECT COALESCE(sum(pcu.students),0)::int FROM pcu) students,
           (SELECT COALESCE(sum(pcu.att_present),0)::int FROM pcu) att_present,
           (SELECT COALESCE(sum(pcu.att_total),0)::int FROM pcu) att_total,
           count(*)::int subject_pairs, count(DISTINCT a.subject_key)::int subject_count,
           COALESCE(sum(a.chapters) FILTER (WHERE a.students > 0 OR v_level = 'subjects'),0)::int chapters,
           COALESCE(sum(a.chapters_done) FILTER (WHERE a.students > 0 OR v_level = 'subjects'),0)::int chapters_done,
           COALESCE(sum(a.chapters_partial) FILTER (WHERE a.students > 0 OR v_level = 'subjects'),0)::int chapters_partial,
           COALESCE(sum(a.lessons_planned),0)::int lp, COALESCE(sum(a.lessons_taught),0)::int lt,
           (SELECT count(DISTINCT cres.exam_id)::int FROM cres) papers,
           COALESCE(sum(a.wk_done),0)::int wk_done,
           COALESCE(sum(a.wk_planned),0)::int wk_planned,
           (SELECT sum(cres.percentage) FROM cres) acc_num,
           (SELECT count(*) FROM cres) acc_den,
           COALESCE(sum(a.hw_slots),0)::int hw_slots, COALESCE(sum(a.hw_submitted),0)::int hw_submitted
      FROM au a
  )
  SELECT jsonb_build_object(
    'level', v_level,
    'scope', jsonb_build_object(
      'week_start', v_monday, 'today', v_today,
      'ay_start', v_ay_start, 'ay_end', v_ay_end,
      'pace', v_pace,
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
          'composite', CASE WHEN r.students > 0 THEN round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END, v_pace),1) END,
          'band', CASE WHEN r.students > 0 THEN public.dash5_band_or_null(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END, v_pace)) END
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
          'composite', CASE WHEN r.students > 0 THEN round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END, v_pace),1) END,
          'band', CASE WHEN r.students > 0 THEN public.dash5_band_or_null(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
             CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END, v_pace)) END
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
          'composite', CASE WHEN r.accuracy IS NOT NULL AND r.students > 0 THEN
             round(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
               CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END, v_pace),1) END,
          'band', CASE WHEN r.accuracy IS NOT NULL AND r.students > 0 THEN
             public.dash5_band_or_null(public.dash5_composite(r.accuracy, r.syl_pct, r.att_pct,
               CASE WHEN r.lp > 0 THEN r.lt*100.0/r.lp END, v_pace)) END
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
      'attempts', t.acc_den,
      'homework_pct', CASE WHEN t.hw_slots > 0 THEN round(t.hw_submitted*100.0/t.hw_slots,1) END,
      'band', CASE WHEN t.students > 0 THEN public.dash5_band_or_null(public.dash5_composite(
         CASE WHEN t.acc_den > 0 THEN t.acc_num/t.acc_den END,
         CASE WHEN t.chapters > 0 THEN (t.chapters_done*2+t.chapters_partial)*100.0/(t.chapters*2) END,
         CASE WHEN t.att_total > 0 THEN t.att_present*100.0/t.att_total END,
         CASE WHEN t.lp > 0 THEN t.lt*100.0/t.lp END, v_pace)) END
    ) FROM tot t)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_tree_targets(p_level text DEFAULT 'wings'::text, p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_level text; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  v_level := CASE WHEN p_level IN ('wings','classes','subjects') THEN p_level ELSE 'wings' END;

  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  WITH
  -- Every live teacher target, with its current period resolved.
  tg AS (
    SELECT t.owner_id AS teacher_id, t.metric,
           (op->>'target_value')::int   AS target_value,
           (op->>'achieved_value')::int AS achieved_value,
           (op->>'period_start')::date  AS period_start,
           (op->>'period_end')::date    AS period_end
      FROM teacher_targets t
      CROSS JOIN LATERAL public.tgt_open_period(t.id) op
     WHERE t.institution_id = v_inst
       AND t.scope = 'teacher'
       AND t.status = 'active'
       AND op IS NOT NULL
  ),
  per_teacher AS MATERIALIZED (
    SELECT teacher_id, metric,
           sum(target_value)::int   AS target_value,
           sum(achieved_value)::int AS achieved_value,
           min(period_start)        AS period_start,
           max(period_end)          AS period_end
      FROM tg GROUP BY 1, 2
  ),
  -- The classes the level draws, with the row each belongs to.
  rc AS MATERIALIZED (
    SELECT DISTINCT
           CASE v_level WHEN 'wings' THEN m.wing_id ELSE c.id END AS row_id,
           c.id AS class_id
      FROM classes c
      LEFT JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
       AND (v_level <> 'classes'  OR p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (v_level <> 'subjects' OR c.id = p_class_id)
  ),
  -- Papers with published results this year, per row (subject rows: the
  -- class's own subject, matched by name like the tree).
  cres AS MATERIALIZED (
    SELECT c.exam_id, c.class_id, c.exam_subject_id, c.subject_key
      FROM public.dash5_counted_results(v_inst) c
     WHERE c.exam_date BETWEEN v_ay_start AND v_ay_end
       AND c.class_id IN (SELECT rc.class_id FROM rc)
  ),
  psub AS (
    SELECT scm.subject_id, initcap(lower(btrim(u.name))) skey
      FROM subject_class_mappings scm JOIN universal_subjects u ON u.id = scm.subject_id
     WHERE v_level = 'subjects' AND scm.class_id = p_class_id
  ),
  rp AS (
    SELECT x.row_id, count(DISTINCT x.exam_id)::int n FROM (
      SELECT rc.row_id, c.exam_id
        FROM cres c JOIN rc ON rc.class_id = c.class_id
       WHERE v_level <> 'subjects'
      UNION ALL
      SELECT ps.subject_id, c.exam_id
        FROM cres c
        JOIN psub ps ON ps.subject_id = c.exam_subject_id OR ps.skey = c.subject_key
       WHERE v_level = 'subjects'
    ) x WHERE x.row_id IS NOT NULL GROUP BY 1
  ),
  -- Homework set this year (not draft), per row.
  hwx AS MATERIALIZED (
    SELECT h.id, hc.class_id, hs.subject_id, initcap(lower(btrim(us.name))) skey
      FROM homework_assignments h
      JOIN homework_assignment_classes hc ON hc.homework_assignment_id = h.id
      LEFT JOIN homework_assignment_subjects hs ON hs.homework_assignment_id = h.id
      LEFT JOIN universal_subjects us ON us.id = hs.subject_id
     WHERE h.institution_id = v_inst
       AND h.status IS DISTINCT FROM 'draft'
       AND (COALESCE(h.published_at, h.created_at) AT TIME ZONE v_tz)::date BETWEEN v_ay_start AND v_today
       AND hc.class_id IN (SELECT rc.class_id FROM rc)
  ),
  rh AS (
    SELECT x.row_id, count(DISTINCT x.id)::int n FROM (
      SELECT rc.row_id, h.id
        FROM hwx h JOIN rc ON rc.class_id = h.class_id
       WHERE v_level <> 'subjects'
      UNION ALL
      SELECT ps.subject_id, h.id
        FROM hwx h
        JOIN psub ps ON ps.subject_id = h.subject_id OR ps.skey = h.skey
       WHERE v_level = 'subjects'
    ) x WHERE x.row_id IS NOT NULL GROUP BY 1
  ),
  -- Which targeted teachers belong to which row (only matters when targets exist).
  map AS MATERIALIZED (
    SELECT DISTINCT
           CASE v_level
             WHEN 'wings'    THEN m.wing_id
             WHEN 'classes'  THEN ca.class_id
             ELSE ca.subject_id
           END AS row_id,
           ca.user_id AS teacher_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id
                    AND c.institution_id = v_inst
                    AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ca.class_id
     WHERE ca.role::text = 'teacher'
       AND ca.user_id IN (SELECT pt.teacher_id FROM per_teacher pt)
       AND (v_level <> 'classes'  OR p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (v_level <> 'subjects' OR ca.class_id = p_class_id)
       AND (v_level <> 'subjects' OR ca.subject_id IS NOT NULL)
  ),
  tagg AS (
    SELECT map.row_id,
           sum(COALESCE(e.target_value, 0))::int   e_target,
           sum(COALESCE(e.achieved_value, 0))::int e_done,
           sum(COALESCE(h.target_value, 0))::int   h_target,
           sum(COALESCE(h.achieved_value, 0))::int h_done,
           count(*) FILTER (WHERE e.teacher_id IS NOT NULL)::int e_teachers,
           count(*) FILTER (WHERE h.teacher_id IS NOT NULL)::int h_teachers
      FROM map
      LEFT JOIN per_teacher e ON e.teacher_id = map.teacher_id AND e.metric = 'exams_published'
      LEFT JOIN per_teacher h ON h.teacher_id = map.teacher_id AND h.metric = 'homework_published'
     WHERE map.row_id IS NOT NULL
     GROUP BY 1
  ),
  tcount AS (
    SELECT CASE v_level WHEN 'wings' THEN m.wing_id WHEN 'classes' THEN ca.class_id ELSE ca.subject_id END row_id,
           count(DISTINCT ca.user_id)::int teachers
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ca.class_id
     WHERE ca.role::text = 'teacher'
       AND (v_level <> 'classes'  OR p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (v_level <> 'subjects' OR ca.class_id = p_class_id)
       AND (v_level <> 'subjects' OR ca.subject_id IS NOT NULL)
     GROUP BY 1
  ),
  keys AS (
    SELECT row_id FROM rp UNION SELECT row_id FROM rh
    UNION SELECT row_id FROM tagg UNION SELECT row_id FROM tcount WHERE row_id IS NOT NULL
  ),
  agg AS (
    SELECT k.row_id,
           COALESCE(t.e_target, 0) e_target,
           -- With a target, the target period's figure; without one, the
           -- papers set to this row this year.
           CASE WHEN COALESCE(t.e_target, 0) > 0 THEN t.e_done ELSE COALESCE(p.n, 0) END e_done,
           COALESCE(t.h_target, 0) h_target,
           CASE WHEN COALESCE(t.h_target, 0) > 0 THEN t.h_done ELSE COALESCE(h.n, 0) END h_done,
           COALESCE(t.e_teachers, 0) e_teachers, COALESCE(t.h_teachers, 0) h_teachers,
           COALESCE(p.n, 0) e_ytd, COALESCE(h.n, 0) h_ytd,
           COALESCE(tc.teachers, 0) teachers
      FROM keys k
      LEFT JOIN tagg t  ON t.row_id = k.row_id
      LEFT JOIN rp p    ON p.row_id = k.row_id
      LEFT JOIN rh h    ON h.row_id = k.row_id
      LEFT JOIN tcount tc ON tc.row_id = k.row_id
  ),
  tot AS (
    SELECT (SELECT COALESCE(sum(t.e_target), 0)::int FROM tagg t) e_target,
           (SELECT COALESCE(sum(t.h_target), 0)::int FROM tagg t) h_target,
           (SELECT count(DISTINCT c.exam_id)::int FROM cres c) e_ytd,
           (SELECT count(DISTINCT h.id)::int FROM hwx h) h_ytd,
           (SELECT count(*)::int FROM per_teacher pt WHERE pt.metric = 'exams_published') e_teachers,
           (SELECT count(*)::int FROM per_teacher pt WHERE pt.metric = 'homework_published') h_teachers,
           (SELECT COALESCE(sum(pt.achieved_value), 0)::int FROM per_teacher pt WHERE pt.metric = 'exams_published') e_tdone,
           (SELECT COALESCE(sum(pt.achieved_value), 0)::int FROM per_teacher pt WHERE pt.metric = 'homework_published') h_tdone,
           (SELECT count(DISTINCT ca.user_id)::int FROM class_assignments ca
              JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
             WHERE ca.role::text = 'teacher' AND ca.class_id IN (SELECT rc.class_id FROM rc)) teachers
  )
  SELECT jsonb_build_object(
    'level', v_level,
    'has_targets', (SELECT count(*) > 0 FROM per_teacher),
    'period', (SELECT jsonb_build_object('start', min(period_start), 'end', max(period_end))
                 FROM per_teacher),
    'rows', COALESCE((
      SELECT jsonb_object_agg(a.row_id::text, jsonb_build_object(
               'exams', jsonb_build_object('done', a.e_done, 'target', a.e_target,
                                           'ytd', a.e_ytd, 'teachers', a.e_teachers),
               'homework', jsonb_build_object('done', a.h_done, 'target', a.h_target,
                                              'ytd', a.h_ytd, 'teachers', a.h_teachers),
               'teachers', a.teachers))
        FROM agg a), '{}'::jsonb),
    'total', COALESCE((
      SELECT jsonb_build_object(
               'exams', jsonb_build_object('done', CASE WHEN t.e_target > 0 THEN t.e_tdone ELSE t.e_ytd END,
                                           'target', t.e_target, 'ytd', t.e_ytd, 'teachers', t.e_teachers),
               'homework', jsonb_build_object('done', CASE WHEN t.h_target > 0 THEN t.h_tdone ELSE t.h_ytd END,
                                              'target', t.h_target, 'ytd', t.h_ytd, 'teachers', t.h_teachers),
               'teachers', t.teachers)
        FROM tot t), '{}'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_admin_roster_counts(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_students int; v_students_new int;
  v_staff int; v_classes int; v_wings int;
  v_s_present int; v_s_total int; v_s_absent int; v_s_leave int; v_classes_marked int;
  v_t_present int; v_t_total int;
  v_sections int; v_sections_marked int; v_unmarked int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*) INTO v_students
    FROM public.institution_student_ids(v_inst);

  SELECT count(*) INTO v_students_new
    FROM public.institution_student_ids(v_inst) s
    JOIN public.profiles p ON p.id = s.student_id
   WHERE p.created_at >= (v_today - INTERVAL '30 days');

  -- Teachers of this school (the card reads "Teachers present today").
  -- Admins and coordinator-only accounts do not check in and used to sit in
  -- the denominator (Alliance 97 for 90 teachers).
  SELECT count(DISTINCT ur.user_id) INTO v_staff
    FROM user_roles ur
    JOIN profiles p ON p.id = ur.user_id
   WHERE ur.institution_id = v_inst AND ur.role::text = 'teacher'
     AND p.is_active IS NOT FALSE;

  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_wings
    FROM wings WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  -- One scan for the whole attendance headline: present, absent, on leave, the
  -- marked total, and how many classes have taken a register at all.
  SELECT count(*) FILTER (WHERE status IN ('present','late')),
         count(*),
         count(*) FILTER (WHERE status = 'absent'),
         count(*) FILTER (WHERE status = 'leave'),
         count(DISTINCT class_id)
    INTO v_s_present, v_s_total, v_s_absent, v_s_leave, v_classes_marked
    FROM attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  -- Sections that have students, how many of them took a register today, and
  -- the students sitting in sections not marked yet (not absent: unmarked).
  WITH st AS (
    SELECT ca.class_id, ca.user_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
     WHERE ca.role::text = 'student'
       AND ca.user_id IN (SELECT s.student_id FROM public.institution_student_ids(v_inst) s)
  ),
  marked AS (
    SELECT DISTINCT ar.class_id FROM attendance_records ar
     WHERE ar.institution_id = v_inst AND ar.date = v_today
  )
  SELECT count(DISTINCT st.class_id),
         count(DISTINCT st.class_id) FILTER (WHERE st.class_id IN (SELECT class_id FROM marked)),
         count(DISTINCT st.user_id) FILTER (WHERE st.class_id NOT IN (SELECT class_id FROM marked))
    INTO v_sections, v_sections_marked, v_unmarked
    FROM st;

  SELECT count(DISTINCT s.staff_id) FILTER (WHERE s.status IN ('present','late')),
         count(DISTINCT s.staff_id)
    INTO v_t_present, v_t_total
    FROM staff_attendance_records s
   WHERE s.institution_id = v_inst AND s.date = v_today
     AND EXISTS (SELECT 1 FROM user_roles ur
                  WHERE ur.user_id = s.staff_id AND ur.institution_id = v_inst
                    AND ur.role::text = 'teacher');

  RETURN jsonb_build_object(
    'students', jsonb_build_object('count', v_students, 'new_30d', v_students_new,
                                   'sections_with_students', v_sections,
                                   'sections_marked', v_sections_marked,
                                   'unmarked_students', v_unmarked),
    'staff',    jsonb_build_object('count', v_staff, 'role', 'teacher'),
    'classes',  jsonb_build_object('count', v_classes, 'wings', v_wings,
                                   'marked_today', v_classes_marked),
    'students_present', jsonb_build_object(
       'present', v_s_present, 'total', v_s_total, 'marked', v_s_total > 0,
       'absent', v_s_absent, 'on_leave', v_s_leave,
       'pct', CASE WHEN v_s_total > 0 THEN round(v_s_present*100.0/v_s_total, 1) END),
    'staff_present', jsonb_build_object(
       'present', v_t_present, 'total', v_t_total, 'marked', v_t_total > 0,
       'pct', CASE WHEN v_t_total > 0 THEN round(v_t_present*100.0/v_t_total, 1) END)
  );
END $function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash5_subject_chapters(p_class_id uuid, p_subject_id uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_cg uuid; v_rows jsonb; v_stats jsonb;
  v_ay_start date; v_ay_end date; v_today date;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, true);
  SELECT c.class_group_id INTO v_cg FROM classes c
   WHERE c.id = p_class_id AND c.institution_id = v_inst;
  IF NOT FOUND THEN RAISE EXCEPTION 'dash5: class not in institution'; END IF;
  v_today := (now() AT TIME ZONE COALESCE((SELECT timezone FROM institutions WHERE id = v_inst), 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);

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
  -- A chapter's state is its latest log (the atom uses the same rule).
  prog AS (
    SELECT e.topic_id,
           (array_agg(e.action ORDER BY e.date DESC, e.created_at DESC))[1] AS last_action,
           max(e.date) last_on
      FROM syllabus_progress_events e
     WHERE e.institution_id = v_inst AND e.class_id = p_class_id AND e.subject_id = p_subject_id
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'topic_id', c.id, 'name', c.topic_name, 'chapter_number', c.chapter_number,
           'state', CASE p.last_action WHEN 'completed' THEN 'done' WHEN 'partial' THEN 'partial' ELSE 'none' END,
           'last_logged_on', p.last_on
         ) ORDER BY COALESCE(c.display_order, 9999), c.chapter_number NULLS LAST,
                    (substring(c.topic_name FROM '\d{1,9}'))::int NULLS LAST, c.topic_name), '[]'::jsonb)
    INTO v_rows
    FROM chapset c LEFT JOIN prog p ON p.topic_id = c.id;

  -- The figures the drawer needs beside the chapter list: this subject's own
  -- performance and its class's average (the same class average the tree shows).
  WITH a AS MATERIALIZED (
    SELECT DISTINCT ON (x.subject_id) x.*
      FROM public.dash5_atom_rows(v_inst) x
     WHERE x.class_id = p_class_id
     ORDER BY x.subject_id, x.wing_id
  ),
  me AS (SELECT * FROM a WHERE a.subject_id = p_subject_id),
  cl AS (
    SELECT count(*)::int pairs,
           count(*) FILTER (WHERE a.papers > 0)::int assessed
      FROM a
  ),
  cacc AS (
    SELECT avg(c.percentage) acc
      FROM public.dash5_counted_results(v_inst) c
     WHERE c.class_id = p_class_id
       AND c.exam_date BETWEEN COALESCE(v_ay_start, v_today - 365) AND COALESCE(v_ay_end, v_today)
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
    'class_accuracy', (SELECT round(cacc.acc, 1) FROM cacc),
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
