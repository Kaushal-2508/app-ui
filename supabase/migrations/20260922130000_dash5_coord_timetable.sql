-- Coordinator Console, phase 3: the timetable plane.
--
-- Reference: public/report_reference/salci-coordinator-dashboard2.html
--   "Periods needing substitution today", "Slot completion",
--   "Lesson logging backlog", "Attendance by class" and "not marked today".
--
-- WHY THE DASHBOARD GROWS A TIMETABLE AT ALL. The admin console reports on
-- outcomes and never needed periods. A coordinator's day runs on them: the
-- reference calls this "the one surface where the coordinator outranks the
-- admin day to day". Every figure below is counted off tt_slots and
-- tt_lesson_plans records, never typed, so the backlog card and the coverage
-- figure on the Academics tab cannot drift apart.
--
-- READ-ONLY, ALL OF IT. Substituting a teacher is tt_assign_substitute() and
-- editing a period is the timetable workspace; this file only ever counts. The
-- console links out to both rather than growing a second editor to keep in step.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

/* --------------------------------------------- periods needing cover ------ */

-- Two different failures wear the same face to a coordinator at 08:00: the
-- teacher is out, or nobody was ever put in the slot. Both leave a class
-- sitting unattended, so both are in the list, with the reason named.
--
-- The absence half is read from tt_substitutions rather than recomputed:
-- tt_create_pending_subs_for_absent_staff already opens a `pending` row per
-- affected period when staff attendance marks someone absent, and that row is
-- what tt_assign_substitute closes. Deriving a second, parallel list from
-- staff_attendance_records would produce a card whose rows could not be acted
-- on, which is the worst of both.
CREATE OR REPLACE FUNCTION public.dash5_coord_cover(p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_date date; v_dow text;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();
  v_date := COALESCE(p_date, c.today);
  v_dow  := public.tt_dow_to_text(v_date);

  WITH myslots AS (
    SELECT s.id, s.class_id, s.teacher_id, s.subject_id, s.slot_type, s.period_slot_id,
           cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '') AS class_label,
           ps.period_number, ps.label AS period_label, ps.start_time, ps.end_time
      FROM tt_slots s
      JOIN wing_class_mappings m ON m.class_id = s.class_id AND m.wing_id = c.wing
      JOIN classes cl ON cl.id = s.class_id AND cl.is_active IS NOT FALSE
      JOIN tt_period_slots ps ON ps.id = s.period_slot_id
     WHERE s.institution_id = c.inst
       AND s.day = v_dow
       AND s.slot_type IN ('theory','practical')
       AND (c.ay_code IS NULL OR s.academic_year = c.ay_code)
  ),
  -- the teacher is out: a pending substitution already exists for the date
  absent AS (
    SELECT ms.*, sub.id AS sub_id, 'absent'::text AS reason,
           sub.reason AS sub_reason
      FROM myslots ms
      JOIN tt_substitutions sub ON sub.slot_id = ms.id AND sub.date = v_date
     WHERE sub.status = 'pending'
  ),
  -- nobody was ever put in the slot. Excluded when a pending substitution is
  -- already open on it, so one period can never appear as two jobs.
  unstaffed AS (
    SELECT ms.*, NULL::uuid AS sub_id, 'unassigned'::text AS reason,
           NULL::text AS sub_reason
      FROM myslots ms
     WHERE ms.teacher_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM absent a WHERE a.id = ms.id)
  ),
  all_rows AS (SELECT * FROM absent UNION ALL SELECT * FROM unstaffed)
  SELECT jsonb_build_object(
    'date', v_date,
    'day', v_dow,
    'total', (SELECT count(*)::int FROM all_rows),
    'absent', (SELECT count(*)::int FROM all_rows WHERE reason = 'absent'),
    'unassigned', (SELECT count(*)::int FROM all_rows WHERE reason = 'unassigned'),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'slot_id', r.id, 'sub_id', r.sub_id, 'reason', r.reason,
        'sub_reason', r.sub_reason,
        'class_id', r.class_id, 'class_label', r.class_label,
        'period', r.period_number, 'period_label', r.period_label,
        'start_time', r.start_time, 'end_time', r.end_time,
        'subject', (SELECT us.name FROM universal_subjects us WHERE us.id = r.subject_id),
        'teacher_id', r.teacher_id,
        'teacher', (SELECT p.full_name FROM profiles p WHERE p.id = r.teacher_id),
        -- How many colleagues could actually take it. A cover list with no
        -- answer is a worry, not a task; this is what turns the row into one.
        'free_teachers', (SELECT count(*)::int
                            FROM public.tt_get_free_teachers_for_slot(r.id, v_date)))
      ORDER BY r.period_number, r.class_label)
      FROM all_rows r), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_cover(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_cover(date) TO authenticated, service_role;

/* ---------------------------------------------------- slot completion ----- */

-- The week grid, per class, with every cell in one of five states. This is the
-- only place on the console that shows a period as a period rather than as an
-- aggregate, and it is how a coordinator sees that Thursday period 6 has never
-- been staffed all term.
--
-- The week shown is the one containing today, Monday to Saturday, because a
-- period's state depends on whether its date has passed: the same Thursday cell
-- is "not yet taught" on Tuesday and "taught but not logged" on Friday.
CREATE OR REPLACE FUNCTION public.dash5_coord_slot_grid(p_class_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_monday date; v_class uuid;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();
  v_class := public.dash5_scope_class(c.inst, p_class_id, false);
  v_monday := c.today - (extract(isodow FROM c.today)::int - 1);

  WITH days AS (
    SELECT g.n AS idx,
           (v_monday + g.n)::date AS the_date,
           public.tt_dow_to_text((v_monday + g.n)::date) AS dow
      FROM generate_series(0, 5) g(n)
  ),
  -- A holiday is not a gap in anybody's logging.
  holiday AS (
    SELECT d.the_date
      FROM days d
     WHERE EXISTS (SELECT 1 FROM cal_events ce
                    WHERE ce.institution_id = c.inst
                      AND ce.kind = 'holiday'
                      AND d.the_date BETWEEN ce.starts_on AND ce.ends_on)
  ),
  mycls AS (
    SELECT cl.id, cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '') AS label
      FROM wing_class_mappings m
      JOIN classes cl ON cl.id = m.class_id AND cl.is_active IS NOT FALSE
     WHERE m.wing_id = c.wing
       AND (v_class IS NULL OR cl.id = v_class)
  ),
  -- Read off the class's PERIOD STRUCTURE, not off the slots that exist.
  -- Deriving the rows from tt_slots made a period nobody had been assigned to
  -- vanish from the grid entirely, which is precisely the case this card is for:
  -- Class 6 A drew periods 2,4,5,6,7,9,10,11 and silently dropped 1, 3 and 8,
  -- the three nobody is teaching.
  periods AS (
    SELECT DISTINCT ON (ps.period_number) ps.period_number, ps.label
      FROM mycls
      JOIN tt_class_structure cs ON cs.class_id = mycls.id
                                AND cs.institution_id = c.inst
                                AND (c.ay_code IS NULL OR cs.academic_year = c.ay_code)
      JOIN tt_period_slots ps ON ps.structure_id = cs.structure_id
     WHERE ps.kind = 'period'
     ORDER BY ps.period_number, ps.label
  ),
  cells AS (
    SELECT mycls.id AS class_id, mycls.label AS class_label,
           d.idx AS day_idx, d.the_date, ps.period_number,
           s.id AS slot_id, s.teacher_id, s.slot_type,
           -- The cell prints the subject and its hover names the teacher, so
           -- the grid reads as a timetable rather than as a heat map.
           us.name AS subject, pt.full_name AS teacher,
           (s.id IS NOT NULL AND s.slot_type IN ('theory','practical')) AS teaching,
           EXISTS (SELECT 1 FROM tt_lesson_plans lp
                    WHERE lp.slot_id = s.id AND lp.date = d.the_date
                      AND lp.status = 'done') AS logged,
           EXISTS (SELECT 1 FROM holiday h WHERE h.the_date = d.the_date) AS is_holiday
      FROM mycls
      CROSS JOIN days d
      CROSS JOIN periods ps
      LEFT JOIN tt_slots s
             ON s.class_id = mycls.id
            AND s.day = d.dow
            AND s.institution_id = c.inst
            AND (c.ay_code IS NULL OR s.academic_year = c.ay_code)
            AND EXISTS (SELECT 1 FROM tt_period_slots p2
                         WHERE p2.id = s.period_slot_id
                           AND p2.period_number = ps.period_number)
      LEFT JOIN universal_subjects us ON us.id = s.subject_id
      LEFT JOIN profiles pt ON pt.id = s.teacher_id
  ),
  stated AS (
    SELECT cells.*,
           CASE
             WHEN is_holiday        THEN 'holiday'
             WHEN NOT teaching      THEN 'free'
             WHEN teacher_id IS NULL THEN 'unassigned'
             WHEN the_date > c.today THEN 'assigned'
             WHEN logged            THEN 'logged'
             ELSE 'unlogged'
           END AS state
      FROM cells
  )
  SELECT jsonb_build_object(
    'week_start', v_monday,
    'today', c.today,
    'class_id', v_class,
    'periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'period', p.period_number, 'label', p.label) ORDER BY p.period_number)
      FROM periods p), '[]'::jsonb),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'idx', d.idx, 'date', d.the_date, 'dow', d.dow) ORDER BY d.idx)
      FROM days d), '[]'::jsonb),
    'counts', COALESCE((SELECT jsonb_object_agg(state, n) FROM (
        SELECT state, count(*)::int n FROM stated GROUP BY 1) q), '{}'::jsonb),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'class_id', z.class_id, 'class_label', z.class_label, 'cells', z.cells)
      ORDER BY z.class_label) FROM (
      SELECT class_id, class_label,
             jsonb_agg(jsonb_build_object(
               'day', day_idx, 'period', period_number,
               'state', state, 'slot_id', slot_id,
               'subject', subject, 'teacher', teacher)
               ORDER BY day_idx, period_number) AS cells
        FROM stated GROUP BY 1, 2) z), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_slot_grid(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_slot_grid(uuid) TO authenticated, service_role;

/* ------------------------------------------------- lesson-log backlog ----- */

-- A period taught but never logged leaves the coverage figure on the Academics
-- tab understated. The reference calls chasing these "the cheapest accuracy you
-- can buy", and it is right: nothing has to change in a classroom for the
-- number to become true.
--
-- Counted from Monday to TODAY only. A period later this week is not a backlog,
-- and including it would put every teacher permanently in the list.
CREATE OR REPLACE FUNCTION public.dash5_coord_log_backlog()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_monday date;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();
  v_monday := c.today - (extract(isodow FROM c.today)::int - 1);

  WITH days AS (
    SELECT g.d::date AS the_date, public.tt_dow_to_text(g.d::date) AS dow
      FROM generate_series(v_monday, c.today, INTERVAL '1 day') g(d)
     WHERE NOT EXISTS (SELECT 1 FROM cal_events ce
                        WHERE ce.institution_id = c.inst
                          AND ce.kind IN ('holiday','exam_block')
                          AND g.d::date BETWEEN ce.starts_on AND ce.ends_on)
  ),
  due AS (
    SELECT s.id AS slot_id, s.teacher_id, s.class_id, s.subject_id, d.the_date,
           ps.period_number
      FROM tt_slots s
      JOIN wing_class_mappings m ON m.class_id = s.class_id AND m.wing_id = c.wing
      JOIN classes cl ON cl.id = s.class_id AND cl.is_active IS NOT FALSE
      JOIN tt_period_slots ps ON ps.id = s.period_slot_id
      JOIN days d ON d.dow = s.day
     WHERE s.institution_id = c.inst
       AND s.slot_type IN ('theory','practical')
       AND s.teacher_id IS NOT NULL
       AND (c.ay_code IS NULL OR s.academic_year = c.ay_code)
       -- A period somebody else covered is not the original teacher's to log.
       AND NOT EXISTS (SELECT 1 FROM tt_substitutions sub
                        WHERE sub.slot_id = s.id AND sub.date = d.the_date
                          AND sub.status = 'assigned')
       AND NOT EXISTS (SELECT 1 FROM tt_lesson_plans lp
                        WHERE lp.slot_id = s.id AND lp.date = d.the_date
                          AND lp.status IN ('done','skipped'))
  ),
  per_teacher AS (
    SELECT d.teacher_id, p.full_name,
           count(*)::int n,
           count(DISTINCT d.class_id)::int classes,
           min(d.the_date) oldest
      FROM due d
      JOIN profiles p ON p.id = d.teacher_id
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'week_start', v_monday,
    'today', c.today,
    'total', (SELECT COALESCE(sum(n), 0)::int FROM per_teacher),
    'teachers', (SELECT count(*)::int FROM per_teacher),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'teacher_id', t.teacher_id, 'name', t.full_name,
        'periods', t.n, 'classes', t.classes,
        'oldest', t.oldest, 'oldest_days', (c.today - t.oldest))
      ORDER BY t.n DESC, t.full_name)
      FROM per_teacher t), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_log_backlog() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_log_backlog() TO authenticated, service_role;

/* --------------------------------------------------- attendance by class -- */

-- The admin console compares wings. A coordinator has one, so the same card
-- compares the classes inside it, and carries the "not marked today" list the
-- reference puts beside it: a class with no register today is a class that
-- contributes nothing to any figure above it.
CREATE OR REPLACE FUNCTION public.dash5_coord_attendance_by_class(p_days int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_n int := LEAST(GREATEST(COALESCE(p_days, 20), 1), 90);
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  WITH mycls AS (
    SELECT cl.id, cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '') AS label
      FROM wing_class_mappings m
      JOIN classes cl ON cl.id = m.class_id AND cl.is_active IS NOT FALSE
     WHERE m.wing_id = c.wing
  ),
  -- The window is the last v_n days the WING took a register, not the last v_n
  -- calendar days: Sundays and holidays would otherwise drag every class down.
  d AS (
    SELECT DISTINCT ar.date
      FROM attendance_records ar
      JOIN mycls ON mycls.id = ar.class_id
     WHERE ar.institution_id = c.inst
     ORDER BY ar.date DESC
     LIMIT v_n
  ),
  per_class AS (
    SELECT mycls.id, mycls.label,
           count(ar.id) FILTER (WHERE ar.status IN ('present','late'))::int present,
           count(ar.id)::int marked,
           count(DISTINCT ar.date)::int days_marked,
           (SELECT count(*)::int FROM class_assignments ca
              JOIN public.institution_student_ids(c.inst) si ON si.student_id = ca.user_id
             WHERE ca.class_id = mycls.id AND ca.role::text = 'student') students,
           EXISTS (SELECT 1 FROM attendance_records a2
                    WHERE a2.class_id = mycls.id AND a2.date = c.today
                      AND a2.institution_id = c.inst) marked_today
      FROM mycls
      LEFT JOIN attendance_records ar
             ON ar.class_id = mycls.id
            AND ar.institution_id = c.inst
            AND ar.date IN (SELECT date FROM d)
     GROUP BY mycls.id, mycls.label
  )
  SELECT jsonb_build_object(
    'today', c.today,
    'days_in_window', (SELECT count(*)::int FROM d),
    'wing_pct', (SELECT CASE WHEN sum(marked) > 0
                             THEN round(sum(present)*100.0/sum(marked), 1) END
                   FROM per_class),
    'unmarked_today', (SELECT count(*)::int FROM per_class WHERE NOT marked_today),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'class_id', q.id, 'label', q.label,
        'students', q.students,
        'pct', CASE WHEN q.marked > 0 THEN round(q.present*100.0/q.marked, 1) END,
        'marked', q.marked, 'present', q.present,
        'days_marked', q.days_marked,
        'marked_today', q.marked_today)
      ORDER BY CASE WHEN q.marked > 0 THEN q.present*100.0/q.marked END NULLS LAST, q.label)
      FROM per_class q), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_attendance_by_class(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_attendance_by_class(int) TO authenticated, service_role;
