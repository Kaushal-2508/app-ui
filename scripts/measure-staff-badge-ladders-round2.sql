-- Step 0 for 20260904160000_assessment_marking_teamwork_badges.sql.
-- Full runbook: docs/superpowers/plans/2026-09-04-classroom-badges-db-rollout.md (§10+)
--
-- Read-only. Run BEFORE applying that migration and re-pace its catalog CTE.
--
--   powershell -File scripts/run-sql.ps1 -SqlFile scripts/measure-staff-badge-ladders-round2.sql -OutFile "$env:TEMP\ladders2.json"
--
-- Result set 1: one row per metric, how many staff have >= 1 / 5 / 10 / 25 / 50 / 200
-- and the max, using EXACTLY the evaluator's predicates.
-- Result set 2: preconditions (all must be true).

WITH staff AS (
  SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.role IN ('teacher','coordinator')
),
m AS (
  SELECT 'exams_published' AS metric, e.created_by AS uid, count(*)::int AS n
  FROM exams e JOIN staff s ON s.user_id = e.created_by
  WHERE e.status IN ('published','active','completed') GROUP BY e.created_by
  UNION ALL
  SELECT 'questions_authored', q.created_by, count(*)::int
  FROM question_bank q JOIN staff s ON s.user_id = q.created_by
  WHERE q.source = 'manual' GROUP BY q.created_by
  UNION ALL
  SELECT 'ai_questions_saved', q.created_by, count(*)::int
  FROM question_bank q JOIN staff s ON s.user_id = q.created_by
  WHERE q.source = 'ai_generated' GROUP BY q.created_by
  UNION ALL
  SELECT 'templates_created', t.created_by, count(*)::int
  FROM exam_templates t JOIN staff s ON s.user_id = t.created_by GROUP BY t.created_by
  UNION ALL
  SELECT 'templates_shared', t.created_by, count(*)::int
  FROM exam_templates t JOIN staff s ON s.user_id = t.created_by
  WHERE t.is_shared GROUP BY t.created_by
  UNION ALL
  SELECT 'results_published', x.uid, count(DISTINCT x.exam_id)::int
  FROM (
    SELECT fr.finalized_by AS uid, sea.exam_id FROM final_results fr
    JOIN student_exam_attempts sea ON sea.id = fr.attempt_id
    UNION
    SELECT fr.published_by, sea.exam_id FROM final_results fr
    JOIN student_exam_attempts sea ON sea.id = fr.attempt_id
  ) x JOIN staff s ON s.user_id = x.uid
  WHERE x.uid IS NOT NULL GROUP BY x.uid
  UNION ALL
  SELECT 'students_remarked', r.teacher_id, count(DISTINCT r.student_id)::int
  FROM student_remarks r JOIN staff s ON s.user_id = r.teacher_id GROUP BY r.teacher_id
  UNION ALL
  SELECT 'substitutions_covered', su.substitute_teacher_id, count(*)::int
  FROM tt_substitutions su JOIN staff s ON s.user_id = su.substitute_teacher_id
  WHERE su.status IN ('assigned','completed') GROUP BY su.substitute_teacher_id
  UNION ALL
  SELECT 'leave_reviews_done', lr.reviewed_by, count(*)::int
  FROM leave_requests lr JOIN staff s ON s.user_id = lr.reviewed_by
  WHERE lr.status IN ('approved','rejected') AND lr.source = 'student' GROUP BY lr.reviewed_by
)
SELECT metric,
       count(*) FILTER (WHERE n >= 1)   AS ge_1,
       count(*) FILTER (WHERE n >= 5)   AS ge_5,
       count(*) FILTER (WHERE n >= 10)  AS ge_10,
       count(*) FILTER (WHERE n >= 25)  AS ge_25,
       count(*) FILTER (WHERE n >= 50)  AS ge_50,
       count(*) FILTER (WHERE n >= 200) AS ge_200,
       max(n) AS max_n
FROM m
GROUP BY metric
ORDER BY metric;

-- Preconditions.
SELECT
  EXISTS (SELECT 1 FROM badge_definitions WHERE criteria_metric = 'lessons_planned_ahead')
    AS round2_migration_applied,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'leave_requests' AND column_name = 'source')
    AS leave_requests_source_exists,
  position('IN (''teacher'', ''coordinator'')' IN
           pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure)) > 0
    AS evaluator_admits_coordinators,
  (SELECT array_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum
   WHERE enumtypid = 'public.exam_status'::regtype) AS exam_status_values;
