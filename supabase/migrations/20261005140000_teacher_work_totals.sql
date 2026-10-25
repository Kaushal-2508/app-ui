-- Teacher activity export, part 2: per-teacher work totals for the chosen range.
--
-- Tushar 2026-10-05: the Download Activity Log workbook gets one tab per area
-- of work (exams, homework, attendance, lessons, workday, tasks and other),
-- each counting what every teacher did in the range the admin picked (7, 30,
-- 60 or 90 days). Counted server-side (CLAUDE.md 23), one row per teacher.
--
-- Range = school-local calendar days: today and the (p_days - 1) days before
-- it, in institutions.timezone (CLAUDE.md 24). teacher_activity_log is
-- redefined below to use the same start, so a tab's total and the log's rows
-- for the same range always agree. (It was now() - p_days.)
--
-- Every count is "work this teacher did inside the range":
--   exams_created          exams.created_by, created_at in range
--   exams_published        distinct exams the teacher published (exam_publication_logs)
--   exams_marked           distinct exams with offline marks entered by the teacher
--   student_marks_entered  distinct (exam, student) marks entered by the teacher
--                          (offline_student_marks.created_by + offline_section_marks.entered_by)
--   answers_evaluated      teacher_overrides.evaluated_by
--   questions_ai           question_bank.created_by with source 'ai_generated'
--   questions_manual       question_bank.created_by, any other source
--                          (ai_daily_usage is EMPTY on prod, nothing writes it, so it
--                          cannot count AI use; the bank's source column can)
--   homework_given         homework_assignments.created_by, drafts excluded
--   homework_checked       homework_assignments.evaluated_by, checked_at in range
--   submissions_marked     homework_results.evaluated_by, evaluated_at in range
--   attendance_class_days  distinct (class, date) whose student attendance the teacher
--                          marked, attendance date in range (marked_by = last marker)
--   attendance_students    attendance rows marked by the teacher, date in range
--   lessons_logged         distinct (class, subject, date) in syllabus_progress_events
--                          recorded by the teacher (the syllabus log is the evidence of
--                          teaching, never tt_lesson_plans.status)
--   topics_logged          syllabus_progress_events rows recorded by the teacher
--   period_notes           note-only tt_lesson_plans created by the teacher
--   (no "lessons planned": tt_lesson_plans.planned_at is stamped on EVERY row, a
--   lesson logged directly included, so it cannot tell a plan from a log; on
--   prod 1,914 of 3,290 rows in 30 days were never planned ahead)
--   workday_checked_in / _checked_out / _late   staff_attendance_records, date in range
--   leave_requests         staff_leave_requests applied
--   tasks_assigned         distinct task instructions created (a fan-out to N people
--                          counts once, via tasks.task_group_id)
--   tasks_submitted / tasks_approved   distinct tasks (task_audit_logs)
--   diary_notes_sent       distinct diary sends (one note to N students counts once)
--   study_material_uploaded, notices_published
-- Deleted rows (an exam deleted later, say) are not counted.

-- Dropped first only because an earlier draft of this same migration had a
-- different column list; nothing called it.
DROP FUNCTION IF EXISTS public.teacher_work_totals(uuid, uuid[], integer);

CREATE FUNCTION public.teacher_work_totals(
  p_institution_id uuid,
  p_teacher_ids    uuid[],
  p_days           integer DEFAULT 30
)
RETURNS TABLE(
  teacher_id              uuid,
  range_start             date,
  range_end               date,
  exams_created           integer,
  exams_published         integer,
  exams_marked            integer,
  student_marks_entered   integer,
  answers_evaluated       integer,
  questions_ai            integer,
  questions_manual        integer,
  homework_given          integer,
  homework_checked        integer,
  submissions_marked      integer,
  attendance_class_days   integer,
  attendance_students     integer,
  lessons_logged          integer,
  topics_logged           integer,
  period_notes            integer,
  workday_checked_in      integer,
  workday_checked_out     integer,
  workday_late            integer,
  leave_requests          integer,
  tasks_assigned          integer,
  tasks_submitted         integer,
  tasks_approved          integer,
  diary_notes_sent        integer,
  study_material_uploaded integer,
  notices_published       integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_days  integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_tz    text;
  v_today date;
  v_d0    date;
  v_t0    timestamptz;
  v_ids   uuid[];
BEGIN
  PERFORM public._assert_teacher_activity_access(p_institution_id);
  IF coalesce(cardinality(p_teacher_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'Too many teachers in one export (max 1000)' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(i.timezone, 'Asia/Kolkata') INTO v_tz
    FROM public.institutions i WHERE i.id = p_institution_id;
  v_tz    := coalesce(v_tz, 'Asia/Kolkata');
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_d0    := v_today - (v_days - 1);
  v_t0    := (v_d0::timestamp AT TIME ZONE v_tz);

  SELECT array_agg(DISTINCT ur.user_id) INTO v_ids
    FROM public.user_roles ur
   WHERE ur.user_id = ANY(p_teacher_ids)
     AND ur.institution_id = p_institution_id
     AND ur.role = 'teacher';
  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  ex AS (
    SELECT e.created_by AS uid, count(*) AS n
      FROM exams e
     WHERE e.created_by = ANY(v_ids) AND e.created_at >= v_t0
     GROUP BY e.created_by
  ),
  pub AS (
    SELECT l.actor_id AS uid, count(DISTINCT l.exam_id) AS n
      FROM exam_publication_logs l
     WHERE l.actor_id = ANY(v_ids) AND l.action = 'published' AND l.created_at >= v_t0
     GROUP BY l.actor_id
  ),
  marks AS (
    SELECT m.uid, count(DISTINCT m.exam_id) AS n_exams,
           count(DISTINCT (m.exam_id, m.student_id)) AS n_students
      FROM (
        SELECT om.created_by AS uid, om.exam_id, om.student_id
          FROM offline_student_marks om
         WHERE om.created_by = ANY(v_ids) AND om.updated_at >= v_t0
        UNION ALL
        SELECT os.entered_by, sa.exam_id, sa.student_id
          FROM offline_section_marks os
          JOIN student_exam_attempts sa ON sa.id = os.attempt_id
         WHERE os.entered_by = ANY(v_ids) AND os.updated_at >= v_t0
      ) m
     GROUP BY m.uid
  ),
  ovr AS (
    SELECT o.evaluated_by AS uid, count(*) AS n
      FROM teacher_overrides o
     WHERE o.evaluated_by = ANY(v_ids) AND o.evaluated_at >= v_t0
     GROUP BY o.evaluated_by
  ),
  qb AS (
    SELECT q.created_by AS uid,
           count(*) FILTER (WHERE q.source = 'ai_generated') AS n_ai,
           count(*) FILTER (WHERE q.source IS DISTINCT FROM 'ai_generated') AS n_manual
      FROM question_bank q
     WHERE q.created_by = ANY(v_ids) AND q.created_at >= v_t0
     GROUP BY q.created_by
  ),
  hw AS (
    SELECT h.created_by AS uid, count(*) AS n
      FROM homework_assignments h
     WHERE h.created_by = ANY(v_ids) AND h.created_at >= v_t0 AND h.status IS DISTINCT FROM 'draft'
     GROUP BY h.created_by
  ),
  hwc AS (
    SELECT h.evaluated_by AS uid, count(*) AS n
      FROM homework_assignments h
     WHERE h.evaluated_by = ANY(v_ids) AND h.checked_at >= v_t0
     GROUP BY h.evaluated_by
  ),
  hwr AS (
    SELECT r.evaluated_by AS uid, count(*) AS n
      FROM homework_results r
     WHERE r.evaluated_by = ANY(v_ids) AND r.evaluated_at >= v_t0
     GROUP BY r.evaluated_by
  ),
  att AS (
    SELECT ar.marked_by AS uid, count(DISTINCT (ar.class_id, ar.date)) AS n_days, count(*) AS n_rows
      FROM attendance_records ar
     WHERE ar.marked_by = ANY(v_ids) AND ar.date BETWEEN v_d0 AND v_today
     GROUP BY ar.marked_by
  ),
  syl AS (
    SELECT sp.recorded_by AS uid,
           count(DISTINCT (sp.class_id, sp.subject_id, sp.date)) AS n_lessons,
           count(*) AS n_topics
      FROM syllabus_progress_events sp
     WHERE sp.recorded_by = ANY(v_ids) AND sp.created_at >= v_t0
     GROUP BY sp.recorded_by
  ),
  notes AS (
    SELECT lp.created_by AS uid, count(*) AS n
      FROM tt_lesson_plans lp
     WHERE lp.created_by = ANY(v_ids) AND lp.is_note_only AND lp.created_at >= v_t0
     GROUP BY lp.created_by
  ),
  wd AS (
    SELECT s.staff_id AS uid,
           count(*) FILTER (WHERE s.check_in_at IS NOT NULL)  AS n_in,
           count(*) FILTER (WHERE s.check_out_at IS NOT NULL) AS n_out,
           count(*) FILTER (WHERE s.status = 'late')          AS n_late
      FROM staff_attendance_records s
     WHERE s.staff_id = ANY(v_ids) AND s.date BETWEEN v_d0 AND v_today
     GROUP BY s.staff_id
  ),
  lv AS (
    SELECT lr.user_id AS uid, count(*) AS n
      FROM staff_leave_requests lr
     WHERE lr.user_id = ANY(v_ids) AND lr.created_at >= v_t0
     GROUP BY lr.user_id
  ),
  tk AS (
    SELECT l.actor_id AS uid,
           count(DISTINCT coalesce(t.task_group_id, l.task_id)) FILTER (WHERE l.action = 'created') AS n_assigned,
           count(DISTINCT l.task_id) FILTER (WHERE l.action = 'submitted_for_approval') AS n_submitted,
           count(DISTINCT l.task_id) FILTER (WHERE l.action = 'approved') AS n_approved
      FROM task_audit_logs l
      LEFT JOIN tasks t ON t.id = l.task_id
     WHERE l.actor_id = ANY(v_ids) AND l.created_at >= v_t0
     GROUP BY l.actor_id
  ),
  di AS (
    SELECT d.created_by AS uid, count(DISTINCT (d.title, date_trunc('minute', d.created_at))) AS n
      FROM diary_entries d
     WHERE d.created_by = ANY(v_ids) AND d.created_at >= v_t0
     GROUP BY d.created_by
  ),
  sm AS (
    SELECT m.created_by AS uid, count(*) AS n
      FROM study_materials m
     WHERE m.created_by = ANY(v_ids) AND m.created_at >= v_t0
     GROUP BY m.created_by
  ),
  nt AS (
    SELECT n.published_by AS uid, count(*) AS n
      FROM notices n
     WHERE n.published_by = ANY(v_ids) AND n.created_at >= v_t0
     GROUP BY n.published_by
  )
  SELECT u.uid,
         v_d0,
         v_today,
         coalesce(ex.n, 0)::integer,
         coalesce(pub.n, 0)::integer,
         coalesce(marks.n_exams, 0)::integer,
         coalesce(marks.n_students, 0)::integer,
         coalesce(ovr.n, 0)::integer,
         coalesce(qb.n_ai, 0)::integer,
         coalesce(qb.n_manual, 0)::integer,
         coalesce(hw.n, 0)::integer,
         coalesce(hwc.n, 0)::integer,
         coalesce(hwr.n, 0)::integer,
         coalesce(att.n_days, 0)::integer,
         coalesce(att.n_rows, 0)::integer,
         coalesce(syl.n_lessons, 0)::integer,
         coalesce(syl.n_topics, 0)::integer,
         coalesce(notes.n, 0)::integer,
         coalesce(wd.n_in, 0)::integer,
         coalesce(wd.n_out, 0)::integer,
         coalesce(wd.n_late, 0)::integer,
         coalesce(lv.n, 0)::integer,
         coalesce(tk.n_assigned, 0)::integer,
         coalesce(tk.n_submitted, 0)::integer,
         coalesce(tk.n_approved, 0)::integer,
         coalesce(di.n, 0)::integer,
         coalesce(sm.n, 0)::integer,
         coalesce(nt.n, 0)::integer
    FROM unnest(v_ids) AS u(uid)
    LEFT JOIN ex    ON ex.uid    = u.uid
    LEFT JOIN pub   ON pub.uid   = u.uid
    LEFT JOIN marks ON marks.uid = u.uid
    LEFT JOIN ovr   ON ovr.uid   = u.uid
    LEFT JOIN qb    ON qb.uid    = u.uid
    LEFT JOIN hw    ON hw.uid    = u.uid
    LEFT JOIN hwc   ON hwc.uid   = u.uid
    LEFT JOIN hwr   ON hwr.uid   = u.uid
    LEFT JOIN att   ON att.uid   = u.uid
    LEFT JOIN syl   ON syl.uid   = u.uid
    LEFT JOIN notes ON notes.uid = u.uid
    LEFT JOIN wd    ON wd.uid    = u.uid
    LEFT JOIN lv    ON lv.uid    = u.uid
    LEFT JOIN tk    ON tk.uid    = u.uid
    LEFT JOIN di    ON di.uid    = u.uid
    LEFT JOIN sm    ON sm.uid    = u.uid
    LEFT JOIN nt    ON nt.uid    = u.uid;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_work_totals(uuid, uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_work_totals(uuid, uuid[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_work_totals(uuid, uuid[], integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- teacher_activity_log: same body as 20261005120000 except the range now
-- starts at school-local midnight (today - (p_days - 1)), matching
-- teacher_work_totals, and the payload carries range_start / range_end.
-- CREATE OR REPLACE keeps the owner and grants (authenticated, service_role).
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
  v_tz    text;
  v_today date;
  v_d0    date;
  v_since timestamptz;
  v_ids   uuid[];
  v_out   jsonb;
BEGIN
  PERFORM public._assert_teacher_activity_access(p_institution_id);
  IF coalesce(cardinality(p_teacher_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'Too many teachers in one export (max 1000)' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(i.timezone, 'Asia/Kolkata') INTO v_tz
    FROM public.institutions i WHERE i.id = p_institution_id;
  v_tz    := coalesce(v_tz, 'Asia/Kolkata');
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_d0    := v_today - (v_days - 1);
  v_since := (v_d0::timestamp AT TIME ZONE v_tz);

  SELECT array_agg(DISTINCT ur.user_id) INTO v_ids
    FROM public.user_roles ur
   WHERE ur.user_id = ANY(p_teacher_ids)
     AND ur.institution_id = p_institution_id
     AND ur.role = 'teacher';
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'returned', 0, 'time_zone', v_tz,
                              'range_start', v_d0, 'range_end', v_today,
                              'events', '[]'::jsonb);
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
           'total',       (SELECT count(*) FROM ev),
           'returned',    (SELECT count(*) FROM page),
           'time_zone',   v_tz,
           'range_start', v_d0,
           'range_end',   v_today,
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
