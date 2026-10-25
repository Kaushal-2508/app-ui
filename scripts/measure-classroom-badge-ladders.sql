-- Step 0 for 20260904150000_classroom_planning_syllabus_badges.sql.
-- Full runbook: docs/superpowers/plans/2026-09-04-classroom-badges-db-rollout.md
--
-- Read-only. Run through the Management API (prod-operations skill §1) BEFORE
-- applying the migration, and re-pace the two ladders in its catalog CTE so the
-- bronze rung is reachable on day one and the gold rung is a real summit.
--
--   powershell -File scripts/run-sql.ps1 -SqlFile scripts/measure-classroom-badge-ladders.sql -OutFile "$env:TEMP\ladders.json"
--
-- Four result sets, in order:
--   1+2. one row per metric: how many staff have >= 1 / 5 / 10 / 20 / 40, and the max
--   3.   coordinator_only_users: size of the group the widened role guard admits
--   4.   live_evaluator_has_note_only_patch: MUST be true before applying

-- 1. lessons_planned_ahead: per owner, lessons whose planned_at (institution
--    local date) precedes the period date. Same predicate as the evaluator.
WITH per_teacher AS (
  SELECT lp.owner_teacher_id, count(*)::int AS n
  FROM tt_lesson_plans lp
  JOIN institutions i ON i.id = lp.institution_id
  WHERE lp.owner_teacher_id IS NOT NULL
    AND lp.planned_at IS NOT NULL
    AND (lp.planned_at AT TIME ZONE i.timezone)::date < lp.date
    AND lp.session_type = 'teaching'
    AND NOT lp.is_note_only
    AND lp.topic_id IS NOT NULL
  GROUP BY lp.owner_teacher_id
)
SELECT 'lessons_planned_ahead' AS metric,
       count(*) FILTER (WHERE n >= 1)  AS ge_1,
       count(*) FILTER (WHERE n >= 5)  AS ge_5,
       count(*) FILTER (WHERE n >= 10) AS ge_10,
       count(*) FILTER (WHERE n >= 20) AS ge_20,
       count(*) FILTER (WHERE n >= 40) AS ge_40,
       max(n) AS max_n
FROM per_teacher

UNION ALL

-- 2. syllabus_topics_completed: per recorder, DISTINCT chapters completed.
SELECT 'syllabus_topics_completed',
       count(*) FILTER (WHERE n >= 1),
       count(*) FILTER (WHERE n >= 5),
       count(*) FILTER (WHERE n >= 10),
       count(*) FILTER (WHERE n >= 20),
       count(*) FILTER (WHERE n >= 40),
       max(n)
FROM (
  SELECT e.recorded_by, count(DISTINCT e.topic_id)::int AS n
  FROM syllabus_progress_events e
  WHERE e.recorded_by IS NOT NULL AND e.action = 'completed'
  GROUP BY e.recorded_by
) t;

-- 3. Who the widened role guard admits: coordinator-only users with any activity.
SELECT count(DISTINCT ur.user_id) AS coordinator_only_users
FROM user_roles ur
WHERE ur.role = 'coordinator'
  AND NOT EXISTS (SELECT 1 FROM user_roles t WHERE t.user_id = ur.user_id AND t.role = 'teacher');

-- 4. Precondition: the evaluator body must already carry the 20260902120000 patch.
SELECT position('AND lp.session_type = ''teaching''' IN
                pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure)) > 0
       AS live_evaluator_has_note_only_patch;
