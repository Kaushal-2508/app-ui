-- Teacher activity export: an accurate "Last Active", read server-side.
--
-- The Teachers page "Download Activity Log" built Last Active from
-- auth.users.last_sign_in_at plus seven client-side queries. Measured on prod
-- 2026-10-05 against the platform request logs (every API call carries the
-- caller's JWT) for Alliance International School, 90 teachers:
--   * 69 teachers were active by 10:30 IST; the export said 33.
--   * 42 of 90 status rows were wrong; 37 teachers' Last Active was more than
--     a day stale (median 5.7 days, worst 155 days for a daily user).
-- Cause 1: last_sign_in_at only moves when someone types a password. Sessions
-- last for months (PWA / Android app), so daily users kept a May date.
-- Cause 2: the seven sources skipped the work teachers do every day: Workday
-- check-in, student attendance, lesson and syllabus logs, homework, marks
-- entry, diary, and the trigger-written audit trail.
--
-- What is accurate (same measurement, last 8 IST days):
--   * auth.sessions refresh time matched the request logs' last-seen DAY for
--     81 of 81 teachers, and caught all 69 active today.
--   * Per-day presence from refresh-token mint times plus the action tables
--     matched 503 of 509 teacher-days (98.8%) with ZERO false positives.
-- auth.* is not readable by the browser, hence SECURITY DEFINER RPCs. This
-- also retires the export's call to admin-operations get_last_sign_in, which
-- made one serial auth call per teacher (perf-audit item) and refused
-- staff-manager-override holders, who can see the button.
--
-- Three functions:
--   _teacher_activity_events  internal; the one place the event sources live.
--   teacher_activity_summary  one row per teacher (Tab 1 of the workbook).
--   teacher_activity_log      the event log as jsonb (Tab 2), so PostgREST's
--                             1000-row cap cannot silently truncate it.
-- Read-only: nothing here writes. All times are compared in the
-- institution's own time zone (CLAUDE.md 24).

-- ---------------------------------------------------------------------------
-- Caller gate: the same people who see the button. Super admin; a school
-- admin of the school; a coordinator of the school (this page treats
-- coordinators as managing all teaching staff); a staff-manager override.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_teacher_activity_access(p_institution_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'No school selected' USING ERRCODE = '22023';
  END IF;
  IF public.is_super_admin(v_uid)
     OR public.is_institution_admin(v_uid, p_institution_id)
     OR EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = v_uid AND ur.role = 'coordinator'
                   AND ur.institution_id = p_institution_id)
     OR EXISTS (SELECT 1 FROM public.staff_manager_overrides o
                 WHERE o.user_id = v_uid AND o.institution_id = p_institution_id)
  THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'You do not have permission to view teacher activity'
    USING ERRCODE = '42501';
END;
$$;

-- ---------------------------------------------------------------------------
-- Every teacher action the export knows about, one row per logical action.
-- Bulk writes are collapsed (attendance per class per day, marks per exam
-- per day, questions per hour, diary per send) so "actions" counts read
-- naturally. A lesson log writes BOTH tt_lesson_plans and
-- syllabus_progress_events; it is taken from syllabus_progress_events only,
-- and tt_lesson_plans contributes plans, skips and period notes.
-- Trigger-audit actions that duplicate a dedicated source below are
-- excluded; the dedicated source is kept because it has history from before
-- the audit triggers existed (2026-09-14).
-- time_known = false marks a daily rollup with no time of day (AI usage).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._teacher_activity_events(
  p_teacher_ids uuid[],
  p_since       timestamptz,
  p_tz          text
)
RETURNS TABLE(teacher_id uuid, event_at timestamptz, time_known boolean,
              action text, entity_type text, entity_name text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT x.* FROM (
    SELECT e.created_by, e.created_at, true, 'Exam created', 'Exam', e.title
      FROM exams e
     WHERE e.created_by = ANY(p_teacher_ids) AND e.created_at >= p_since
    UNION ALL
    SELECT l.actor_id, l.created_at, true, 'Exam ' || replace(l.action, '_', ' '), 'Exam', e.title
      FROM exam_publication_logs l LEFT JOIN exams e ON e.id = l.exam_id
     WHERE l.actor_id = ANY(p_teacher_ids) AND l.created_at >= p_since
    UNION ALL
    -- one evaluation_blueprints row per subjective question
    SELECT b.created_by, max(b.created_at), true, 'Evaluation blueprint set', 'Exam',
           coalesce(e.title, 'Untitled exam')
             || CASE WHEN count(*) > 1 THEN ' (' || count(*) || ' questions)' ELSE '' END
      FROM evaluation_blueprints b LEFT JOIN exams e ON e.id = b.exam_id
     WHERE b.created_by = ANY(p_teacher_ids) AND b.created_at >= p_since
     GROUP BY b.created_by, b.exam_id, e.title
    UNION ALL
    SELECT l.actor_id, l.created_at, true, 'Task ' || replace(l.action, '_', ' '), 'Task', t.title
      FROM task_audit_logs l LEFT JOIN tasks t ON t.id = l.task_id
     WHERE l.actor_id = ANY(p_teacher_ids) AND l.created_at >= p_since
    UNION ALL
    SELECT m.created_by, m.created_at, true, 'Study material uploaded', 'Material', m.title
      FROM study_materials m
     WHERE m.created_by = ANY(p_teacher_ids) AND m.created_at >= p_since
    UNION ALL
    SELECT r.resolved_by, r.resolved_at, true, 'Recheck resolved', 'Recheck', r.status
      FROM recheck_requests r
     WHERE r.resolved_by = ANY(p_teacher_ids) AND r.resolved_at >= p_since
    UNION ALL
    SELECT a.user_id, (a.usage_date::timestamp AT TIME ZONE p_tz), false,
           'AI questions generated', 'AI',
           a.questions_generated || CASE WHEN a.questions_generated = 1 THEN ' question' ELSE ' questions' END
      FROM ai_daily_usage a
     WHERE a.user_id = ANY(p_teacher_ids) AND a.questions_generated > 0
       AND a.usage_date >= (p_since AT TIME ZONE p_tz)::date
    UNION ALL
    SELECT ar.marked_by, max(ar.updated_at), true, 'Student attendance marked', 'Attendance',
           trim(coalesce(c.name, 'Class') || ' ' || coalesce(c.section, ''))
             || ' · ' || to_char(ar.date, 'DD Mon YYYY') || ' (' || count(*) || ' students)'
      FROM attendance_records ar LEFT JOIN classes c ON c.id = ar.class_id
     WHERE ar.marked_by = ANY(p_teacher_ids) AND ar.updated_at >= p_since
     GROUP BY ar.marked_by, ar.class_id, ar.date, c.name, c.section
    UNION ALL
    SELECT s.staff_id, s.check_in_at, true, 'Checked in', 'Workday', NULL
      FROM staff_attendance_records s
     WHERE s.staff_id = ANY(p_teacher_ids) AND s.check_in_at >= p_since
    UNION ALL
    SELECT s.staff_id, s.check_out_at, true, 'Checked out', 'Workday', NULL
      FROM staff_attendance_records s
     WHERE s.staff_id = ANY(p_teacher_ids) AND s.check_out_at >= p_since
    UNION ALL
    SELECT sp.recorded_by, max(sp.created_at), true, 'Syllabus logged', 'Syllabus',
           trim(coalesce(c.name, 'Class') || ' ' || coalesce(c.section, ''))
             || ' · ' || to_char(sp.date, 'DD Mon YYYY')
             || CASE WHEN count(*) > 1 THEN ' (' || count(*) || ' topics)' ELSE '' END
      FROM syllabus_progress_events sp LEFT JOIN classes c ON c.id = sp.class_id
     WHERE sp.recorded_by = ANY(p_teacher_ids) AND sp.created_at >= p_since
     GROUP BY sp.recorded_by, sp.class_id, sp.date, date_trunc('minute', sp.created_at), c.name, c.section
    UNION ALL
    SELECT coalesce(lp.updated_by, lp.created_by), lp.updated_at, true,
           CASE WHEN lp.is_note_only THEN 'Period note saved'
                WHEN lp.status = 'skipped' THEN 'Period marked skipped'
                ELSE 'Lesson planned' END,
           'Lesson',
           trim(coalesce(c.name, 'Class') || ' ' || coalesce(c.section, ''))
             || ' · ' || to_char(lp.date, 'DD Mon YYYY')
      FROM tt_lesson_plans lp LEFT JOIN classes c ON c.id = lp.class_id
     WHERE coalesce(lp.updated_by, lp.created_by) = ANY(p_teacher_ids)
       AND lp.updated_at >= p_since
       AND (lp.is_note_only OR lp.status IN ('planned', 'skipped'))
    UNION ALL
    SELECT h.created_by, h.created_at, true, 'Homework created', 'Homework', h.title
      FROM homework_assignments h
     WHERE h.created_by = ANY(p_teacher_ids) AND h.created_at >= p_since
    UNION ALL
    SELECT h.evaluated_by, h.checked_at, true, 'Homework checked', 'Homework', h.title
      FROM homework_assignments h
     WHERE h.evaluated_by = ANY(p_teacher_ids) AND h.checked_at >= p_since
    UNION ALL
    SELECT hr.evaluated_by, max(hr.evaluated_at), true, 'Homework marked', 'Homework',
           coalesce(h.title, 'Homework') || ' (' || count(*) || ' students)'
      FROM homework_results hr LEFT JOIN homework_assignments h ON h.id = hr.homework_assignment_id
     WHERE hr.evaluated_by = ANY(p_teacher_ids) AND hr.evaluated_at >= p_since
     GROUP BY hr.evaluated_by, hr.homework_assignment_id, h.title, (hr.evaluated_at AT TIME ZONE p_tz)::date
    UNION ALL
    SELECT om.created_by, max(om.updated_at), true, 'Marks entered', 'Exam',
           coalesce(e.title, 'Exam') || ' (' || count(*) || ' students)'
      FROM offline_student_marks om LEFT JOIN exams e ON e.id = om.exam_id
     WHERE om.created_by = ANY(p_teacher_ids) AND om.updated_at >= p_since
     GROUP BY om.created_by, om.exam_id, e.title, (om.updated_at AT TIME ZONE p_tz)::date
    UNION ALL
    SELECT os.entered_by, max(os.updated_at), true, 'Marks entered', 'Exam',
           coalesce(e.title, 'Exam') || ' (' || count(DISTINCT os.attempt_id) || ' students)'
      FROM offline_section_marks os
      LEFT JOIN student_exam_attempts sa ON sa.id = os.attempt_id
      LEFT JOIN exams e ON e.id = sa.exam_id
     WHERE os.entered_by = ANY(p_teacher_ids) AND os.updated_at >= p_since
     GROUP BY os.entered_by, sa.exam_id, e.title, (os.updated_at AT TIME ZONE p_tz)::date
    UNION ALL
    SELECT o.evaluated_by, max(o.evaluated_at), true, 'Answers evaluated', 'Exam',
           count(*) || CASE WHEN count(*) = 1 THEN ' answer' ELSE ' answers' END
      FROM teacher_overrides o
     WHERE o.evaluated_by = ANY(p_teacher_ids) AND o.evaluated_at >= p_since
     GROUP BY o.evaluated_by, (o.evaluated_at AT TIME ZONE p_tz)::date
    UNION ALL
    SELECT q.created_by, max(q.created_at), true, 'Questions added to bank', 'Question',
           count(*) || CASE WHEN count(*) = 1 THEN ' question' ELSE ' questions' END
      FROM question_bank q
     WHERE q.created_by = ANY(p_teacher_ids) AND q.created_at >= p_since
     GROUP BY q.created_by, date_trunc('hour', q.created_at)
    UNION ALL
    SELECT d.created_by, max(d.created_at), true, 'Diary entry written', 'Diary',
           coalesce(d.title, 'Diary entry')
             || CASE WHEN count(*) > 1 THEN ' (' || count(*) || ' students)' ELSE '' END
      FROM diary_entries d
     WHERE d.created_by = ANY(p_teacher_ids) AND d.created_at >= p_since
     GROUP BY d.created_by, d.title, date_trunc('minute', d.created_at)
    UNION ALL
    SELECT n.published_by, n.created_at, true, 'Notice published', 'Notice', n.title
      FROM notices n
     WHERE n.published_by = ANY(p_teacher_ids) AND n.created_at >= p_since
    UNION ALL
    SELECT lr.user_id, lr.created_at, true, 'Leave applied', 'Leave', lr.leave_type
      FROM staff_leave_requests lr
     WHERE lr.user_id = ANY(p_teacher_ids) AND lr.created_at >= p_since
    UNION ALL
    SELECT al.actor_id, al.created_at, true,
           upper(left(al.action, 1)) || substr(replace(al.action, '_', ' '), 2),
           al.entity_type, al.entity_name
      FROM system_audit_logs al
     WHERE al.actor_id = ANY(p_teacher_ids) AND al.created_at >= p_since
       AND al.action NOT IN ('exam_created', 'study_material_created', 'homework_created',
                             'question_created', 'diary_entry_created', 'notice_created',
                             'syllabus_log_created', 'period_note_created', 'period_note_updated')
  ) AS x(teacher_id, event_at, time_known, action, entity_type, entity_name)
  WHERE x.teacher_id IS NOT NULL AND x.event_at <= now();
$$;

-- ---------------------------------------------------------------------------
-- Tab 1: one row per teacher of p_institution_id among p_teacher_ids.
-- Ids that are not teachers of that school are dropped, never reported.
--   last_seen_at     latest session refresh: moves whenever SALCI is open.
--   last_active_at   greatest of last_seen_at, last_sign_in_at, last action.
--   active_* / days_active_7d  school-local days with a refresh-token mint,
--                    a session refresh, a sign-in or an action.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_activity_summary(
  p_institution_id uuid,
  p_teacher_ids    uuid[],
  p_days           integer DEFAULT 30
)
RETURNS TABLE(
  teacher_id         uuid,
  last_active_at     timestamptz,
  last_seen_at       timestamptz,
  last_sign_in_at    timestamptz,
  last_action_at     timestamptz,
  last_action        text,
  last_action_detail text,
  active_today       boolean,
  active_yesterday   boolean,
  days_active_7d     integer,
  actions_today      integer,
  actions_7d         integer,
  actions_in_range   integer,
  local_today        date,
  time_zone          text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_days  integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_now   timestamptz := now();
  v_tz    text;
  v_today date;
  v_since timestamptz;
  v_week  timestamptz;
  v_ids   uuid[];
BEGIN
  PERFORM public._assert_teacher_activity_access(p_institution_id);
  IF coalesce(cardinality(p_teacher_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'Too many teachers in one export (max 1000)' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(i.timezone, 'Asia/Kolkata') INTO v_tz
    FROM public.institutions i WHERE i.id = p_institution_id;
  v_tz    := coalesce(v_tz, 'Asia/Kolkata');
  v_today := (v_now AT TIME ZONE v_tz)::date;
  v_week  := ((v_today - 7)::timestamp AT TIME ZONE v_tz);
  v_since := least(v_now - make_interval(days => v_days), v_week);

  SELECT array_agg(DISTINCT ur.user_id) INTO v_ids
    FROM public.user_roles ur
   WHERE ur.user_id = ANY(p_teacher_ids)
     AND ur.institution_id = p_institution_id
     AND ur.role = 'teacher';
  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH ev AS MATERIALIZED (
    SELECT * FROM public._teacher_activity_events(v_ids, v_since, v_tz)
  ),
  sess AS (
    SELECT s.user_id AS uid,
           max(greatest(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at)) AS seen
      FROM auth.sessions s
     WHERE s.user_id = ANY(v_ids)
     GROUP BY s.user_id
  ),
  tok AS (
    SELECT s.user_id AS uid, (r.created_at AT TIME ZONE v_tz)::date AS d, max(r.updated_at) AS seen
      FROM auth.sessions s
      JOIN auth.refresh_tokens r ON r.session_id = s.id
     WHERE s.user_id = ANY(v_ids) AND r.created_at >= v_week
     GROUP BY s.user_id, (r.created_at AT TIME ZONE v_tz)::date
  ),
  seen AS (
    SELECT u.uid, greatest(max(sess.seen), max(tok.seen)) AS seen
      FROM unnest(v_ids) AS u(uid)
      LEFT JOIN sess ON sess.uid = u.uid
      LEFT JOIN tok  ON tok.uid  = u.uid
     GROUP BY u.uid
  ),
  days AS (
    SELECT ev.teacher_id AS uid, (ev.event_at AT TIME ZONE v_tz)::date AS d FROM ev
    UNION
    SELECT tok.uid, tok.d FROM tok
    UNION
    SELECT seen.uid, (seen.seen AT TIME ZONE v_tz)::date FROM seen WHERE seen.seen IS NOT NULL
    UNION
    SELECT au.id, (au.last_sign_in_at AT TIME ZONE v_tz)::date
      FROM auth.users au WHERE au.id = ANY(v_ids) AND au.last_sign_in_at IS NOT NULL
  ),
  last_ev AS (
    SELECT DISTINCT ON (ev.teacher_id) ev.teacher_id, ev.event_at, ev.action, ev.entity_name
      FROM ev
     WHERE ev.time_known
     ORDER BY ev.teacher_id, ev.event_at DESC
  ),
  cnt AS (
    SELECT ev.teacher_id,
           count(*) FILTER (WHERE (ev.event_at AT TIME ZONE v_tz)::date = v_today) AS n_today,
           count(*) FILTER (WHERE (ev.event_at AT TIME ZONE v_tz)::date > v_today - 7) AS n_7d,
           count(*) FILTER (WHERE ev.event_at >= v_now - make_interval(days => v_days)) AS n_range
      FROM ev
     GROUP BY ev.teacher_id
  )
  SELECT u.uid,
         greatest(seen.seen, au.last_sign_in_at, le.event_at),
         seen.seen,
         au.last_sign_in_at,
         le.event_at,
         le.action,
         le.entity_name,
         EXISTS (SELECT 1 FROM days WHERE days.uid = u.uid AND days.d = v_today),
         EXISTS (SELECT 1 FROM days WHERE days.uid = u.uid AND days.d = v_today - 1),
         (SELECT count(DISTINCT days.d) FROM days
           WHERE days.uid = u.uid AND days.d > v_today - 7 AND days.d <= v_today)::integer,
         coalesce(cnt.n_today, 0)::integer,
         coalesce(cnt.n_7d, 0)::integer,
         coalesce(cnt.n_range, 0)::integer,
         v_today,
         v_tz
    FROM unnest(v_ids) AS u(uid)
    LEFT JOIN seen         ON seen.uid = u.uid
    LEFT JOIN auth.users au ON au.id = u.uid
    LEFT JOIN last_ev le   ON le.teacher_id = u.uid
    LEFT JOIN cnt          ON cnt.teacher_id = u.uid;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tab 2: the event log, newest first, as one jsonb document:
--   { total, returned, time_zone, events: [{teacher_id, at, time_known,
--     action, entity_type, entity_name}] }
-- Password sign-ins inside the range are included as "Signed in" rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_activity_log(
  p_institution_id uuid,
  p_teacher_ids    uuid[],
  p_days           integer DEFAULT 30,
  p_limit          integer DEFAULT 20000
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_days  integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_limit integer := greatest(1, least(50000, coalesce(p_limit, 20000)));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_tz    text;
  v_ids   uuid[];
  v_out   jsonb;
BEGIN
  PERFORM public._assert_teacher_activity_access(p_institution_id);
  IF coalesce(cardinality(p_teacher_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'Too many teachers in one export (max 1000)' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(i.timezone, 'Asia/Kolkata') INTO v_tz
    FROM public.institutions i WHERE i.id = p_institution_id;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  SELECT array_agg(DISTINCT ur.user_id) INTO v_ids
    FROM public.user_roles ur
   WHERE ur.user_id = ANY(p_teacher_ids)
     AND ur.institution_id = p_institution_id
     AND ur.role = 'teacher';
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'returned', 0, 'time_zone', v_tz, 'events', '[]'::jsonb);
  END IF;

  WITH ev AS MATERIALIZED (
    SELECT e.teacher_id, e.event_at, e.time_known, e.action, e.entity_type, e.entity_name
      FROM public._teacher_activity_events(v_ids, v_since, v_tz) e
    UNION ALL
    SELECT au.id, au.last_sign_in_at, true, 'Signed in', 'Login', NULL
      FROM auth.users au
     WHERE au.id = ANY(v_ids) AND au.last_sign_in_at >= v_since
  ),
  page AS (
    SELECT * FROM ev ORDER BY ev.event_at DESC, ev.teacher_id, ev.action LIMIT v_limit
  )
  SELECT jsonb_build_object(
           'total',     (SELECT count(*) FROM ev),
           'returned',  (SELECT count(*) FROM page),
           'time_zone', v_tz,
           'events', coalesce(
             (SELECT jsonb_agg(jsonb_build_object(
                       'teacher_id',  p.teacher_id,
                       'at',          p.event_at,
                       'time_known',  p.time_known,
                       'action',      p.action,
                       'entity_type', p.entity_type,
                       'entity_name', p.entity_name)
                     ORDER BY p.event_at DESC, p.teacher_id, p.action)
                FROM page p),
             '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants (CLAUDE.md 26: anon holds a default EXECUTE grant; REVOKE it by name)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._assert_teacher_activity_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._assert_teacher_activity_access(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._assert_teacher_activity_access(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public._teacher_activity_events(uuid[], timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._teacher_activity_events(uuid[], timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public._teacher_activity_events(uuid[], timestamptz, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.teacher_activity_summary(uuid, uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_activity_summary(uuid, uuid[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_activity_summary(uuid, uuid[], integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.teacher_activity_log(uuid, uuid[], integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_activity_log(uuid, uuid[], integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_activity_log(uuid, uuid[], integer, integer) TO authenticated, service_role;
