-- Admin Dashboard v5: the elements the reference has that the build did not.
--
-- A read-through of public/report_reference/salci-admin-dashboard-v5.html against
-- the shipped page found six cards or parts of cards missing. Four of them need
-- data that no dash5_* function returned:
--
--   1. the band donut on Students          -> dash5_band_donut
--   2. the wing chips on the at-risk bar   -> dash5_students_at_risk gains by_wing
--   3. "Where those papers sit", four ways -> dash5_exam_pipeline splits held/calendar/draft
--   4. the School-wide needs card          -> dash5_school_wide_needs
--   5. the Communication section's 3 cards -> dash5_communication
--
-- Everything here is plain ASCII: prod SQL goes through scripts/run-sql.ps1 and
-- PowerShell 5.1 mangles non-ASCII in a request body.

/* --------------------------------------------------------- 1. band donut -- */

-- Students bucketed by the composite band their work sits in, with the wing
-- breakdown behind each slice so clicking one can say where it comes from.
-- Bands come from dash5_student_rows, the same atom the risk queue and the
-- student tree read, so the donut cannot disagree with either.
CREATE OR REPLACE FUNCTION public.dash5_band_donut(
  p_wing_id uuid DEFAULT NULL,
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

  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.dash5_student_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR x.wing_id = p_wing_id)
  ),
  b(band, ord) AS (VALUES ('att',1), ('watch',2), ('good',3), ('exc',4))
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM s),
    'wings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) ORDER BY w.name)
        FROM wings w
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb),
    'bands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'band', b.band,
               'n', (SELECT count(*)::int FROM s WHERE s.band = b.band),
               'pct', CASE WHEN (SELECT count(*) FROM s) > 0
                           THEN round((SELECT count(*) FROM s WHERE s.band = b.band)
                                      * 100.0 / (SELECT count(*) FROM s), 0) END,
               'by_wing', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                           'wing_id', w.id, 'wing_name', w.name,
                           'n', (SELECT count(*)::int FROM s
                                  WHERE s.band = b.band AND s.wing_id = w.id))
                         ORDER BY w.name)
                    FROM wings w
                   WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb))
             ORDER BY b.ord)
        FROM b), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------- 2. at risk, broken by wing --- */

CREATE OR REPLACE FUNCTION public.dash5_students_at_risk(
  p_wing_id uuid DEFAULT NULL, p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 50, p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_out jsonb; v_lim int := LEAST(GREATEST(COALESCE(p_limit,50),1), 200);
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH s AS MATERIALIZED (
    SELECT * FROM public.dash5_student_rows(v_inst) x
     WHERE x.at_risk
       AND (p_wing_id IS NULL OR x.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR x.class_id = p_class_id)
  ),
  ranked AS (
    -- Worst first. One number so the queue has a defensible order: marks weigh
    -- most, then attendance, then work handed in.
    SELECT s.*, (COALESCE(s.score,60)*0.5 + COALESCE(s.attendance_pct,100)*0.3
                 + COALESCE(s.homework_pct,0)*0.2) rank_score
      FROM s
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM ranked),
    -- The collapsed bar shows where the flagged students are BEFORE anyone
    -- opens the list, so the split has to count every one of them and not just
    -- the page of rows returned below.
    'by_wing', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'wing_id', w.id, 'wing_name', w.name,
               'n', (SELECT count(*)::int FROM ranked r WHERE r.wing_id = w.id))
             ORDER BY (SELECT count(*) FROM ranked r WHERE r.wing_id = w.id) DESC, w.name)
        FROM wings w
       WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), '[]'::jsonb),
    'unmapped', (SELECT count(*)::int FROM ranked WHERE ranked.wing_id IS NULL),
    'rows', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', r.student_id, 'name', r.full_name,
        'class_label', r.class_label, 'wing_id', r.wing_id,
        'score', r.score, 'attendance_pct', r.attendance_pct,
        'homework_pct', r.homework_pct, 'submission_pct', r.submission_pct,
        'band', r.band, 'never_in', r.never_in,
        'reasons', (
          SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
            SELECT 'marks below 60%' t WHERE COALESCE(r.score, 100) < 60
            UNION ALL SELECT 'attendance below 72%' WHERE COALESCE(r.attendance_pct, 100) < 72
            UNION ALL SELECT 'under half the homework in' WHERE COALESCE(r.homework_pct, 100) < 50
            UNION ALL SELECT 'never signed in' WHERE r.never_in) z)
      ) ORDER BY r.rank_score, r.full_name), '[]'::jsonb)
      FROM (SELECT * FROM ranked ORDER BY rank_score, full_name
             LIMIT v_lim OFFSET GREATEST(COALESCE(p_offset,0),0)) r)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------ 3. pipeline: where those papers actually sit */

-- The reference splits the plan four ways, not two: held with results out, held
-- with results still pending, on the calendar, and still a draft. The previous
-- version collapsed the first two into "held" and the last two into "drafted",
-- which hid the single most actionable number on the card, the papers that have
-- been sat but whose marks nobody has published.
CREATE OR REPLACE FUNCTION public.dash5_exam_pipeline(
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
  v_gone numeric; v_out jsonb; v_key text;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  v_gone := LEAST(GREATEST(
    (v_today - v_ay_start)::numeric / NULLIF((v_ay_end - v_ay_start)::numeric, 0), 0.08), 1.0);

  SELECT initcap(lower(btrim(us.name))) INTO v_key
    FROM universal_subjects us WHERE us.id = p_subject_id;

  WITH a AS MATERIALIZED (
    SELECT x.* FROM public.dash5_atom_rows(v_inst) x
     WHERE (p_wing_id IS NULL OR x.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR x.class_id = p_class_id)
       AND (v_key IS NULL OR x.subject_key = v_key)
  ),
  per_pair AS (
    SELECT a.class_id, a.subject_id, a.papers, a.pending_grading,
           CASE WHEN a.papers > 0
                THEN GREATEST(round(a.papers / v_gone)::int, a.papers)
                ELSE 1 END planned
      FROM a
  ),
  agg AS (
    SELECT COALESCE(sum(papers), 0)::int held,
           COALESCE(sum(planned), 0)::int planned,
           COALESCE(sum(pending_grading), 0)::int pending,
           count(*) FILTER (WHERE papers = 0)::int pairs_with_none,
           count(*)::int pairs
      FROM per_pair
  ),
  -- Every exam in scope, one row per exam, classified by where it sits. The
  -- DISTINCT matters: an exam covering four classes would otherwise be counted
  -- four times against a plan that counts it once.
  ex AS (
    SELECT DISTINCT e.id, e.status::text st
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
      JOIN classes c ON c.id = ec.class_id AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ec.class_id
      LEFT JOIN exam_subjects es ON es.exam_id = e.id
      LEFT JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = v_inst
       AND (p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (p_class_id IS NULL OR ec.class_id = p_class_id)
       AND (v_key IS NULL OR initcap(lower(btrim(us.name))) = v_key)
  ),
  split AS (
    SELECT count(*) FILTER (WHERE ex.st = 'draft')::int in_draft,
           -- "ready" and "active" are written and dated but not yet sat.
           count(*) FILTER (WHERE ex.st IN ('ready','active'))::int on_calendar
      FROM ex
  )
  SELECT jsonb_build_object(
    'year_elapsed_pct', round(v_gone * 100, 1),
    'held', g.held, 'planned', g.planned,
    'remaining', GREATEST(g.planned - g.held, 0),
    'pending_publication', g.pending,
    'pairs', g.pairs, 'pairs_with_no_paper', g.pairs_with_none,
    'on_pace', CASE WHEN g.planned > 0 THEN round(g.held * 100.0 / g.planned, 1) END,

    -- The four-way split the reference draws. results_out is a subtraction
    -- rather than its own count because "held" and "pending" come from the same
    -- atom and must add back up to it exactly.
    'held_results_out', GREATEST(g.held - g.pending, 0),
    'held_results_pending', LEAST(g.pending, g.held),
    'on_calendar', sp.on_calendar,
    'in_draft', sp.in_draft,
    -- What is left once everything above is accounted for: papers the pace
    -- implies that nobody has written yet, even as a draft.
    'not_written', GREATEST(g.planned - g.held - sp.on_calendar - sp.in_draft, 0),

    -- Kept for callers written against the previous shape.
    'drafted', sp.in_draft,
    'unscheduled', GREATEST(g.planned - g.held - sp.in_draft, 0)
  ) INTO v_out
  FROM agg g, split sp;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------- 4. school-wide needs ---- */

-- The reference's second Needs card: open items that belong to no single wing,
-- so they cannot appear in the by-wing list without being double counted.
-- Every item here is a real row in a real table; nothing is inferred.
CREATE OR REPLACE FUNCTION public.dash5_school_wide_needs(
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_proc int; v_proc_high int; v_issues int; v_issue_days int;
  v_leave int; v_leave_days int; v_staff_leave int; v_unpub int;
  v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*)::int, COALESCE(sum(ps.high_severity_events), 0)::int
    INTO v_proc, v_proc_high
    FROM proctoring_sessions ps
    JOIN student_exam_attempts a ON a.id = ps.attempt_id
    JOIN exams e ON e.id = a.exam_id
   WHERE e.institution_id = v_inst
     AND ps.requires_review IS TRUE
     AND COALESCE(ps.review_status, 'pending') = 'pending';

  SELECT count(*)::int,
         COALESCE(max((v_today - ri.created_at::date)), 0)::int
    INTO v_issues, v_issue_days
    FROM reported_issues ri
   WHERE ri.institution_id = v_inst
     AND ri.status::text NOT IN ('resolved', 'closed');

  SELECT count(*)::int, COALESCE(max((v_today - lr.created_at::date)), 0)::int
    INTO v_leave, v_leave_days
    FROM leave_requests lr
   WHERE lr.institution_id = v_inst AND lr.status::text = 'pending';

  SELECT count(*)::int INTO v_staff_leave
    FROM staff_leave_requests sl
   WHERE sl.institution_id = v_inst AND sl.status::text = 'pending';

  SELECT count(DISTINCT e.id)::int INTO v_unpub
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
   WHERE e.institution_id = v_inst AND fr.is_published IS NOT TRUE;

  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'severity', x.sev, 'title', x.t, 'detail', x.s,
               'cta', x.cta, 'goto', x.go) ORDER BY x.ord)
        FROM (
          SELECT 1 ord, 'High' sev,
                 v_proc || ' proctoring session' || CASE WHEN v_proc = 1 THEN '' ELSE 's' END
                   || ' flagged for review' t,
                 CASE WHEN v_proc_high > 0
                      THEN v_proc_high || ' high-severity events across them, such as tab switches or a second face in frame.'
                      ELSE 'Flagged by the proctor but not yet looked at.' END s,
                 'Review' cta, 'sec-academics' go
           WHERE v_proc > 0

          UNION ALL
          SELECT 2, CASE WHEN v_unpub > 6 THEN 'High' ELSE 'Medium' END,
                 v_unpub || ' paper' || CASE WHEN v_unpub = 1 THEN '' ELSE 's' END
                   || ' marked but not published',
                 'Students and parents cannot see these marks, and no report counts them.',
                 'Publish', 'sec-academics'
           WHERE v_unpub > 0

          UNION ALL
          SELECT 3, 'Medium',
                 v_issues || ' open platform issue' || CASE WHEN v_issues = 1 THEN '' ELSE 's' END,
                 CASE WHEN v_issue_days > 0
                      THEN 'Raised from inside the school. Oldest open ' || v_issue_days || ' days.'
                      ELSE 'Raised from inside the school, all opened today.' END,
                 'Triage', 'sec-needs'
           WHERE v_issues > 0

          UNION ALL
          SELECT 4, 'Medium',
                 v_leave || ' student leave request'
                   || CASE WHEN v_leave = 1 THEN '' ELSE 's' END || ' awaiting a decision',
                 CASE WHEN v_leave_days > 0
                      THEN 'Oldest submitted ' || v_leave_days || ' days ago. Until they are decided the register counts these students absent.'
                      ELSE 'All submitted today.' END,
                 'Approve', 'sec-attendance'
           WHERE v_leave > 0

          UNION ALL
          SELECT 5, 'Medium',
                 v_staff_leave || ' staff leave request'
                   || CASE WHEN v_staff_leave = 1 THEN '' ELSE 's' END || ' awaiting a decision',
                 'Each one approved without a substitution leaves a class unattended.',
                 'Approve', 'sec-teachers'
           WHERE v_staff_leave > 0
        ) x), '[]'::jsonb),
    'counts', jsonb_build_object(
      'proctoring', v_proc, 'issues', v_issues, 'student_leave', v_leave,
      'staff_leave', v_staff_leave, 'unpublished_papers', v_unpub)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* -------------------------------------------------- 5. communication ------- */

-- The reference's Communication page: circulars, meetings, and reach.
--
-- Its reach bars include push delivery and open rates. SALCI has NO outbound
-- channel switched on (CLAUDE.md 11: the external comms stack is dormant, keys
-- and all), so those two bars would be invented. This returns only what the
-- database can actually answer, and `channels_live` says the rest is off so the
-- card can explain the absence rather than draw a zero.
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
  p AS (
    SELECT ps.* FROM ptm_schedules ps
     WHERE ps.institution_id = v_inst
       AND ps.scheduled_date BETWEEN v_today AND v_today + 30
  ),
  bk AS (
    SELECT b.ptm_id, count(*)::int n,
           count(*) FILTER (WHERE b.status::text = 'cancelled')::int cancelled
      FROM ptm_bookings b JOIN p ON p.id = b.ptm_id
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'channels_live', false,
    'circulars', jsonb_build_object(
      'total', (SELECT count(*)::int FROM n),
      'requiring_ack', (SELECT count(*)::int FROM n WHERE n.requires_acknowledgement),
      'recipients', (SELECT COALESCE(sum(n.recipient_count), 0)::int FROM n),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'type', r.type::text,
                 'published_at', COALESCE(r.published_at, r.created_at),
                 'recipients', r.recipient_count,
                 'requires_ack', r.requires_acknowledgement)
               ORDER BY COALESCE(r.published_at, r.created_at) DESC)
          FROM (SELECT * FROM n
                 ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT 6) r), '[]'::jsonb)),
    'ptm', jsonb_build_object(
      'total', (SELECT count(*)::int FROM p),
      'bookings', (SELECT COALESCE(sum(bk.n), 0)::int FROM bk),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'date', r.scheduled_date,
                 'status', r.status::text,
                 'bookings', COALESCE((SELECT bk.n FROM bk WHERE bk.ptm_id = r.id), 0))
               ORDER BY r.scheduled_date)
          FROM (SELECT * FROM p ORDER BY p.scheduled_date LIMIT 6) r), '[]'::jsonb)),
    'reach', jsonb_build_array(
      jsonb_build_object('label', 'Circulars published', 'value', (SELECT count(*)::int FROM n),
                         'unit', 'count'),
      jsonb_build_object('label', 'Notice recipients reached',
                         'value', (SELECT COALESCE(sum(n.recipient_count), 0)::int FROM n),
                         'unit', 'count'),
      jsonb_build_object('label', 'Meetings in the next 30 days',
                         'value', (SELECT count(*)::int FROM p), 'unit', 'count'),
      jsonb_build_object('label', 'Parent slots booked',
                         'value', (SELECT COALESCE(sum(bk.n), 0)::int FROM bk), 'unit', 'count'))
  ) INTO v_out;

  RETURN v_out;
END
$function$;

/* ------------------------------------------------------------- grants ------ */

REVOKE EXECUTE ON FUNCTION public.dash5_band_donut(uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_band_donut(uuid,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_students_at_risk(uuid,uuid,int,int,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_students_at_risk(uuid,uuid,int,int,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_exam_pipeline(uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_exam_pipeline(uuid,uuid,uuid,uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_school_wide_needs(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_school_wide_needs(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.dash5_communication(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_communication(uuid) TO authenticated, service_role;
