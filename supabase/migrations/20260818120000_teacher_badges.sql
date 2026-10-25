-- Teacher badges: a real teacher catalog, with a server-side evaluator behind it.
--
-- BEFORE THIS FILE the teacher set was nine rows, six of which had zero holders
-- and could never gain one:
--   * Task Starter / Task Master / Task Champion read criteria_metric
--     'tasks_completed', which nothing computed.
--   * Speed Demon read 'tasks_on_time'. tasks carries no completion timestamp
--     (only updated_at, which any edit moves), so "on time" cannot be determined
--     honestly. Retired rather than faked.
--   * Student Mentor / Impact Creator read 'student_improvement_percent', which
--     is computed nowhere and never has been. Retired.
-- The three exam badges DID have holders (78 / 39 / 15) because a browser-side
-- awarder counted exams. That same awarder tried to count evaluations through
-- teacher_overrides.teacher_id, a column that does not exist, so every lookup
-- errored, was swallowed by the client, and scored 0 forever. Counting now
-- happens in the database, against columns verified against prod on 2026-08-17.
--
-- WHY A SEPARATE FUNCTION rather than extending evaluate_student_badges():
-- same reasoning as 20260815120000_homework_badges.sql. That function is 800
-- reviewed lines and re-emitting its whole body to add a teacher scope is how a
-- regression gets into verified SQL. This is additive: new catalog rows, one new
-- function, and triggers named trg_zz_* so they sort after any existing
-- trg_log_* / trg_z_* and the activity row is written first.
--
-- NO teacher streak and NO teacher legendary tier in this pass. There is no
-- teacher activity spine to hang a streak on, and a year-end award with no
-- computation behind it is exactly what produced the dead badges above.
--
-- Rungs are paced against measured per-teacher distributions (265 teachers,
-- 2026-08-17), quoted next to each ladder below, so every rung is reachable and
-- the top of each ladder is still unclaimed or nearly so.

-- ── 1. Rename the two mislabelled exam badges ───────────────────────────────
-- Label only. Same row, same id, same tier / points / criteria_value, so the
-- 78 + 39 live user_badges rows are untouched: they point at badge_id, not at
-- the name. Guarded on the destination name as well, because
-- badge_definitions_type_name_idx is UNIQUE on (badge_type, name) and a partial
-- earlier run could otherwise collide.
UPDATE badge_definitions bd
SET name = 'First Paper', updated_at = now()
WHERE bd.badge_type = 'teacher' AND bd.name = 'First Exam Creator'
  AND NOT EXISTS (SELECT 1 FROM badge_definitions x
                  WHERE x.badge_type = 'teacher' AND x.name = 'First Paper');

UPDATE badge_definitions bd
SET name = 'Paper Trail', updated_at = now()
WHERE bd.badge_type = 'teacher' AND bd.name = 'Prolific Examiner'
  AND NOT EXISTS (SELECT 1 FROM badge_definitions x
                  WHERE x.badge_type = 'teacher' AND x.name = 'Paper Trail');

-- ── 2. Retire the three uncomputable badges ─────────────────────────────────
-- Rows are kept, not deleted: any holder keeps the award and the points. They
-- simply stop being offered. Deactivating is also what keeps the evaluator from
-- ever matching them, since it filters on is_active.
UPDATE badge_definitions bd
SET is_active = false, updated_at = now()
WHERE bd.badge_type = 'teacher'
  AND bd.name IN ('Speed Demon', 'Student Mentor', 'Impact Creator')
  AND bd.is_active;

-- ── 3. The catalog ──────────────────────────────────────────────────────────
-- Written ONCE, as a CTE feeding both the insert and the re-assert, so the two
-- halves cannot drift from each other (the usual failure mode is editing the
-- INSERT list and forgetting the UPDATE list).
--
-- The UPDATE reads badge_definitions from the same snapshot as the INSERT, so it
-- cannot see rows the INSERT just created. That is correct and deliberate: those
-- rows were written from this very catalog and need no re-assert.
--
-- is_active is EXCLUDED from the re-assert. Retiring a badge is an admin
-- decision and must survive a re-run of this migration; everything else is
-- re-asserted so a dashboard hand-edit cannot desync the criteria from the
-- evaluator that reads them.
--
-- icon_name values are restricted to the keys src/components/badges/BadgeIcon.tsx
-- actually maps. Anything outside that map silently renders the Award fallback.
WITH cat (name, description, icon_name, category, tier,
          criteria_metric, criteria_value, points, display_order) AS (
  VALUES
    -- classroom. attendance: 55 teachers >= 1 day, 36 >= 10, 11 >= 30, max 76.
    --            lessons:    8 >= 1, 3 >= 10, max 31, so 50 is a real summit.
    ('Roll Call',           'Mark attendance for the first time',   'check-square',   'classroom',  'bronze',   'attendance_days_marked',   1,  10, 210),
    ('Register Keeper',     'Mark attendance on 10 days',           'clipboard',      'classroom',  'silver',   'attendance_days_marked',  10,  30, 211),
    ('Never Misses',        'Mark attendance on 30 days',           'calendar-check', 'classroom',  'gold',     'attendance_days_marked',  30,  70, 212),
    ('Lesson Logged',       'Complete your first lesson',           'book-open',      'classroom',  'bronze',   'lessons_taught',           1,  10, 213),
    ('Course Keeper',       'Complete 10 lessons',                  'library',        'classroom',  'silver',   'lessons_taught',          10,  35, 214),
    ('Syllabus Shepherd',   'Complete 50 lessons',                  'scroll-text',    'classroom',  'gold',     'lessons_taught',          50,  90, 215),

    -- assessment. 90 teachers >= 1 exam, 35 >= 10, 13 >= 25, 1 >= 50, max 67.
    ('First Paper',         'Create your first exam',               'file-plus',      'assessment', 'bronze',   'exams_created',            1,  15, 220),
    ('Paper Trail',         'Create 10 exams',                      'files',          'assessment', 'silver',   'exams_created',           10,  40, 221),
    ('Exam Architect',      'Create 25 exams',                      'building',       'assessment', 'gold',     'exams_created',           25,  80, 222),
    ('Question Master',     'Create 50 exams',                      'crown',          'assessment', 'platinum', 'exams_created',           50, 150, 223),

    -- marking. 34 teachers >= 1 answer, 25 >= 25, 16 >= 100, 6 >= 400, max 1512.
    ('Red Pen',             'Evaluate your first answer',           'notebook-pen',   'marking',    'bronze',   'answers_evaluated',        1,  10, 230),
    ('Marking Marathon',    'Evaluate 25 answers',                  'dumbbell',       'marking',    'silver',   'answers_evaluated',       25,  35, 231),
    ('Century of Scripts',  'Evaluate 100 answers',                 'target',         'marking',    'gold',     'answers_evaluated',      100,  75, 232),
    -- 200, not 400. Once the model's 6,998 rows stop counting, the busiest
    -- hand-marker in the school sits at 250 and only three teachers clear 100,
    -- so a 400 rung would be unreachable by anyone. Measured ladder after the
    -- filter: >=1: 20, >=25: 5, >=100: 3, >=200: 1.
    ('Marking Machine',     'Evaluate 200 answers',                 'zap',            'marking',    'platinum', 'answers_evaluated',      200, 150, 233),

    -- homework. set: 63 >= 1, 43 >= 5, 27 >= 15, max 117.
    --           marked: only 16 teachers >= 1 and 2 >= 5, so this ladder is two
    --           rungs and stops at 5. A 15 rung would be unreachable today.
    ('Homework Set',        'Set your first homework',              'clipboard-check','homework',   'bronze',   'homework_created',         1,  10, 240),
    ('Regular Setter',      'Set 5 pieces of homework',             'check-circle',   'homework',   'silver',   'homework_created',         5,  25, 241),
    ('Practice Architect',  'Set 15 pieces of homework',            'compass',        'homework',   'gold',     'homework_created',        15,  55, 242),
    ('Marked and Returned', 'Mark a homework assignment as checked','check-circle-2', 'homework',   'silver',   'homework_marked',          1,  20, 243),
    ('Feedback Loop',       'Mark 5 homework assignments as checked','rotate-ccw',    'homework',   'gold',     'homework_marked',          5,  60, 244),

    -- teamwork. 92 teachers have >= 1 completed task, 31 >= 5, max 15, hence the
    -- re-paced ladder: the old 20 / 50 rungs sat above what anyone has ever done.
    ('Task Starter',        'Complete your first task',             'play-circle',    'teamwork',   'bronze',   'tasks_completed',          1,  10, 250),
    ('Team Player',         'Complete 5 tasks',                     'users',          'teamwork',   'silver',   'tasks_completed',          5,  30, 251),
    ('Task Master',         'Complete 15 tasks',                    'users-2',        'teamwork',   'gold',     'tasks_completed',         15,  60, 252),
    ('Task Champion',       'Complete 30 tasks',                    'trophy',         'teamwork',   'platinum', 'tasks_completed',         30, 110, 253)
),
ins AS (
  INSERT INTO badge_definitions
    (name, description, icon_name, badge_type, category, tier,
     criteria_type, criteria_metric, criteria_value, points, is_active, display_order)
  SELECT c.name, c.description, c.icon_name, 'teacher', c.category, c.tier,
         'count', c.criteria_metric, c.criteria_value, c.points, true, c.display_order
  FROM cat c
  WHERE NOT EXISTS (
    SELECT 1 FROM badge_definitions bd
    WHERE bd.badge_type = 'teacher' AND bd.name = c.name
  )
  RETURNING id
)
UPDATE badge_definitions bd
SET description = c.description, icon_name = c.icon_name, category = c.category,
    tier = c.tier, criteria_type = 'count', criteria_metric = c.criteria_metric,
    criteria_value = c.criteria_value, points = c.points,
    display_order = c.display_order, updated_at = now()
FROM cat c
WHERE bd.badge_type = 'teacher' AND bd.name = c.name
  AND (bd.description, bd.icon_name, bd.category, bd.tier, bd.criteria_type,
       bd.criteria_metric, bd.criteria_value, bd.points, bd.display_order)
      IS DISTINCT FROM
      (c.description, c.icon_name, c.category, c.tier, 'count',
       c.criteria_metric, c.criteria_value, c.points, c.display_order);

-- ── 4. Supporting index ─────────────────────────────────────────────────────
-- attendance_days_marked is the only metric with no index behind its predicate:
-- attendance_records has indexes on (student_id, date) and (substitution_id) but
-- none on marked_by, so COUNT(DISTINCT date) WHERE marked_by = ? would seq-scan
-- the largest table in the schema on every trigger fire. (marked_by, date) also
-- backs the "was this day already counted" guard in the attendance trigger.
--
-- Plain CREATE INDEX, not CONCURRENTLY: a migration runs inside a transaction
-- and CONCURRENTLY is not allowed there. It takes a brief write lock on
-- attendance_records; apply outside school hours.
CREATE INDEX IF NOT EXISTS idx_attendance_records_marked_by_date
  ON public.attendance_records (marked_by, date)
  WHERE marked_by IS NOT NULL;

-- The other six metrics are already covered (verified against the migrations
-- that created them):
--   exams                 idx_exams_created_by (created_by)
--   homework_assignments  idx_homework_assignments_created_by / _evaluated_by
--   teacher_overrides     idx_teacher_overrides_evaluator (evaluated_by)
--   tt_lesson_plans       idx_tt_lesson_plans_owner_date (owner_teacher_id, date)
--   task_assignments      idx_task_assignments_assignee (assignee_id) + the
--                         UNIQUE index on task_id used by the completion trigger
--   tasks                 pkey, for the join
-- No index on badge_definitions on purpose: ~60 rows, pinned in shared_buffers,
-- a seq scan beats an index probe at that size.

-- ── 5. The evaluator ────────────────────────────────────────────────────────
-- Seven metrics, all lifetime counts. NOTE ON §24 (institution-local dates):
-- nothing here computes "today" or compares a wall clock. attendance_days_marked
-- counts DISTINCT values of the stored attendance_records.date column, which is
-- already the institution's local calendar date as written by the attendance
-- pass. There is no CURRENT_DATE, no now()::date and no timezone arithmetic in
-- this function, so there is nothing for a UTC boundary to shift.
-- _notify = false suppresses the per-badge notification insert. Only the
-- one-time backfill passes false: it awards ~430 badges across 265 teachers in
-- a single transaction, and per-badge notifications would greet a teacher with
-- ten unread items for work they did months ago. The backfill sends one summary
-- notification per teacher instead. Every live trigger uses the default.
CREATE OR REPLACE FUNCTION public.evaluate_teacher_badges(
  _user_id uuid,
  _notify  boolean DEFAULT true
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst       uuid;
  v_attendance int := 0;
  v_lessons    int := 0;
  v_exams      int := 0;
  v_answers    int := 0;
  v_hw_created int := 0;
  v_hw_marked  int := 0;
  v_tasks      int := 0;
  v_new_ids    uuid[] := ARRAY[]::uuid[];
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;

  -- These are badge_type = 'teacher'. Admins and coordinators also create exams
  -- and mark attendance; they should not collect a teacher ladder. user_roles is
  -- the authority, and holding the teacher role alongside another one qualifies.
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'teacher'
  ) THEN
    RETURN 0;
  END IF;

  -- DISTINCT DATES, not rows. Marking one class of 40 students is one day of
  -- work, not 40; counting rows would hand out Never Misses on the first save.
  SELECT count(DISTINCT ar.date)::int INTO v_attendance
  FROM attendance_records ar
  WHERE ar.marked_by = _user_id;

  SELECT count(*)::int INTO v_lessons
  FROM tt_lesson_plans lp
  WHERE lp.owner_teacher_id = _user_id AND lp.status = 'done';

  -- No status filter: the metric is exams CREATED. A paper that was written and
  -- then never published is still a paper the teacher wrote, and the AFTER
  -- INSERT trigger below fires at exactly the moment this count moves.
  SELECT count(*)::int INTO v_exams
  FROM exams e
  WHERE e.created_by = _user_id;

  -- evaluated_by, NOT teacher_id. teacher_overrides has no teacher_id column;
  -- querying one is what made this metric read 0 for every teacher for months.
  --
  -- accepted_ai_suggestion = false is the "a human made the marking decision"
  -- test, and it is NOT the same as is_auto_graded = false. Measured over all
  -- 7,755 override rows in prod on 2026-08-18:
  --   auto=t acc=t  6,980  auto-grade-submission wrote the mark        -> machine
  --   auto=f acc=f    647  teacher marked from scratch                 -> human
  --   auto=f acc=t    110  teacher bulk-pressed "accept AI suggestion" -> machine
  --   auto=t acc=f     18  AI marked it, teacher then overrode it      -> human
  -- Filtering on is_auto_graded would keep the 110 button-presses and discard
  -- the 18 genuine corrections. 90% of this table is the model's work: counting
  -- it would have handed platinum "Marking Machine" to teachers who hand-marked
  -- nothing. Badges are irreversible here, so this errs toward under-counting.
  SELECT count(*)::int INTO v_answers
  FROM teacher_overrides t
  WHERE t.evaluated_by = _user_id
    AND NOT COALESCE(t.accepted_ai_suggestion, false);

  -- homework_assignments, not "homework": there is no table by that name.
  SELECT count(*)::int INTO v_hw_created
  FROM homework_assignments h
  WHERE h.created_by = _user_id;

  SELECT count(*)::int INTO v_hw_marked
  FROM homework_assignments h
  WHERE h.evaluated_by = _user_id;

  -- 'completed' is the only done state in prod. done_pending_approval is still
  -- waiting on someone else, so it is not the teacher's task finished yet.
  -- Multi-assignee work is FAN-OUT (N tasks rows sharing task_group_id, one
  -- assignment row each), so counting assignment rows counts people correctly.
  SELECT count(*)::int INTO v_tasks
  FROM task_assignments ta
  JOIN tasks tk ON tk.id = ta.task_id
  WHERE ta.assignee_id = _user_id AND tk.status = 'completed';

  IF GREATEST(v_attendance, v_lessons, v_exams, v_answers,
              v_hw_created, v_hw_marked, v_tasks) = 0 THEN
    RETURN 0;
  END IF;

  SELECT p.institution_id INTO v_inst FROM profiles p WHERE p.id = _user_id;

  -- Awards and progress in ONE statement off one metrics tuple, so the two can
  -- never disagree about what the teacher's numbers are. Both CTEs are
  -- data-modifying and therefore both execute, whether or not the outer query
  -- references them.
  WITH m (metric, val) AS (
    VALUES ('attendance_days_marked'::text, v_attendance),
           ('lessons_taught',               v_lessons),
           ('exams_created',                v_exams),
           ('answers_evaluated',            v_answers),
           ('homework_created',             v_hw_created),
           ('homework_marked',              v_hw_marked),
           ('tasks_completed',              v_tasks)
  ),
  tb AS (
    SELECT bd.id, bd.criteria_metric, bd.criteria_value, m.val
    FROM badge_definitions bd
    JOIN m ON m.metric = bd.criteria_metric
    WHERE bd.is_active AND bd.badge_type = 'teacher'
  ),
  ins AS (
    INSERT INTO user_badges
      (user_id, badge_id, institution_id, source_entity_type, metadata)
    SELECT _user_id, tb.id, v_inst, tb.criteria_metric,
           jsonb_build_object('count', tb.val)
    FROM tb
    WHERE tb.val >= tb.criteria_value
    -- Bare DO NOTHING: the guard is the expression index
    -- user_badges_once_per_period_idx (user_id, badge_id, COALESCE(period_key,'')),
    -- which cannot be named as a conflict target by column list.
    ON CONFLICT DO NOTHING
    RETURNING id
  ),
  prog AS (
    INSERT INTO badge_progress
      (user_id, badge_id, institution_id, current_value, target_value, last_updated)
    -- Every rung, earned or not, so an unearned tile reads "10 of 25" instead of
    -- a bar frozen at zero.
    SELECT _user_id, tb.id, v_inst, tb.val, tb.criteria_value, now()
    FROM tb
    ON CONFLICT (user_id, badge_id) DO UPDATE
      SET current_value  = EXCLUDED.current_value,
          target_value   = EXCLUDED.target_value,
          institution_id = EXCLUDED.institution_id,
          last_updated   = now()
    RETURNING 1
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_new_ids FROM ins;

  -- Notifications in their OWN subtransaction, AFTER the award has landed. When
  -- these shared a statement with the award, a notifications failure rolled the
  -- award back with it, so the notification path could revoke a badge.
  IF _notify AND array_length(v_new_ids, 1) IS NOT NULL THEN
    BEGIN
      INSERT INTO notifications (user_id, type, title, message, link, metadata)
      SELECT ub.user_id, 'badge_earned',
             'Badge earned: ' || bd.name,
             'You earned the "' || bd.name || '" badge (+' || bd.points || ' points).',
             '/achievements',
             jsonb_build_object('badge_id', bd.id, 'badge_name', bd.name, 'points', bd.points)
      FROM user_badges ub
      JOIN badge_definitions bd ON bd.id = ub.badge_id
      WHERE ub.id = ANY (v_new_ids);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'evaluate_teacher_badges: awards committed, notifications failed: %', SQLERRM;
    END;
  END IF;

  RETURN COALESCE(array_length(v_new_ids, 1), 0);
END $$;

-- ── 6. Triggers ─────────────────────────────────────────────────────────────
-- All of them are named trg_zz_* so they sort after any existing trg_log_* /
-- trg_z_* on the same table: Postgres fires same-timing triggers in alphabetical
-- order by NAME, and the activity / audit row should exist before the badge run.
--
-- Every one of them wraps its whole body in BEGIN / EXCEPTION WHEN OTHERS /
-- RAISE WARNING. A badge fault must NEVER roll back a teacher's exam, marking,
-- homework or attendance write: the work is the thing that matters, the badge is
-- decoration. The handler covers the driving query too, not just the PERFORM, so
-- even a broken transition-table read cannot take the write down with it.

-- 6a. exams. One insert per exam creation, so row-level is already one call per
--     event. exams_created has no status filter, so INSERT is the only moment
--     the count can move and no UPDATE trigger is needed.
CREATE OR REPLACE FUNCTION public.tg_zz_teacher_badges_exam()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.evaluate_teacher_badges(NEW.created_by);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_zz_teacher_badges_exam failed for %: %', NEW.created_by, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_exam ON public.exams;
CREATE TRIGGER trg_zz_teacher_badges_exam
AFTER INSERT ON public.exams
FOR EACH ROW WHEN (NEW.created_by IS NOT NULL)
EXECUTE FUNCTION public.tg_zz_teacher_badges_exam();

-- 6b. homework_assignments, creation side. evaluated_by is normally NULL at
--     insert, but the offline-marks path can land a row that is already checked,
--     so both columns are resolved here and de-duplicated against each other.
CREATE OR REPLACE FUNCTION public.tg_zz_teacher_badges_homework()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF NEW.created_by IS NOT NULL THEN
      PERFORM public.evaluate_teacher_badges(NEW.created_by);
    END IF;
    IF NEW.evaluated_by IS NOT NULL
       AND NEW.evaluated_by IS DISTINCT FROM NEW.created_by THEN
      PERFORM public.evaluate_teacher_badges(NEW.evaluated_by);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_zz_teacher_badges_homework failed for %: %', NEW.created_by, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_homework ON public.homework_assignments;
CREATE TRIGGER trg_zz_teacher_badges_homework
AFTER INSERT ON public.homework_assignments
FOR EACH ROW WHEN (NEW.created_by IS NOT NULL OR NEW.evaluated_by IS NOT NULL)
EXECUTE FUNCTION public.tg_zz_teacher_badges_homework();

-- 6c. homework_assignments, marking side. ADDITION beyond an insert-only trigger,
--     and a necessary one: homework_assignments.evaluated_by is written by the
--     UPDATE that flips an assignment to checked, never at insert. Without this
--     trigger, Marked and Returned and Feedback Loop would only ever move during
--     the backfill below, which is precisely how a badge ends up with 0 holders.
--     The WHEN clause is evaluated in C without entering plpgsql, so an
--     unrelated homework edit costs nothing.
CREATE OR REPLACE FUNCTION public.tg_zz_teacher_badges_homework_marked()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.evaluate_teacher_badges(NEW.evaluated_by);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_zz_teacher_badges_homework_marked failed for %: %', NEW.evaluated_by, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_homework_marked ON public.homework_assignments;
CREATE TRIGGER trg_zz_teacher_badges_homework_marked
AFTER UPDATE OF evaluated_by ON public.homework_assignments
FOR EACH ROW WHEN (NEW.evaluated_by IS NOT NULL
                   AND NEW.evaluated_by IS DISTINCT FROM OLD.evaluated_by)
EXECUTE FUNCTION public.tg_zz_teacher_badges_homework_marked();

-- 6d. teacher_overrides. Statement-level with a transition table: marking a
--     paper can insert one override per answer in a single statement, and the
--     busiest row-owner already has 1,512 rows. Row-level would run the seven
--     aggregates once per answer.
--
--     Auto-graded rows do NOT carry evaluated_by = NULL. auto-grade-submission
--     (index.ts:546) writes evaluated_by = the caller who pressed the button,
--     so the discriminator is accepted_ai_suggestion, matching the aggregate in
--     section 5. Filtering here means a 300-answer auto-grade never enters the
--     loop at all, and the evaluator only runs when a human actually decided a
--     mark.
CREATE OR REPLACE FUNCTION public.tg_zz_teacher_badges_override()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  BEGIN
    FOR r IN
      SELECT DISTINCT n.evaluated_by AS teacher_id
      FROM newrows n
      WHERE n.evaluated_by IS NOT NULL
        AND NOT COALESCE(n.accepted_ai_suggestion, false)
    LOOP
      PERFORM public.evaluate_teacher_badges(r.teacher_id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_zz_teacher_badges_override failed: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_override ON public.teacher_overrides;
CREATE TRIGGER trg_zz_teacher_badges_override
AFTER INSERT ON public.teacher_overrides
REFERENCING NEW TABLE AS newrows
FOR EACH STATEMENT
EXECUTE FUNCTION public.tg_zz_teacher_badges_override();

-- The UPDATE half is not optional. Correcting an AI grade is the single most
-- important event this ladder measures, and useEvaluations.ts:270-284 does it
-- with an UPDATE of the existing row (an override already exists, because the
-- auto-grader wrote one). INSERT-only would mean the one action we most want to
-- reward never moves the ladder. Same function, same transition-table shape;
-- rows re-saved by the auto-grader's ON CONFLICT path carry
-- accepted_ai_suggestion = true and are filtered out inside it, so this costs
-- nothing on the machine path.
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_override_upd ON public.teacher_overrides;
CREATE TRIGGER trg_zz_teacher_badges_override_upd
AFTER UPDATE ON public.teacher_overrides
REFERENCING NEW TABLE AS newrows
FOR EACH STATEMENT
EXECUTE FUNCTION public.tg_zz_teacher_badges_override();

-- 6e. tt_lesson_plans. Two triggers, one function. record_syllabus_progress
--     writes the lesson with INSERT ... ON CONFLICT (slot_id, date) DO UPDATE
--     SET status = 'done', so a lesson becomes done through the INSERT path on a
--     fresh slot and through the UPDATE path on a slot that was already planned.
--     An insert-only trigger would miss every lesson that had been timetabled in
--     advance, which is most of them.
CREATE OR REPLACE FUNCTION public.tg_zz_teacher_badges_lesson()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.evaluate_teacher_badges(NEW.owner_teacher_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_zz_teacher_badges_lesson failed for %: %', NEW.owner_teacher_id, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_lesson ON public.tt_lesson_plans;
CREATE TRIGGER trg_zz_teacher_badges_lesson
AFTER INSERT ON public.tt_lesson_plans
FOR EACH ROW WHEN (NEW.status = 'done' AND NEW.owner_teacher_id IS NOT NULL)
EXECUTE FUNCTION public.tg_zz_teacher_badges_lesson();

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_lesson_done ON public.tt_lesson_plans;
CREATE TRIGGER trg_zz_teacher_badges_lesson_done
AFTER UPDATE OF status ON public.tt_lesson_plans
FOR EACH ROW WHEN (NEW.status = 'done'
                   AND OLD.status IS DISTINCT FROM 'done'
                   AND NEW.owner_teacher_id IS NOT NULL)
EXECUTE FUNCTION public.tg_zz_teacher_badges_lesson();

-- 6f. attendance_records. HOT TABLE, and the guard matters here.
--
--     What was chosen: statement-level with a NEW transition table, plus a
--     "was this day already counted" filter, so the evaluator runs AT MOST once
--     per teacher per statement and usually not at all.
--
--     Why: saving one class is a single multi-row INSERT of ~40 rows that all
--     share marked_by and date. Row-level would run seven aggregates 40 times to
--     discover the same one new day 40 times. Statement-level collapses that to
--     one pass. The second filter then compares how many rows this teacher now
--     has for that date against how many of them this statement just inserted:
--     if the table already held rows for that (teacher, date) pair beforehand,
--     the day was already counted, COUNT(DISTINCT date) cannot have moved, and
--     the evaluator is skipped entirely. That also absorbs the case of a client
--     that inserts the roster one row per statement, where the transition table
--     holds a single row and only the very first row of the day does real work.
--     Both halves of the filter ride idx_attendance_records_marked_by_date.
--
--     INSERT only, deliberately: re-saving a day arrives as ON CONFLICT DO
--     UPDATE, and re-marking a day the teacher already marked adds no new
--     distinct date. The first save of any day is always an INSERT.
--     Rows written by the auto-mark pass carry marked_by = NULL and are skipped.
CREATE OR REPLACE FUNCTION public.tg_zz_teacher_badges_attendance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  BEGIN
    FOR r IN
      SELECT DISTINCT g.teacher_id
      FROM (
        SELECT n.marked_by AS teacher_id, n.date AS on_date, count(*)::int AS new_rows
        FROM newrows n
        WHERE n.marked_by IS NOT NULL
        GROUP BY n.marked_by, n.date
      ) g
      WHERE (
        SELECT count(*) FROM attendance_records ar
        WHERE ar.marked_by = g.teacher_id AND ar.date = g.on_date
      ) <= g.new_rows
    LOOP
      PERFORM public.evaluate_teacher_badges(r.teacher_id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_zz_teacher_badges_attendance failed: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_attendance ON public.attendance_records;
CREATE TRIGGER trg_zz_teacher_badges_attendance
AFTER INSERT ON public.attendance_records
REFERENCING NEW TABLE AS newrows
FOR EACH STATEMENT
EXECUTE FUNCTION public.tg_zz_teacher_badges_attendance();

-- 6g. task_assignments. HOT TABLE, and the cheap path is the only path.
--
--     What was chosen: statement-level with a NEW transition table, and the
--     guard lives in the driving query itself: it joins tasks and keeps only
--     assignments whose task is ALREADY 'completed'.
--
--     Why: an assignment is created when the task is created, and a brand new
--     task is 'open'. So in normal use this query returns zero rows and the
--     evaluator is never called at all, including for a multi-assignee fan-out
--     that writes N assignment rows in one statement. It still catches the one
--     case where an insert genuinely changes the count: an already-completed
--     task being imported or re-assigned.
CREATE OR REPLACE FUNCTION public.tg_zz_teacher_badges_task_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  BEGIN
    FOR r IN
      SELECT DISTINCT n.assignee_id AS teacher_id
      FROM newrows n
      JOIN tasks tk ON tk.id = n.task_id
      WHERE n.assignee_id IS NOT NULL AND tk.status = 'completed'
    LOOP
      PERFORM public.evaluate_teacher_badges(r.teacher_id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_zz_teacher_badges_task_assignment failed: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_task_assignment ON public.task_assignments;
CREATE TRIGGER trg_zz_teacher_badges_task_assignment
AFTER INSERT ON public.task_assignments
REFERENCING NEW TABLE AS newrows
FOR EACH STATEMENT
EXECUTE FUNCTION public.tg_zz_teacher_badges_task_assignment();

-- 6h. tasks completion. ADDITION beyond the insert-only trigger above, and the
--     one that actually awards the teamwork ladder: a task is completed by an
--     UPDATE of tasks.status, which no trigger on task_assignments can observe.
--     Row-level with a WHEN clause on the transition into 'completed', so every
--     other task edit (title, due date, priority, a move to in_progress) never
--     enters plpgsql. The assignee is read through task_assignments, whose
--     task_id is NOT NULL UNIQUE: one row per task, by the fan-out design.
CREATE OR REPLACE FUNCTION public.tg_zz_teacher_badges_task_completed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_assignee uuid;
BEGIN
  BEGIN
    SELECT ta.assignee_id INTO v_assignee
    FROM task_assignments ta
    WHERE ta.task_id = NEW.id;

    IF v_assignee IS NOT NULL THEN
      PERFORM public.evaluate_teacher_badges(v_assignee);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_zz_teacher_badges_task_completed failed for task %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_task_completed ON public.tasks;
CREATE TRIGGER trg_zz_teacher_badges_task_completed
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW WHEN (NEW.status = 'completed'
                   AND OLD.status IS DISTINCT FROM 'completed')
EXECUTE FUNCTION public.tg_zz_teacher_badges_task_completed();

-- ── 7. Backfill ─────────────────────────────────────────────────────────────
-- Teachers earned all of this before the badges existed. Awarding retroactively
-- is the honest outcome; the alternative is telling the 90 teachers who have
-- created an exam, or the one who has evaluated 1,512 answers, that they have
-- done nothing. Runs after the index above so the attendance probe is cheap.
--
-- Bounded by construction: user_roles has 265 teacher rows, and each iteration
-- is seven index-backed aggregates. The EXISTS pre-filter skips teachers with no
-- activity at all so they do not accumulate seven zero-valued progress rows.
DO $$
DECLARE r record; v_total int := 0; v_seen int := 0; v_n int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ur.user_id AS id
    FROM user_roles ur
    WHERE ur.role = 'teacher'
      AND (
           EXISTS (SELECT 1 FROM exams e                WHERE e.created_by = ur.user_id)
        OR EXISTS (SELECT 1 FROM homework_assignments h WHERE h.created_by = ur.user_id)
        OR EXISTS (SELECT 1 FROM homework_assignments h WHERE h.evaluated_by = ur.user_id)
        OR EXISTS (SELECT 1 FROM teacher_overrides t    WHERE t.evaluated_by = ur.user_id
                                                          AND NOT COALESCE(t.accepted_ai_suggestion, false))
        OR EXISTS (SELECT 1 FROM tt_lesson_plans lp     WHERE lp.owner_teacher_id = ur.user_id
                                                          AND lp.status = 'done')
        OR EXISTS (SELECT 1 FROM attendance_records ar  WHERE ar.marked_by = ur.user_id)
        OR EXISTS (SELECT 1 FROM task_assignments ta
                   JOIN tasks tk ON tk.id = ta.task_id
                   WHERE ta.assignee_id = ur.user_id AND tk.status = 'completed')
      )
  LOOP
    v_seen  := v_seen + 1;
    -- _notify = false: one summary per teacher below, not one per badge.
    v_n     := public.evaluate_teacher_badges(r.id, false);
    v_total := v_total + v_n;

    IF v_n > 0 THEN
      BEGIN
        INSERT INTO notifications (user_id, type, title, message, link, metadata)
        VALUES (
          r.id, 'badge_earned',
          'You have ' || v_n || CASE WHEN v_n = 1 THEN ' new teaching badge'
                                     ELSE ' new teaching badges' END,
          'Your teaching work so far has been recognised. Open Achievements to see '
            || CASE WHEN v_n = 1 THEN 'it.' ELSE 'them.' END,
          '/achievements',
          jsonb_build_object('backfill', true, 'awarded', v_n)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'teacher badge backfill: awards committed, summary notification failed for %: %', r.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  RAISE NOTICE 'teacher badge backfill: % teachers evaluated, % badges awarded', v_seen, v_total;
END $$;

-- ── 8. Grants ───────────────────────────────────────────────────────────────
-- Server-only, every one of them. FROM PUBLIC comes first and is the part that
-- actually matters: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to PUBLIC
-- on every new function in public, and anon inherits through PUBLIC, so revoking
-- the roles by name alone leaves the function callable (see 20260813145000).
-- Trigger functions still fire after this: Postgres checks EXECUTE on a trigger
-- function when the trigger is CREATED, not when it fires.
-- Signature is (uuid, boolean) since the _notify parameter. Revoking the wrong
-- signature is not an error in Postgres only when the function exists; naming a
-- non-existent one raises, so a typo here fails loudly rather than silently
-- leaving the evaluator world-callable.
REVOKE ALL ON FUNCTION public.evaluate_teacher_badges(uuid, boolean)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_zz_teacher_badges_exam()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_zz_teacher_badges_homework()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_zz_teacher_badges_homework_marked()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_zz_teacher_badges_override()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_zz_teacher_badges_lesson()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_zz_teacher_badges_attendance()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_zz_teacher_badges_task_assignment()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_zz_teacher_badges_task_completed()    FROM PUBLIC, anon, authenticated;
