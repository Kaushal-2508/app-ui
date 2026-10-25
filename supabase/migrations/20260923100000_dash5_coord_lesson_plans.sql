-- Coordinator Console: the slot grid becomes a lesson-plan grid.
--
-- WHAT CHANGED AND WHY. The Timetable tab's week grid answered a timetable
-- question: which periods are staffed. Tushar's instruction (2026-09-23) is that
-- the question a coordinator actually has is about the LESSON PLAN: "is that
-- day's lesson plan marked or not", with "the lesson plan over everything". Not
-- whether a class was logged, not attendance: whether the teacher updated the
-- plan for each period they teach.
--
-- The SHAPE stays what it was, on his second instruction the same day: one
-- class at a time (class filter), one week at a time, days down the side and
-- periods across. A wing-wide one-day view was built first and rejected. What
-- changes is what each cell says: the lesson plan itself (its chapter, or its
-- note) in the colour of its state.
--
-- THE STATES, all read off tt_lesson_plans for (period, date, subject):
--   done        status 'done' with a chapter            -> updated
--   note        status 'done', is_note_only (a test,     -> updated
--               an activity: logged without a chapter)
--   skipped     status 'skipped' (marked not taught)     -> updated
--   pending     status 'pending' (a substitute took it   -> NOT updated
--               and the original teacher has not resolved it)
--   not_updated a plan exists, the period is over, and   -> NOT updated
--               it was never marked
--   no_plan     no plan at all, and the period is over   -> NOT updated
--   planned     a plan exists, the period is still ahead
--   unplanned   no plan yet, the period is still ahead
--   holiday     a holiday or exam block, with no plan
-- "Over" means the date is past, or it is today and the period's end time has
-- gone by in the INSTITUTION's timezone (CLAUDE.md 24). A 14:00 period is not
-- "not updated" at 10:00.
--
-- PERIODS COME FROM tt_effective_periods, NEVER tt_slots. The slot grid, the
-- logging backlog and the "periods logged today" card all asked tt_slots for
-- `slot_type IN ('theory','practical')`, which is exactly the definition that
-- made 518 basket (optional-group) periods invisible until 2026-09-10: a basket
-- period is ONE tt_slots row of type 'free' shared by several subjects and
-- teachers. The view expands it to one row per subject. Lesson plans are keyed
-- (slot_id, date, subject_id) for the same reason, so a plan is matched on the
-- subject too.
--
-- The backlog card and the KPI card move onto the same definition in this file,
-- so the three can never quote each other different numbers.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

/* ------------------------------------------------- the old grids go ------- */

-- dash5_coord_slot_grid's only caller was CoordSlotGrid, which this replaces.
-- The one-day (p_date) version of dash5_coord_lesson_plans was live for an hour
-- on 2026-09-23 before the week shape was chosen; its signature differs, so it
-- has to be dropped rather than replaced.
DROP FUNCTION IF EXISTS public.dash5_coord_slot_grid(uuid);
DROP FUNCTION IF EXISTS public.dash5_coord_lesson_plans(date);

/* ----------------------------------------- lesson plans, a class's week --- */

CREATE OR REPLACE FUNCTION public.dash5_coord_lesson_plans(
  p_class_id uuid DEFAULT NULL,
  p_week_start date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record; v_out jsonb; v_class uuid; v_label text; v_monday date; v_now time;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();

  -- The class must be one of the wing's; with none given, the first of them in
  -- natural order ("Class 9" before "Class 10").
  v_class := public.dash5_scope_class(c.inst, p_class_id, false);
  IF v_class IS NULL THEN
    SELECT cl.id INTO v_class
      FROM wing_class_mappings m
      JOIN classes cl ON cl.id = m.class_id AND cl.is_active IS NOT FALSE
     WHERE m.wing_id = c.wing
     ORDER BY NULLIF(substring(cl.name FROM '[0-9]+'), '')::int NULLS LAST, cl.name, cl.section
     LIMIT 1;
  END IF;
  IF v_class IS NULL THEN
    RETURN jsonb_build_object('class_id', NULL, 'today', c.today, 'periods', '[]'::jsonb,
                              'days', '[]'::jsonb, 'cells', '[]'::jsonb);
  END IF;
  SELECT cl.name || COALESCE(' ' || NULLIF(cl.section, ''), '') INTO v_label
    FROM classes cl WHERE cl.id = v_class;

  -- Always a Monday, whatever day was passed.
  v_monday := COALESCE(p_week_start, c.today);
  v_monday := v_monday - (extract(isodow FROM v_monday)::int - 1);
  -- A reviewing window, not an open range: far enough back to chase a term,
  -- far enough ahead to see what is planned.
  IF v_monday < c.today - 126 OR v_monday > c.today + 60 THEN
    RAISE EXCEPTION 'dashboard: pick a week within the last four months or the next two';
  END IF;
  v_now := (now() AT TIME ZONE c.tz)::time;

  WITH days AS (
    SELECT g.n AS idx,
           (v_monday + g.n)::date AS the_date,
           public.tt_dow_to_text((v_monday + g.n)::date) AS dow
      FROM generate_series(0, 5) g(n)
  ),
  struct AS (
    SELECT cs.structure_id, st.working_days
      FROM tt_class_structure cs
      JOIN tt_period_structures st ON st.id = cs.structure_id
     WHERE cs.class_id = v_class
       AND cs.institution_id = c.inst
       AND (c.ay_code IS NULL OR cs.academic_year = c.ay_code)
     LIMIT 1
  ),
  -- Read off the class's period STRUCTURE, not off the periods that happen to
  -- be filled, so a period nobody teaches still has its column.
  periods AS (
    SELECT ps.period_number, ps.label, ps.start_time, ps.end_time
      FROM tt_period_slots ps
      JOIN struct s ON s.structure_id = ps.structure_id
     WHERE ps.kind = 'period'
  ),
  hol AS (
    SELECT DISTINCT ON (d.idx) d.idx, ce.title, ce.kind
      FROM days d
      JOIN cal_events ce ON ce.institution_id = c.inst
                        AND ce.kind IN ('holiday', 'exam_block')
                        AND d.the_date BETWEEN ce.starts_on AND ce.ends_on
     ORDER BY d.idx, (ce.kind = 'holiday') DESC, ce.starts_on
  ),
  eff AS (
    SELECT d.idx AS day_idx, d.the_date,
           ep.slot_id, ep.subject_id, ep.teacher_id, ep.from_optional_group,
           psl.period_number, psl.end_time
      FROM tt_effective_periods ep
      JOIN days d ON d.dow = ep.day
      JOIN tt_period_slots psl ON psl.id = ep.period_slot_id
     WHERE ep.class_id = v_class
       AND ep.institution_id = c.inst
       AND (c.ay_code IS NULL OR ep.academic_year = c.ay_code)
  ),
  withlp AS (
    SELECT e.*,
           lp.id AS lp_id, lp.status, COALESCE(lp.is_note_only, false) AS is_note_only,
           lp.note, lp.done_at, lp.updated_at,
           t.topic_name, us.name AS subject, pt.full_name AS teacher,
           (e.the_date < c.today OR (e.the_date = c.today AND e.end_time <= v_now)) AS over,
           (h.idx IS NOT NULL) AS is_holiday
      FROM eff e
      -- Keyed (slot, date, subject) since 2026-09-10. An ordinary period's
      -- older rows may carry a NULL subject; a basket row never does, because
      -- a NULL there could belong to any of its subjects.
      LEFT JOIN LATERAL (
        SELECT l.id, l.status, l.is_note_only, l.note, l.done_at, l.updated_at, l.topic_id
          FROM tt_lesson_plans l
         WHERE l.slot_id = e.slot_id AND l.date = e.the_date
           AND (l.subject_id = e.subject_id
                OR (l.subject_id IS NULL AND NOT e.from_optional_group))
         ORDER BY (l.subject_id IS NULL)
         LIMIT 1
      ) lp ON true
      LEFT JOIN hol h ON h.idx = e.day_idx
      LEFT JOIN syllabus_topics t ON t.id = lp.topic_id
      LEFT JOIN universal_subjects us ON us.id = e.subject_id
      LEFT JOIN profiles pt ON pt.id = e.teacher_id
  ),
  stated AS (
    SELECT w.*,
      CASE
        WHEN w.status = 'done' AND w.is_note_only THEN 'note'
        WHEN w.status = 'done'    THEN 'done'
        WHEN w.status = 'skipped' THEN 'skipped'
        WHEN w.status = 'pending' THEN 'pending'
        -- A holiday excuses a missing plan. It does not hide one that exists.
        WHEN w.lp_id IS NULL AND w.is_holiday THEN 'holiday'
        WHEN w.over AND w.lp_id IS NULL THEN 'no_plan'
        WHEN w.over                     THEN 'not_updated'
        WHEN w.lp_id IS NULL            THEN 'unplanned'
        ELSE 'planned'
      END AS state
      FROM withlp w
  )
  SELECT jsonb_build_object(
    'class_id', v_class,
    'class_label', v_label,
    'week_start', v_monday,
    'today', c.today,
    'now', to_char(v_now, 'HH24:MI'),
    'periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'period', p.period_number, 'label', p.label,
        'start_time', to_char(p.start_time, 'HH24:MI'),
        'end_time', to_char(p.end_time, 'HH24:MI'))
      ORDER BY p.period_number) FROM periods p), '[]'::jsonb),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'idx', d.idx, 'date', d.the_date, 'dow', d.dow,
        'working', EXISTS (SELECT 1 FROM struct s WHERE d.dow = ANY (s.working_days)),
        'holiday', CASE WHEN h.idx IS NOT NULL
                        THEN jsonb_build_object('title', h.title, 'kind', h.kind) END)
      ORDER BY d.idx) FROM days d LEFT JOIN hol h ON h.idx = d.idx), '[]'::jsonb),
    'summary', jsonb_build_object(
      'teaching',    (SELECT count(*)::int FROM stated),
      'updated',     (SELECT count(*)::int FROM stated WHERE state IN ('done','note','skipped')),
      'done',        (SELECT count(*)::int FROM stated WHERE state = 'done'),
      'note',        (SELECT count(*)::int FROM stated WHERE state = 'note'),
      'skipped',     (SELECT count(*)::int FROM stated WHERE state = 'skipped'),
      'pending',     (SELECT count(*)::int FROM stated WHERE state = 'pending'),
      'not_updated', (SELECT count(*)::int FROM stated WHERE state = 'not_updated'),
      'no_plan',     (SELECT count(*)::int FROM stated WHERE state = 'no_plan'),
      'planned',     (SELECT count(*)::int FROM stated WHERE state = 'planned'),
      'unplanned',   (SELECT count(*)::int FROM stated WHERE state = 'unplanned'),
      'holiday',     (SELECT count(*)::int FROM stated WHERE state = 'holiday'),
      -- The honest denominator: periods that have already happened. A plan
      -- marked early for Friday still shows in its cell; it just is not counted
      -- against a Tuesday that has not reached it.
      'over',         (SELECT count(*)::int FROM stated WHERE over),
      'updated_over', (SELECT count(*)::int FROM stated
                        WHERE over AND state IN ('done','note','skipped'))),
    'cells', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'day', z.day_idx, 'period', z.period_number, 'items', z.items)
      ORDER BY z.day_idx, z.period_number)
      FROM (
        SELECT s.day_idx, s.period_number,
               jsonb_agg(jsonb_build_object(
                 'subject', s.subject,
                 'teacher', s.teacher,
                 'state', s.state,
                 'topic', s.topic_name,
                 'note', s.note,
                 'marked_at', COALESCE(s.done_at, CASE WHEN s.state = 'skipped' THEN s.updated_at END),
                 'basket', s.from_optional_group)
                 ORDER BY s.subject) AS items
          FROM stated s GROUP BY s.day_idx, s.period_number
      ) z), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_lesson_plans(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_lesson_plans(uuid, date) TO authenticated, service_role;

/* ------------------------------------------ the backlog, same definition -- */

-- "Lesson plans not updated this week", per teacher. Same period set, same
-- lesson-plan match and same "over" rule as the day view above, so the backlog
-- card and the grid cannot quote different numbers for the same week.
--
-- Two corrections over the version in 20260922130000:
--   * tt_effective_periods instead of tt_slots, so basket periods count;
--   * only periods that are OVER. The old version counted every period of
--     today, including the afternoon, at nine in the morning.
CREATE OR REPLACE FUNCTION public.dash5_coord_log_backlog()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c record; v_out jsonb; v_monday date; v_now time;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();
  v_monday := c.today - (extract(isodow FROM c.today)::int - 1);
  v_now := (now() AT TIME ZONE c.tz)::time;

  WITH days AS (
    SELECT g.d::date AS the_date, public.tt_dow_to_text(g.d::date) AS dow
      FROM generate_series(v_monday, c.today, INTERVAL '1 day') g(d)
     WHERE NOT EXISTS (SELECT 1 FROM cal_events ce
                        WHERE ce.institution_id = c.inst
                          AND ce.kind IN ('holiday','exam_block')
                          AND g.d::date BETWEEN ce.starts_on AND ce.ends_on)
  ),
  due AS (
    SELECT ep.slot_id, ep.teacher_id, ep.class_id, ep.subject_id, d.the_date
      FROM tt_effective_periods ep
      JOIN wing_class_mappings m ON m.class_id = ep.class_id AND m.wing_id = c.wing
      JOIN classes cl ON cl.id = ep.class_id AND cl.is_active IS NOT FALSE
      JOIN tt_period_slots ps ON ps.id = ep.period_slot_id
      JOIN days d ON d.dow = ep.day
     WHERE ep.institution_id = c.inst
       AND ep.teacher_id IS NOT NULL
       AND (c.ay_code IS NULL OR ep.academic_year = c.ay_code)
       -- Only periods that have happened.
       AND (d.the_date < c.today OR ps.end_time <= v_now)
       -- A period somebody else covered is not the original teacher's plan to
       -- update. (tt_substitutions is per slot, not per subject: for a basket
       -- period an assigned cover excuses every subject in it.)
       AND NOT EXISTS (SELECT 1 FROM tt_substitutions sub
                        WHERE sub.slot_id = ep.slot_id AND sub.date = d.the_date
                          AND sub.status = 'assigned')
       -- Updated = marked done (chapter or note) or marked not taught.
       AND NOT EXISTS (SELECT 1 FROM tt_lesson_plans lp
                        WHERE lp.slot_id = ep.slot_id AND lp.date = d.the_date
                          AND (lp.subject_id = ep.subject_id
                               OR (lp.subject_id IS NULL AND NOT ep.from_optional_group))
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

/* --------------------------------------------- the KPI, same definition --- */
-- The version in 20260922120000 with ONLY the periods block and its output
-- changed; the student, teacher and score blocks are byte-identical.
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
  p_logged int; p_total int; p_due int; v_now time;
  wing_acc numeric; school_acc numeric;
BEGIN
  SELECT * INTO c FROM public.dash5_coord_ctx();
  v_dow := public.tt_dow_to_text(c.today);
  v_now := (now() AT TIME ZONE c.tz)::time;

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

  -- ---- periods logged today: lesson plans UPDATED, over the periods that
  -- have already happened. The same definition as dash5_coord_lesson_plans
  -- (the day grid) and dash5_coord_log_backlog, so the three agree:
  --   * periods from tt_effective_periods, so basket periods count;
  --   * a plan matched on (slot, date, subject);
  --   * updated = 'done' (a chapter or a note) or 'skipped' (marked not taught);
  --   * the denominator is periods that have ENDED. At 10:00 the old version
  --     read "2 / 63" against a day that had taught eight periods so far; the
  --     reference divides by what has been taught, and so does this.
  WITH today_eff AS (
    SELECT ep.slot_id, ep.subject_id, ep.from_optional_group, ps.end_time
      FROM tt_effective_periods ep
      JOIN wing_class_mappings m ON m.class_id = ep.class_id AND m.wing_id = c.wing
      JOIN classes cl ON cl.id = ep.class_id AND cl.is_active IS NOT FALSE
      JOIN tt_period_slots ps ON ps.id = ep.period_slot_id
     WHERE ep.institution_id = c.inst
       AND ep.day = v_dow
       AND (c.ay_code IS NULL OR ep.academic_year = c.ay_code)
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE t.end_time <= v_now)::int,
         count(*) FILTER (WHERE t.end_time <= v_now AND EXISTS (
           SELECT 1 FROM tt_lesson_plans lp
            WHERE lp.slot_id = t.slot_id AND lp.date = c.today
              AND (lp.subject_id = t.subject_id
                   OR (lp.subject_id IS NULL AND NOT t.from_optional_group))
              AND lp.status IN ('done','skipped')))::int
    INTO p_total, p_due, p_logged
    FROM today_eff t;

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
      'logged', p_logged, 'due', p_due, 'total', p_total,
      'pct', CASE WHEN p_due > 0 THEN round(p_logged*100.0/p_due, 1) END)
  );
  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_coord_cards() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_coord_cards() TO authenticated, service_role;
