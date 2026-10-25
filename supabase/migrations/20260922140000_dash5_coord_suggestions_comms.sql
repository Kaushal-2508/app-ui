-- Coordinator Console, phase 4: task suggestions and the communication card.
--
-- Reference: public/report_reference/salci-coordinator-dashboard2.html
--   "Task suggestions by SALCI AI" and the Communication page.
--
-- WHY THE SUGGESTIONS ARE NOT dash5_task_suggestions WITH A WING FILTER. The
-- admin's suggestions are addressed to coordinators: "bring the four classes in
-- Middle Wing back to the pace line" lands on the wing's coordinator. Filtering
-- that list to one wing would hand a coordinator a to-do list addressed to
-- themselves. The reference is explicit about the rule this breaks: "every
-- assignee is a teacher in your wing, you cannot assign upward or sideways."
-- So these are generated fresh, one level down, and a suggestion with no
-- teacher to carry it is DROPPED rather than defaulted back to the coordinator.
--
-- Every suggestion is a draft. Nothing here writes a task; approving one goes
-- through create_task_group like every other task on the platform (CLAUDE.md 9a).
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

/* ----------------------------------------------------- task suggestions --- */

CREATE OR REPLACE FUNCTION public.dash5_coord_task_suggestions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_pace numeric;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  -- The share of the year gone, not a fixed 74%. A school three weeks into the
  -- session is not "behind" by any honest reading.
  v_pace := round(LEAST(GREATEST(
    (c.today - c.ay_start)::numeric / NULLIF((c.ay_end - c.ay_start)::numeric, 0), 0.08), 1.0) * 100, 1);

  WITH a AS MATERIALIZED (
    SELECT * FROM public.dash5_atom_rows(c.inst) z WHERE z.wing_id = c.wing
  ),
  -- The class teacher is the teacher row carrying no subject. Falling back to
  -- the class's busiest subject teacher keeps a class with no class teacher
  -- from dropping out of the list entirely.
  classteacher AS (
    SELECT DISTINCT ON (ca.class_id) ca.class_id, ca.user_id, p.full_name
      FROM class_assignments ca
      JOIN wing_class_mappings m ON m.class_id = ca.class_id AND m.wing_id = c.wing
      JOIN profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE
     WHERE ca.role::text = 'teacher'
     ORDER BY ca.class_id, (ca.subject_id IS NOT NULL), p.full_name
  ),
  subjteacher AS (
    SELECT DISTINCT ON (ca.class_id, ca.subject_id)
           ca.class_id, ca.subject_id, ca.user_id, p.full_name
      FROM class_assignments ca
      JOIN wing_class_mappings m ON m.class_id = ca.class_id AND m.wing_id = c.wing
      JOIN profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE
     WHERE ca.role::text = 'teacher' AND ca.subject_id IS NOT NULL
     ORDER BY ca.class_id, ca.subject_id, p.full_name
  ),
  cls AS (
    SELECT a.class_id,
           cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '') label,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done,
           sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           sum(a.pending_grading)::int pending
      FROM a JOIN classes cl ON cl.id = a.class_id
     GROUP BY 1, 2
  ),
  scored AS (
    SELECT cls.*,
           CASE WHEN den > 0 THEN num/den END acc,
           CASE WHEN ch > 0 THEN (done*2 + part)*100.0/(ch*2) END cov
      FROM cls
  ),
  raw AS (
    -- 1. the weakest class in the wing
    -- Priorities follow tasks.priority, where 1 is High and 3 is Low, the
    -- same scale create_task_group and PriorityPill use. Getting this the
    -- wrong way round would have every suggestion arrive marked Low.
    (SELECT 'weakest_class'::text code, 1 priority, 'academic_content'::text ttype, 3 due_days,
            'Remedial plan for ' || s.label title,
            round(s.acc)::text || '% average, ' || round(COALESCE(s.cov, 0))::text
              || '% syllabus coverage. Lowest in your wing.' detail,
            ct.user_id assignee, ct.full_name assignee_name, s.class_id ref_class
       FROM scored s JOIN classteacher ct ON ct.class_id = s.class_id
      WHERE s.acc IS NOT NULL ORDER BY s.acc LIMIT 1)

    UNION ALL
    -- 2. the class furthest behind the pace line
    (SELECT 'behind_pace', 1, 'academic_content', 7,
            s.label || ' is ' || round(v_pace - s.cov)::text || ' points behind the pace line',
            'Coverage ' || round(s.cov)::text || '% against ' || v_pace::text
              || '% of the year gone. A class behind now is a class revising in the exam week.',
            ct.user_id, ct.full_name, s.class_id
       FROM scored s JOIN classteacher ct ON ct.class_id = s.class_id
      WHERE s.cov IS NOT NULL AND s.cov < v_pace
      ORDER BY (v_pace - s.cov) DESC LIMIT 1)

    UNION ALL
    -- 3. the subject in the wing with no paper at all this year
    (SELECT 'no_paper', 2, 'exam_related', 10,
            'No paper has been held in ' || us.name || ' for ' || cl2.name
              || COALESCE(' ' || NULLIF(cl2.section, ''), ''),
            'Nothing to mark means nothing to measure: this subject contributes no score to '
              || 'any figure on your dashboard.',
            st.user_id, st.full_name, a2.class_id
       FROM a a2
       JOIN classes cl2 ON cl2.id = a2.class_id
       JOIN universal_subjects us ON us.id = a2.subject_id
       JOIN subjteacher st ON st.class_id = a2.class_id AND st.subject_id = a2.subject_id
      WHERE a2.papers = 0
      ORDER BY cl2.name, us.name LIMIT 1)

    UNION ALL
    -- 4. papers held but never graded
    (SELECT 'ungraded', 1, 'exam_related', 2,
            s.pending::text || ' paper' || CASE WHEN s.pending = 1 THEN '' ELSE 's' END
              || ' held in ' || s.label || ' but not graded',
            'Results cannot be published until these close, and the class average above '
              || 'excludes every one of them.',
            ct.user_id, ct.full_name, s.class_id
       FROM scored s JOIN classteacher ct ON ct.class_id = s.class_id
      WHERE s.pending > 0 ORDER BY s.pending DESC LIMIT 1)
  ),
  -- 5. the biggest lesson-logging backlog, read from the same function the
  --    backlog card uses so the two can never quote different numbers.
  backlog AS (
    SELECT (e->>'teacher_id')::uuid assignee, e->>'name' assignee_name,
           (e->>'periods')::int n
      FROM jsonb_array_elements(public.dash5_coord_log_backlog()->'rows') e
     ORDER BY (e->>'periods')::int DESC LIMIT 1
  ),
  raw2 AS (
    SELECT * FROM raw
    UNION ALL
    SELECT 'log_backlog', 1, 'administrative', 1,
           'Log ' || b.n::text || ' outstanding period' || CASE WHEN b.n = 1 THEN '' ELSE 's' END
             || ' from this week',
           'Every unlogged period makes your syllabus coverage read lower than it is. '
             || 'This is the cheapest correction available to you.',
           b.assignee, b.assignee_name, NULL::uuid
      FROM backlog b
     WHERE b.assignee IS NOT NULL
  )
  SELECT jsonb_build_object(
    'pace', v_pace,
    'total', (SELECT count(*)::int FROM raw2 WHERE assignee IS NOT NULL),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'code', r.code, 'title', r.title, 'detail', r.detail,
        'priority', r.priority, 'task_type', r.ttype,
        'due_days', r.due_days, 'due_date', (c.today + r.due_days),
        'assignee_id', r.assignee, 'assignee', r.assignee_name,
        'class_id', r.ref_class)
      ORDER BY r.priority, r.due_days)
      FROM raw2 r WHERE r.assignee IS NOT NULL), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_task_suggestions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_task_suggestions() TO authenticated, service_role;

/* ------------------------------------------------------- communication ---- */

-- The hand-off card, matching what the admin console settled on: /school/
-- communication already owns notices, the diary, PTM and messages in full, and
-- a slice of it repeated here was a second place to keep in step. What this
-- returns is the headline figures for THIS WING, so the row says whether it is
-- worth the click.
--
-- A notice reaches this wing three ways: it was published school-wide, it was
-- targeted at the wing, or it was targeted at one of the wing's classes.
CREATE OR REPLACE FUNCTION public.dash5_coord_communication()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  WITH mycls AS (
    SELECT m.class_id FROM wing_class_mappings m WHERE m.wing_id = c.wing
  ),
  mine AS (
    SELECT n.id, n.title, n.published_at, n.scope, n.priority,
           n.requires_acknowledgement
      FROM notices n
     WHERE n.institution_id = c.inst
       AND n.published_at >= c.ay_start
       AND (n.scope = 'institution'
            OR EXISTS (SELECT 1 FROM notice_target_wings tw
                        WHERE tw.notice_id = n.id AND tw.wing_id = c.wing)
            OR EXISTS (SELECT 1 FROM notice_target_classes tc
                        JOIN mycls ON mycls.class_id = tc.class_id
                       WHERE tc.notice_id = n.id))
  ),
  -- Reach is counted over recipients who are in THIS wing, so a school-wide
  -- circular reports the share of your people who opened it, not the school's.
  reach AS (
    SELECT count(*)::int sent,
           count(*) FILTER (WHERE nr.read_at IS NOT NULL)::int opened,
           count(*) FILTER (WHERE nr.acknowledged_at IS NOT NULL)::int acked
      FROM notice_recipients nr
      JOIN mine ON mine.id = nr.notice_id
     WHERE EXISTS (
       SELECT 1 FROM class_assignments ca
        JOIN mycls ON mycls.class_id = ca.class_id
       WHERE ca.user_id = nr.user_id)
  ),
  ptm AS (
    SELECT count(DISTINCT ps.id)::int total,
           count(DISTINCT b.id)::int bookings
      FROM ptm_schedules ps
      LEFT JOIN ptm_schedule_classes psc ON psc.ptm_id = ps.id
      LEFT JOIN ptm_bookings b ON b.ptm_id = ps.id
     WHERE ps.institution_id = c.inst
       AND ps.scheduled_date BETWEEN c.today AND (c.today + 30)
       AND (ps.class_id IN (SELECT class_id FROM mycls)
            OR psc.class_id IN (SELECT class_id FROM mycls))
  )
  SELECT jsonb_build_object(
    'notices', jsonb_build_object(
      'total', (SELECT count(*)::int FROM mine),
      'sent',   COALESCE((SELECT sent FROM reach), 0),
      'opened', COALESCE((SELECT opened FROM reach), 0),
      'acknowledged', COALESCE((SELECT acked FROM reach), 0),
      'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', z.id, 'title', z.title, 'published_at', z.published_at,
          'scope', z.scope, 'priority', z.priority) ORDER BY z.published_at DESC)
        FROM (SELECT * FROM mine ORDER BY published_at DESC LIMIT 5) z), '[]'::jsonb)),
    'ptm', jsonb_build_object(
      'total',    COALESCE((SELECT total FROM ptm), 0),
      'bookings', COALESCE((SELECT bookings FROM ptm), 0))
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_communication() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_communication() TO authenticated, service_role;
