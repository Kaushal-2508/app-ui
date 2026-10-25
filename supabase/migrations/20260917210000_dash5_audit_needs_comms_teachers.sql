-- Admin Dashboard v5, audit round 2: needs, communication and the coordinator
-- table.
--
-- Closes four more of the 87 audit differences:
--   1. the needs wingbar had no coordinator, no class count, no student count,
--      and its items had a jump target but no call-to-action label
--   2. needs_by_wing still measured coverage against a hardcoded 74% pace line,
--      which contradicts every other card on the page
--   3. the reach bars had no opened rate, no acknowledged rate, no PTM feedback
--      rate, and booked slots had no denominator
--   4. the coordinator row could not say how many of its teachers are quiet
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

/* ------------------------------------------------- 1 + 2. needs by wing --- */

CREATE OR REPLACE FUNCTION public.dash5_needs_by_wing(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_out jsonb; v_pace numeric;
  v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  -- Pace is the share of the year gone, not a fixed 74%. Every other card on
  -- this page already works that way; this one was the last holdout, and a
  -- school three weeks into the session was being told its classes were behind.
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;
  v_pace := round(LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0) * 100, 1);

  WITH a AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  s AS MATERIALIZED (SELECT * FROM public.dash5_student_rows(v_inst)),
  cls AS (
    SELECT a.class_id, a.wing_id,
           sum(a.chapters)::int ch, sum(a.chapters_done)::int done, sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den,
           count(*) FILTER (WHERE a.papers = 0)::int no_paper,
           sum(a.pending_grading)::int pending,
           max(a.students)::int students
      FROM a GROUP BY 1,2
  ),
  per_wing AS (
    SELECT w.id wing_id, w.name wing_name,
           count(*) FILTER (WHERE c.ch > 0
             AND (c.done*2 + c.part)*100.0/(c.ch*2) < v_pace)::int behind,
           count(*) FILTER (WHERE c.den > 0 AND c.num/c.den < 70)::int weak,
           COALESCE(sum(c.no_paper), 0)::int no_paper,
           COALESCE(sum(c.pending), 0)::int pending,
           count(c.class_id)::int classes,
           COALESCE(sum(c.students), 0)::int students,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id AND s.never_in) never_in,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id
              AND COALESCE(s.attendance_pct, 100) < 75) chronic,
           (SELECT count(*)::int FROM s WHERE s.wing_id = w.id AND s.at_risk) at_risk,
           (SELECT wa.user_id FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = w.id ORDER BY pf.full_name LIMIT 1) coord_id,
           (SELECT COALESCE(pf.full_name, pf.email) FROM wing_assignments wa
              JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
              JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
             WHERE wa.wing_id = w.id ORDER BY pf.full_name LIMIT 1) coord_name
      FROM wings w
      LEFT JOIN cls c ON c.wing_id = w.id
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
     GROUP BY w.id, w.name
  ),
  items AS (
    -- `cta` is the words on the link, `goto` is where it lands. They were the
    -- same field before, so every row read "Open" whatever it was about.
    SELECT p.wing_id, p.wing_name, i.sev, i.n,
           i.n || ' ' || i.title AS title, i.detail, i.cta, i.goto
      FROM per_wing p
      CROSS JOIN LATERAL (VALUES
        ('High',   p.behind,   'classes behind the pace line',
                   'Coverage is the leading indicator: a class behind now is a class revising in the exam week.',
                   'Open syllabus', 'academics'),
        ('High',   p.weak,     'classes averaging below 70%',
                   'Sustained across more than one cycle this is a teaching-support question, not a student-effort one.',
                   'Open performance', 'overview'),
        ('High',   p.chronic,  'students below the 75% attendance floor',
                   'Board eligibility risk.',
                   'Open absentees', 'attendance'),
        ('Medium', p.no_paper, 'subject-class pairs with no paper this year',
                   'Nothing to grade means nothing to measure. These are invisible in every score above.',
                   'Open exams', 'academics'),
        ('Medium', p.never_in, 'students have never signed in',
                   'Nothing they do is measured until they do.',
                   'Open adoption', 'students'),
        ('Medium', p.at_risk,  'students flagged as needing attention',
                   'Failing marks or heavy absence.',
                   'Open the list', 'students'),
        ('Medium', p.pending,  'papers written but not yet published',
                   'Results cannot reach parents until these close.',
                   'Open exams', 'academics')
      ) AS i(sev, n, title, detail, cta, goto)
     WHERE i.n > 0
  ),
  wing_json AS (
    SELECT p.*,
           (SELECT count(*)::int FROM items i WHERE i.wing_id = p.wing_id) cnt,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'severity', i.sev, 'title', i.title, 'detail', i.detail,
               'cta', i.cta, 'goto', i.goto)
               ORDER BY CASE i.sev WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, i.n DESC)
             FROM items i WHERE i.wing_id = p.wing_id), '[]'::jsonb) items
      FROM per_wing p
  )
  SELECT jsonb_build_object(
    'pace', v_pace,
    'total', (SELECT count(*)::int FROM items),
    'wings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'wing_id', w.wing_id, 'wing_name', w.wing_name,
        'coordinator_id', w.coord_id, 'coordinator', w.coord_name,
        'classes', w.classes, 'students', w.students,
        'high', (SELECT count(*)::int FROM items i
                  WHERE i.wing_id = w.wing_id AND i.sev = 'High'),
        'count', w.cnt, 'items', w.items) ORDER BY w.cnt DESC, w.wing_name)
      FROM wing_json w), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------- 3. communication reach - */

CREATE OR REPLACE FUNCTION public.dash5_communication(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  WITH n AS (
    SELECT nt.* FROM notices nt
     WHERE nt.institution_id = v_inst
       AND COALESCE(nt.published_at::date, nt.created_at::date) BETWEEN v_ay_start AND v_ay_end
  ),
  -- Opened and acknowledged are real columns on notice_recipients, so the
  -- reference's "Acknowledged" bar is answerable here after all; only the push
  -- channel is not.
  nr AS (
    SELECT count(*)::int total,
           count(*) FILTER (WHERE r.read_at IS NOT NULL)::int opened,
           count(*) FILTER (WHERE r.acknowledged_at IS NOT NULL)::int acked,
           count(*) FILTER (WHERE nq.requires_acknowledgement)::int ack_due
      FROM notice_recipients r JOIN n nq ON nq.id = r.notice_id
  ),
  p AS (
    SELECT ps.*,
           -- Slots offered: the window divided by the slot length. Without this
           -- denominator "146 booked" says nothing about whether the meeting
           -- filled up.
           CASE WHEN ps.start_time IS NOT NULL AND ps.end_time IS NOT NULL
                     AND COALESCE(ps.slot_duration_minutes, 0) > 0
                THEN GREATEST(floor(EXTRACT(EPOCH FROM (ps.end_time - ps.start_time)) / 60
                                    / ps.slot_duration_minutes)::int, 0) END slots
      FROM ptm_schedules ps
     WHERE ps.institution_id = v_inst
       AND ps.scheduled_date BETWEEN v_today AND v_today + 30
  ),
  bk AS (
    SELECT b.ptm_id, count(*)::int n,
           count(*) FILTER (WHERE b.feedback IS NOT NULL OR b.rating IS NOT NULL)::int fed
      FROM ptm_bookings b JOIN p ON p.id = b.ptm_id
     GROUP BY 1
  ),
  bt AS (
    SELECT COALESCE(sum(bk.n), 0)::int booked, COALESCE(sum(bk.fed), 0)::int fed FROM bk
  ),
  pt AS (SELECT COALESCE(sum(p.slots), 0)::int slots, count(*)::int meetings FROM p)
  SELECT jsonb_build_object(
    'channels_live', false,
    'circulars', jsonb_build_object(
      'total', (SELECT count(*)::int FROM n),
      'requiring_ack', (SELECT count(*)::int FROM n WHERE n.requires_acknowledgement),
      'recipients', (SELECT COALESCE(sum(n.recipient_count), 0)::int FROM n),
      'reached', (SELECT total FROM nr),
      'opened', (SELECT opened FROM nr),
      'acknowledged', (SELECT acked FROM nr),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'type', r.type::text,
                 'published_at', COALESCE(r.published_at, r.created_at),
                 'recipients', r.recipient_count,
                 'opened', (SELECT count(*)::int FROM notice_recipients x
                             WHERE x.notice_id = r.id AND x.read_at IS NOT NULL),
                 'requires_ack', r.requires_acknowledgement)
               ORDER BY COALESCE(r.published_at, r.created_at) DESC)
          FROM (SELECT * FROM n
                 ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT 6) r), '[]'::jsonb)),
    'ptm', jsonb_build_object(
      'total', (SELECT meetings FROM pt),
      'slots', (SELECT slots FROM pt),
      'bookings', (SELECT booked FROM bt),
      'feedback', (SELECT fed FROM bt),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'date', r.scheduled_date,
                 'status', r.status::text, 'slots', r.slots,
                 'bookings', COALESCE((SELECT bk.n FROM bk WHERE bk.ptm_id = r.id), 0))
               ORDER BY r.scheduled_date)
          FROM (SELECT * FROM p ORDER BY p.scheduled_date LIMIT 6) r), '[]'::jsonb)),

    -- `unit` tells the card whether a bar is a rate to draw against 100 or a
    -- count to scale against its neighbours. Mixing the two silently is how a
    -- 4-count bar ends up looking longer than an 88% one.
    'reach', jsonb_build_array(
      jsonb_build_object('label', 'Circulars published', 'unit', 'count',
                         'value', (SELECT count(*)::int FROM n)),
      jsonb_build_object('label', 'People the circulars reached', 'unit', 'count',
                         'value', (SELECT total FROM nr)),
      jsonb_build_object('label', 'Opened', 'unit', 'pct',
                         'value', (SELECT CASE WHEN total > 0
                                     THEN round(opened*100.0/total, 1) END FROM nr),
                         'of', (SELECT total FROM nr)),
      jsonb_build_object('label', 'Acknowledged', 'unit', 'pct',
                         'value', (SELECT CASE WHEN ack_due > 0
                                     THEN round(acked*100.0/ack_due, 1) END FROM nr),
                         'of', (SELECT ack_due FROM nr)),
      jsonb_build_object('label', 'Meetings in the next 30 days', 'unit', 'count',
                         'value', (SELECT meetings FROM pt)),
      jsonb_build_object('label', 'PTM slots booked', 'unit', 'pct',
                         'value', (SELECT CASE WHEN pt.slots > 0
                                     THEN round(bt.booked*100.0/pt.slots, 1) END
                                     FROM pt, bt),
                         'of', (SELECT slots FROM pt),
                         'n', (SELECT booked FROM bt)),
      jsonb_build_object('label', 'PTM feedback left', 'unit', 'pct',
                         'value', (SELECT CASE WHEN booked > 0
                                     THEN round(fed*100.0/booked, 1) END FROM bt),
                         'of', (SELECT booked FROM bt)))
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* --------------------------------------- 4. coordinators: who is quiet ---- */

CREATE OR REPLACE FUNCTION public.dash5_coordinators(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_out jsonb; v_act jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  -- Read the quiet-teacher count from dash5_teacher_activity rather than
  -- recomputing the "Minimal" rule here. Two copies of that rule would drift,
  -- and the two cards sit on the same screen.
  v_act := public.dash5_teacher_activity(NULL, p_institution_id);

  WITH atoms AS MATERIALIZED (SELECT * FROM public.dash5_atom_rows(v_inst)),
  pc AS (SELECT DISTINCT a.class_id, a.wing_id, a.students, a.att_present, a.att_total FROM atoms a),
  wagg AS (
    SELECT a.wing_id,
           sum(a.chapters)::int chapters, sum(a.chapters_done)::int done,
           sum(a.chapters_partial)::int part,
           sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL) num,
           sum(a.attempts)       FILTER (WHERE a.acc IS NOT NULL) den
      FROM atoms a GROUP BY a.wing_id
  ),
  wc AS (
    SELECT pc.wing_id, count(*)::int classes, sum(pc.students)::int students,
           sum(pc.att_present)::int ap, sum(pc.att_total)::int at2
      FROM pc GROUP BY pc.wing_id
  ),
  coord AS (
    SELECT wa.wing_id, wa.user_id uid, COALESCE(pf.full_name, pf.email) nm
      FROM wing_assignments wa
      JOIN profiles pf ON pf.id = wa.user_id AND pf.is_active IS NOT FALSE
      JOIN user_roles ur ON ur.user_id = pf.id AND ur.role::text = 'coordinator'
  ),
  staff_in_wing AS (
    SELECT m.wing_id, count(DISTINCT ca.user_id)::int n
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
      JOIN wing_class_mappings m ON m.class_id = c.id
     WHERE ca.role::text = 'teacher'
     GROUP BY 1
  ),
  quiet AS (
    SELECT (r->>'wing_id')::uuid wing_id, count(*)::int n
      FROM jsonb_array_elements(v_act->'rows') r
     WHERE r->>'level' = 'Minimal' AND r->>'wing_id' IS NOT NULL
     GROUP BY 1
  ),
  tsk AS (
    SELECT t.wing_id,
           count(*)::int total,
           count(*) FILTER (WHERE t.status::text = 'completed')::int closed,
           count(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date::date < v_today
                              AND t.status::text NOT IN ('completed','rejected'))::int overdue
      FROM tasks t
     WHERE t.institution_id = v_inst AND t.wing_id IS NOT NULL
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'wing_id', w.id, 'wing_name', w.name,
      'coordinator', (SELECT string_agg(c.nm, ', ') FROM coord c WHERE c.wing_id = w.id),
      'coordinator_id', (SELECT c.uid FROM coord c WHERE c.wing_id = w.id ORDER BY c.nm LIMIT 1),
      'classes', COALESCE(k.classes, 0),
      'students', COALESCE(k.students, 0),
      'teachers', COALESCE(sw.n, 0),
      'teachers_minimal', COALESCE(qt.n, 0),
      'avg_score', CASE WHEN g.den > 0 THEN round(g.num/g.den, 1) END,
      'coverage_pct', CASE WHEN g.chapters > 0
         THEN round((g.done*2 + g.part)*100.0/(g.chapters*2), 1) END,
      'attendance_pct', CASE WHEN k.at2 > 0 THEN round(k.ap*100.0/k.at2, 1) END,
      'tasks_closed', COALESCE(t.closed, 0), 'tasks_total', COALESCE(t.total, 0),
      'tasks_overdue', COALESCE(t.overdue, 0),
      'band', public.dash5_band(public.dash5_composite(
         CASE WHEN g.den > 0 THEN g.num/g.den END,
         CASE WHEN g.chapters > 0 THEN (g.done*2+g.part)*100.0/(g.chapters*2) END,
         CASE WHEN k.at2 > 0 THEN k.ap*100.0/k.at2 END,
         NULL))
    ) ORDER BY w.name), '[]'::jsonb)
  ) INTO v_out
  FROM wings w
  LEFT JOIN wagg g ON g.wing_id = w.id
  LEFT JOIN wc   k ON k.wing_id = w.id
  LEFT JOIN staff_in_wing sw ON sw.wing_id = w.id
  LEFT JOIN quiet qt ON qt.wing_id = w.id
  LEFT JOIN tsk  t ON t.wing_id = w.id
  WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------------------- grants ----- */

REVOKE EXECUTE ON FUNCTION public.dash5_needs_by_wing(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_needs_by_wing(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_communication(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_communication(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_coordinators(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coordinators(uuid) TO authenticated, service_role;
