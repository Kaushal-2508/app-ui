-- Coordinator Console, phase 2: the surfaces the admin dashboard has no
-- equivalent of, because they only exist for someone who owns one wing.
--
-- Reference: public/report_reference/salci-coordinator-dashboard2.html
--   the scope bar, the four KPI cards, "Your desk", "Your classes",
--   "Staff attendance & leave in your wing", and the tasks pushed down to you.
--
-- WHY THESE ARE NOT dash5_* WITH A WING ARGUMENT. Everything in phase 1 was a
-- school rollup that happens to be filterable by wing. These are different in
-- kind: they answer "what is waiting on ME today", and their subject is the
-- caller, not a slice of the school. An admin has no desk, four coordinators
-- have four different ones, and none of them is a filter of the principal's.
--
-- Every one of them derives its wing from dash5_caller_wing(), never from an
-- argument, so there is nothing for a client to forge. An admin calling these
-- gets NULL back from that helper and is refused: the console is not theirs.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

/* --------------------------------------------------------------- shared --- */

-- The wing, its classes, and the calendar facts every function below repeats.
-- Returned as a row so each caller does one lookup rather than five.
CREATE OR REPLACE FUNCTION public.dash5_coord_ctx(OUT inst uuid, OUT wing uuid,
                                                  OUT tz text, OUT today date,
                                                  OUT ay_code text,
                                                  OUT ay_start date, OUT ay_end date)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  inst := public.dash5_resolve_institution(NULL);
  wing := public.dash5_caller_wing(inst);
  IF wing IS NULL THEN
    -- An admin. dash5_caller_wing returns NULL for them, and every function
    -- here divides by "your wing", so there is no sensible answer to give.
    RAISE EXCEPTION 'dashboard: the coordinator console needs a wing assignment';
  END IF;

  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO tz
    FROM institutions i WHERE i.id = inst;
  today := (now() AT TIME ZONE tz)::date;

  SELECT ay.starts_on::date, ay.ends_on::date, ay.code
    INTO ay_start, ay_end, ay_code
    FROM cal_academic_years ay
   WHERE ay.institution_id = inst
   ORDER BY (today BETWEEN ay.starts_on::date AND ay.ends_on::date) DESC,
            ay.is_active DESC, ay.starts_on::date DESC
   LIMIT 1;

  ay_start := COALESCE(ay_start, today - INTERVAL '12 months')::date;
  ay_end   := COALESCE(ay_end,   today + INTERVAL '1 day')::date;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_ctx() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_ctx() TO authenticated, service_role;

/* ------------------------------------------------------------ scope bar --- */

-- "Your scope: 18 classes, 579 students, 104 subject-class pairs, 36 teachers."
-- The reference puts this above everything else because the first question a
-- coordinator asks a new dashboard is "what is this page counting".
CREATE OR REPLACE FUNCTION public.dash5_coord_scope()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  SELECT jsonb_build_object(
    'wing_id', w.id,
    'wing_name', w.name,
    'wing_span', NULLIF(btrim(COALESCE(w.description, '')), ''),
    'institution_id', c.inst,
    'institution_name', (SELECT i.name FROM institutions i WHERE i.id = c.inst),
    'today', c.today,
    'ay_code', c.ay_code,
    'ay_start', c.ay_start,
    'ay_end', c.ay_end,
    'classes', (SELECT count(*)::int
                  FROM wing_class_mappings m
                  JOIN classes cl ON cl.id = m.class_id AND cl.is_active IS NOT FALSE
                 WHERE m.wing_id = c.wing),
    'students', (SELECT count(*)::int
                   FROM class_assignments ca
                   JOIN wing_class_mappings m ON m.class_id = ca.class_id AND m.wing_id = c.wing
                   JOIN classes cst ON cst.id = ca.class_id AND cst.is_active IS NOT FALSE
                   JOIN public.institution_student_ids(c.inst) s ON s.student_id = ca.user_id
                  WHERE ca.role::text = 'student'),
    -- Every count below joins `classes` on is_active, the same rule
    -- dash5_atom_rows uses. Without it this read 321 subject-class pairs
    -- against the table's 171: Middle wing has 18 class mappings and only 9
    -- live classes, and the scope bar was counting the retired ones.
    'subject_pairs', (SELECT count(DISTINCT (scm.class_id, scm.subject_id))::int
                        FROM subject_class_mappings scm
                        JOIN wing_class_mappings m ON m.class_id = scm.class_id AND m.wing_id = c.wing
                        JOIN classes cs ON cs.id = scm.class_id AND cs.is_active IS NOT FALSE),
    'teachers', (SELECT count(DISTINCT ca.user_id)::int
                   FROM class_assignments ca
                   JOIN wing_class_mappings m ON m.class_id = ca.class_id AND m.wing_id = c.wing
                   JOIN classes ct ON ct.id = ca.class_id AND ct.is_active IS NOT FALSE
                  WHERE ca.role::text = 'teacher'),
    -- Named out loud rather than silently merged. Every coordinator in
    -- production holds exactly one wing; if that ever changes, the console says
    -- which one it is showing instead of quietly adding two wings together
    -- under a heading that says "your wing".
    'other_wings', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('id', w2.id, 'name', w2.name) ORDER BY w2.name)
         FROM wing_assignments wa2
         JOIN wings w2 ON w2.id = wa2.wing_id
                      AND w2.institution_id = c.inst
                      AND w2.is_active IS NOT FALSE
        WHERE wa2.user_id = auth.uid() AND w2.id <> c.wing), '[]'::jsonb)
  ) INTO v_out
  FROM wings w WHERE w.id = c.wing;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_scope() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_scope() TO authenticated, service_role;

/* ---------------------------------------------------------- KPI cards ----- */

-- The reference's fourth card is deliberately NOT one of the admin's four:
-- "periods logged today". A principal's daily number is the school average; a
-- coordinator's is whether the day was actually recorded, because every other
-- figure on the page is understated until it is.
CREATE OR REPLACE FUNCTION public.dash5_coord_cards()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record; v_out jsonb; v_dow text;
  s_present int; s_marked int; s_roll int; sch_pct numeric;
  t_present int; t_marked int; t_roll int;
  p_logged int; p_total int;
  wing_acc numeric; school_acc numeric;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();
  v_dow := lower(to_char(c.today, 'FMday'));

  -- ---- students. 'leave' stays in the denominator and out of the numerator:
  -- the school accounted for that child, it simply did not have them (CLAUDE.md
  -- 11, migration 20260905160000). Do not add 'leave' to the FILTER.
  SELECT count(*) FILTER (WHERE ar.status IN ('present','late'))::int, count(*)::int
    INTO s_present, s_marked
    FROM attendance_records ar
    JOIN wing_class_mappings m ON m.class_id = ar.class_id AND m.wing_id = c.wing
   WHERE ar.institution_id = c.inst AND ar.date = c.today;

  SELECT count(*)::int INTO s_roll
    FROM class_assignments ca
    JOIN wing_class_mappings m ON m.class_id = ca.class_id AND m.wing_id = c.wing
    JOIN public.institution_student_ids(c.inst) si ON si.student_id = ca.user_id
   WHERE ca.role::text = 'student';

  SELECT CASE WHEN count(*) > 0
              THEN round(count(*) FILTER (WHERE ar.status IN ('present','late'))*100.0/count(*), 1) END
    INTO sch_pct
    FROM attendance_records ar
   WHERE ar.institution_id = c.inst AND ar.date = c.today;

  -- ---- your teachers. The roll is whoever takes a class in this wing, not
  -- every teacher in the school, so "3 of 36" means three of YOUR thirty-six.
  WITH mine AS (
    SELECT DISTINCT ca.user_id AS id
      FROM class_assignments ca
      JOIN wing_class_mappings m ON m.class_id = ca.class_id AND m.wing_id = c.wing
      JOIN profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE
     WHERE ca.role::text = 'teacher'
  )
  SELECT (SELECT count(*)::int FROM mine),
         count(sa.id) FILTER (WHERE sa.status IN ('present','late'))::int,
         count(sa.id)::int
    INTO t_roll, t_present, t_marked
    FROM mine
    LEFT JOIN staff_attendance_records sa
           ON sa.staff_id = mine.id AND sa.date = c.today AND sa.institution_id = c.inst;

  -- ---- periods logged today. Only the teaching kinds: an assembly or a free
  -- period has nothing to log, and counting them would make a fully logged day
  -- read as 70%.
  SELECT count(*)::int,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM tt_lesson_plans lp
            WHERE lp.slot_id = s.id AND lp.date = c.today AND lp.status = 'done'))::int
    INTO p_total, p_logged
    FROM tt_slots s
    JOIN wing_class_mappings m ON m.class_id = s.class_id AND m.wing_id = c.wing
   WHERE s.institution_id = c.inst
     AND s.day = v_dow
     AND s.slot_type IN ('theory','practical')
     AND (c.ay_code IS NULL OR s.academic_year = c.ay_code);

  -- ---- average score, wing against school, off the same atoms as the table
  SELECT sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL AND a.wing_id = c.wing)
         / NULLIF(sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL AND a.wing_id = c.wing), 0),
         sum(a.acc*a.attempts) FILTER (WHERE a.acc IS NOT NULL)
         / NULLIF(sum(a.attempts) FILTER (WHERE a.acc IS NOT NULL), 0)
    INTO wing_acc, school_acc
    FROM public.dash5_atom_rows(c.inst) a;

  v_out := jsonb_build_object(
    'today', c.today,
    'students', jsonb_build_object(
      'present', s_present, 'marked', s_marked, 'roll', s_roll,
      'pct', CASE WHEN s_marked > 0 THEN round(s_present*100.0/s_marked, 1) END,
      'school_pct', sch_pct),
    'teachers', jsonb_build_object(
      'present', t_present, 'marked', t_marked, 'roll', t_roll,
      'pct', CASE WHEN t_roll > 0 THEN round(t_present*100.0/t_roll, 1) END),
    'score', jsonb_build_object(
      'wing', CASE WHEN wing_acc IS NOT NULL THEN round(wing_acc, 1) END,
      'school', CASE WHEN school_acc IS NOT NULL THEN round(school_acc, 1) END,
      'delta', CASE WHEN wing_acc IS NOT NULL AND school_acc IS NOT NULL
                    THEN round(wing_acc - school_acc, 1) END),
    'periods', jsonb_build_object(
      'logged', p_logged, 'total', p_total,
      'pct', CASE WHEN p_total > 0 THEN round(p_logged*100.0/p_total, 1) END)
  );
  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_cards() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_cards() TO authenticated, service_role;

/* ------------------------------------------------------------ your desk --- */

-- Four queues that close on THIS account and nobody else's. The distinction the
-- reference draws, and the reason the desk sits above the analytics: everything
-- else on the page is work for a teacher, and this is the part a coordinator
-- cannot delegate.
CREATE OR REPLACE FUNCTION public.dash5_coord_desk()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  t_total int; t_overdue int; t_high int;
  l_total int; l_oldest int; l_class text;
  r_total int; r_classes int; r_oldest int;
  g_total int; g_classes int;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  -- 1. tasks assigned to you. task_assignments.task_id is NOT NULL UNIQUE, so
  -- one row per task; a multi-assignee instruction is N tasks (CLAUDE.md 11).
  SELECT count(*)::int,
         count(*) FILTER (WHERE t.due_date IS NOT NULL
                            AND (t.due_date AT TIME ZONE c.tz)::date < c.today)::int,
         -- LOWER is more urgent: dash_create_task_from_flag writes 1 for a
         -- critical flag and PriorityPill renders `priority <= 1` as High.
         -- This is the opposite of reported_issues.priority. 2 is the default
         -- create_task_group writes, so it is the default for a NULL here.
         count(*) FILTER (WHERE COALESCE(t.priority, 2) <= 1)::int
    INTO t_total, t_overdue, t_high
    FROM tasks t
    JOIN task_assignments ta ON ta.task_id = t.id
   WHERE ta.assignee_id = auth.uid()
     AND t.institution_id = c.inst
     AND t.status IN ('open','in_progress','done_pending_approval')
     AND t.cancelled_at IS NULL;

  -- 2. student leave waiting on a decision, for the classes in this wing.
  SELECT count(*)::int,
         max((c.today - lr.created_at::date))::int
    INTO l_total, l_oldest
    FROM leave_requests lr
    JOIN wing_class_mappings m ON m.class_id = lr.class_id AND m.wing_id = c.wing
   WHERE lr.institution_id = c.inst AND lr.status = 'pending';

  SELECT cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '') INTO l_class
    FROM leave_requests lr
    JOIN wing_class_mappings m ON m.class_id = lr.class_id AND m.wing_id = c.wing
    JOIN classes cl ON cl.id = lr.class_id
   WHERE lr.institution_id = c.inst AND lr.status = 'pending'
   ORDER BY lr.created_at
   LIMIT 1;

  -- 3. rechecks. The only path from a recheck to a class is
  -- recheck_requests -> final_results -> student_exam_attempts.class_id.
  SELECT count(*)::int,
         count(DISTINCT a.class_id)::int,
         max((c.today - rr.requested_at::date))::int
    INTO r_total, r_classes, r_oldest
    FROM recheck_requests rr
    JOIN final_results fr ON fr.id = rr.result_id
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN wing_class_mappings m ON m.class_id = a.class_id AND m.wing_id = c.wing
   WHERE rr.status = 'pending';

  -- 4. papers held but not graded, straight off the atoms so this tile and the
  -- performance table can never disagree about what "pending" means.
  SELECT COALESCE(sum(a.pending_grading), 0)::int,
         count(DISTINCT a.class_id) FILTER (WHERE a.pending_grading > 0)::int
    INTO g_total, g_classes
    FROM public.dash5_atom_rows(c.inst) a
   WHERE a.wing_id = c.wing;

  RETURN jsonb_build_object(
    'tasks',     jsonb_build_object('count', t_total, 'overdue', t_overdue, 'high', t_high),
    'leave',     jsonb_build_object('count', l_total, 'oldest_days', COALESCE(l_oldest, 0),
                                    'oldest_class', l_class),
    'rechecks',  jsonb_build_object('count', r_total, 'classes', r_classes,
                                    'oldest_days', COALESCE(r_oldest, 0)),
    'grading',   jsonb_build_object('count', g_total, 'classes', g_classes)
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_desk() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_desk() TO authenticated, service_role;

/* --------------------------------------------------------- your classes --- */

-- The reference's "Your classes" table. A class is owned by the SET of teachers
-- who take it, which is why the teacher column is a count and a sample rather
-- than one name: addressing a class fans out to that set.
CREATE OR REPLACE FUNCTION public.dash5_coord_classes()
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
    SELECT cl.id, cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '') AS label
      FROM wing_class_mappings m
      JOIN classes cl ON cl.id = m.class_id AND cl.is_active IS NOT FALSE
     WHERE m.wing_id = c.wing
  ),
  stu AS MATERIALIZED (
    SELECT r.* FROM public.dash5_student_rows(c.inst) r
     WHERE r.wing_id = c.wing
  ),
  tch AS (
    SELECT ca.class_id,
           count(DISTINCT ca.user_id)::int n,
           (array_agg(DISTINCT p.full_name ORDER BY p.full_name))[1] AS first_name
      FROM class_assignments ca
      JOIN mycls ON mycls.id = ca.class_id
      JOIN profiles p ON p.id = ca.user_id
     WHERE ca.role::text = 'teacher'
     GROUP BY 1
  ),
  -- The class teacher is the teacher row that carries NO subject.
  ct AS (
    SELECT DISTINCT ON (ca.class_id) ca.class_id, p.full_name
      FROM class_assignments ca
      JOIN mycls ON mycls.id = ca.class_id
      JOIN profiles p ON p.id = ca.user_id
     WHERE ca.role::text = 'teacher' AND ca.subject_id IS NULL
     ORDER BY ca.class_id, p.full_name
  ),
  att_today AS (
    SELECT ar.class_id, count(*)::int marked
      FROM attendance_records ar
      JOIN mycls ON mycls.id = ar.class_id
     WHERE ar.institution_id = c.inst AND ar.date = c.today
     GROUP BY 1
  ),
  agg AS (
    SELECT mycls.id, mycls.label,
           COALESCE(t.n, 0) teachers, t.first_name,
           ct.full_name AS class_teacher,
           (SELECT count(*)::int FROM stu WHERE stu.class_id = mycls.id) students,
           (SELECT count(*)::int FROM stu WHERE stu.class_id = mycls.id AND stu.at_risk) at_risk,
           (SELECT count(*)::int FROM stu
             WHERE stu.class_id = mycls.id AND stu.attendance_pct IS NOT NULL
               AND stu.attendance_pct < 75) under75,
           (SELECT count(*)::int FROM stu WHERE stu.class_id = mycls.id AND stu.never_in) never_in,
           (SELECT round(avg(stu.attendance_pct), 1) FROM stu
             WHERE stu.class_id = mycls.id AND stu.attendance_pct IS NOT NULL) attendance,
           COALESCE(a.marked, 0) marked_today
      FROM mycls
      LEFT JOIN tch t ON t.class_id = mycls.id
      LEFT JOIN ct ON ct.class_id = mycls.id
      LEFT JOIN att_today a ON a.class_id = mycls.id
  )
  SELECT jsonb_build_object(
    'today', c.today,
    'total', (SELECT count(*)::int FROM agg),
    'unmarked', (SELECT count(*)::int FROM agg WHERE marked_today = 0),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'class_id', g.id, 'label', g.label,
        'teachers', g.teachers, 'teacher_sample', g.first_name,
        'class_teacher', g.class_teacher,
        'students', g.students, 'attendance', g.attendance,
        'marked_today', g.marked_today > 0,
        'at_risk', g.at_risk, 'under75', g.under75, 'never_in', g.never_in)
      ORDER BY g.label) FROM agg g), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_classes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_classes() TO authenticated, service_role;

/* -------------------------------------------- staff attendance & leave ---- */

-- Teacher attendance for the wing today, plus the student-leave decisions that
-- are the coordinator's to make. The reference puts them in one card because
-- they are the same morning job: who is here, and who is allowed not to be.
CREATE OR REPLACE FUNCTION public.dash5_coord_staff()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  WITH mine AS (
    SELECT DISTINCT ca.user_id AS id, p.full_name, p.avatar_path
      FROM class_assignments ca
      JOIN wing_class_mappings m ON m.class_id = ca.class_id AND m.wing_id = c.wing
      JOIN profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE
     WHERE ca.role::text = 'teacher'
  ),
  withatt AS (
    SELECT mine.*, sa.status, sa.check_in_at, sa.auto_marked_absent,
           (SELECT count(*)::int
              FROM class_assignments ca2
              JOIN wing_class_mappings m2 ON m2.class_id = ca2.class_id AND m2.wing_id = c.wing
             WHERE ca2.user_id = mine.id AND ca2.role::text = 'teacher') AS classes
      FROM mine
      LEFT JOIN staff_attendance_records sa
             ON sa.staff_id = mine.id AND sa.date = c.today AND sa.institution_id = c.inst
  )
  SELECT jsonb_build_object(
    'today', c.today,
    'present',  (SELECT count(*)::int FROM withatt WHERE status IN ('present','late')),
    'on_leave', (SELECT count(*)::int FROM withatt WHERE status = 'on_leave'),
    'absent',   (SELECT count(*)::int FROM withatt WHERE status = 'absent'),
    -- "Unmarked" is a real state and not a zero: before the cutoff nobody has
    -- checked in yet, and reporting that as absent is how a dashboard tells a
    -- coordinator at 08:05 that their whole wing is missing.
    'unmarked', (SELECT count(*)::int FROM withatt WHERE status IS NULL),
    'total',    (SELECT count(*)::int FROM withatt),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.full_name, 'avatar_path', w.avatar_path,
        'status', COALESCE(w.status, 'unmarked'),
        'auto', COALESCE(w.auto_marked_absent, false),
        'check_in', w.check_in_at, 'classes', w.classes)
      ORDER BY CASE COALESCE(w.status, 'unmarked')
                 WHEN 'absent' THEN 0 WHEN 'unmarked' THEN 1
                 WHEN 'on_leave' THEN 2 WHEN 'late' THEN 3 ELSE 4 END,
               w.full_name)
      FROM withatt w), '[]'::jsonb),
    'leave_pending', (SELECT count(*)::int
                        FROM leave_requests lr
                        JOIN wing_class_mappings m ON m.class_id = lr.class_id AND m.wing_id = c.wing
                       WHERE lr.institution_id = c.inst AND lr.status = 'pending')
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_staff() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_staff() TO authenticated, service_role;

/* ---------------------------------------------- leave awaiting decision --- */

-- The list behind the desk tile. Kept separate from the tile so the count is
-- cheap on page load and the rows are only fetched when the drawer opens.
CREATE OR REPLACE FUNCTION public.dash5_coord_leave(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_lim int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int
                FROM leave_requests lr
                JOIN wing_class_mappings m ON m.class_id = lr.class_id AND m.wing_id = c.wing
               WHERE lr.institution_id = c.inst AND lr.status = 'pending'),
    'rows', COALESCE((SELECT jsonb_agg(r ORDER BY k) FROM (
      SELECT lr.created_at AS k, jsonb_build_object(
               'id', lr.id,
               'student_id', lr.student_id,
               'student', p.full_name,
               'class_id', lr.class_id,
               'class_label', cl.name || COALESCE(' ' || NULLIF(cl.section, ''), ''),
               'leave_type', lr.leave_type,
               'reason', lr.reason,
               'start_date', lr.start_date,
               'end_date', lr.end_date,
               'days', (lr.end_date - lr.start_date) + 1,
               'waiting_days', (c.today - lr.created_at::date)) AS r
        FROM leave_requests lr
        JOIN wing_class_mappings m ON m.class_id = lr.class_id AND m.wing_id = c.wing
        JOIN classes cl ON cl.id = lr.class_id
        JOIN profiles p ON p.id = lr.student_id
       WHERE lr.institution_id = c.inst AND lr.status = 'pending'
       ORDER BY lr.created_at
       LIMIT v_lim) z), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_leave(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_leave(int) TO authenticated, service_role;

/* ------------------------------------------------- tasks pushed to you ---- */

-- "From the principal". A coordinator sits between two task planes: what they
-- assign downward (the suggestions card) and what lands on them from above.
-- Only the second belongs here, so the card cannot be confused with their own
-- outbox.
CREATE OR REPLACE FUNCTION public.dash5_coord_my_tasks(p_limit int DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_lim int := LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  WITH mine AS (
    SELECT t.id, t.title, t.description, t.status::text AS status,
           t.task_type::text AS task_type, t.priority, t.due_date, t.auto_created,
           ta.assigner_id,
           CASE WHEN t.due_date IS NULL THEN NULL
                ELSE ((t.due_date AT TIME ZONE c.tz)::date - c.today) END AS due_in_days
      FROM tasks t
      JOIN task_assignments ta ON ta.task_id = t.id
     WHERE ta.assignee_id = auth.uid()
       AND t.institution_id = c.inst
       AND t.status IN ('open','in_progress','done_pending_approval')
       AND t.cancelled_at IS NULL
  )
  SELECT jsonb_build_object(
    'total',   (SELECT count(*)::int FROM mine),
    'overdue', (SELECT count(*)::int FROM mine WHERE due_in_days IS NOT NULL AND due_in_days < 0),
    -- See dash5_coord_desk: 1 is High, 3 is Low.
    'high',    (SELECT count(*)::int FROM mine WHERE COALESCE(priority, 2) <= 1),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'detail', m.description,
        'status', m.status, 'task_type', m.task_type,
        'priority', m.priority, 'due_date', m.due_date, 'due_in_days', m.due_in_days,
        -- An auto-created task has assigner_id NULL by design and reads as
        -- "SALCI System"; so does a task someone assigned to themselves, which
        -- the no_self_assignment CHECK forces to NULL. Never print "Unknown".
        'from', CASE WHEN m.assigner_id IS NULL THEN 'SALCI System'
                     ELSE (SELECT p.full_name FROM profiles p WHERE p.id = m.assigner_id) END,
        'auto', COALESCE(m.auto_created, false))
      ORDER BY (m.due_in_days IS NULL), m.due_in_days, COALESCE(m.priority, 2))
      FROM (SELECT * FROM mine
             ORDER BY (due_in_days IS NULL), due_in_days, COALESCE(priority, 2)
             LIMIT v_lim) m), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_my_tasks(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_my_tasks(int) TO authenticated, service_role;

/* ----------------------------------------------------- recheck requests --- */

CREATE OR REPLACE FUNCTION public.dash5_coord_rechecks(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_lim int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int
                FROM recheck_requests rr
                JOIN final_results fr ON fr.id = rr.result_id
                JOIN student_exam_attempts a ON a.id = fr.attempt_id
                JOIN wing_class_mappings m ON m.class_id = a.class_id AND m.wing_id = c.wing
               WHERE rr.status = 'pending'),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', z.id, 'student', z.student, 'class_label', z.class_label,
        'class_id', z.class_id, 'exam', z.exam, 'exam_id', z.exam_id,
        'reason', z.reason, 'days', z.days, 'was_pct', z.was_pct)
      ORDER BY z.days DESC) FROM (
      SELECT rr.id, p.full_name student,
             cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '') class_label,
             a.class_id, e.title exam, e.id exam_id,
             rr.request_reason reason,
             (c.today - rr.requested_at::date) days,
             round(fr.percentage, 1) was_pct
        FROM recheck_requests rr
        JOIN final_results fr ON fr.id = rr.result_id
        JOIN student_exam_attempts a ON a.id = fr.attempt_id
        JOIN wing_class_mappings m ON m.class_id = a.class_id AND m.wing_id = c.wing
        JOIN classes cl ON cl.id = a.class_id
        JOIN exams e ON e.id = a.exam_id
        JOIN profiles p ON p.id = a.student_id
       WHERE rr.status = 'pending'
       ORDER BY rr.requested_at
       LIMIT v_lim) z), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_rechecks(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_rechecks(int) TO authenticated, service_role;
