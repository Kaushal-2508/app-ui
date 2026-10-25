-- Server-side aggregation for the School Analytics dashboard (Detailed Analytics
-- tab / useSchoolAnalytics). The frontend previously fetched every attempt +
-- result via `.in("exam_id", [all exam ids])`; a school with hundreds of exams
-- (Alliance: 746) produced a >25 KB URL that exceeded PostgREST's limit, the
-- request 400'd, the error was swallowed, and every evaluation/performance
-- number collapsed to 0. This computes the same aggregates in SQL — no URL
-- bomb, no silent 1000-row cap, no client-side reduce over thousands of rows.

CREATE OR REPLACE FUNCTION public.get_school_exam_analytics(_institution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Authz: platform super admin, or a school admin of THIS institution.
  IF NOT (
    public.has_role((select auth.uid()), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = (select auth.uid())
        AND ur.institution_id = _institution_id
        AND ur.role IN ('school_admin', 'super_school_admin')
    )
  ) THEN
    RAISE EXCEPTION 'not authorized for institution analytics';
  END IF;

  WITH ex AS (
    SELECT id, status::text AS status
    FROM exams WHERE institution_id = _institution_id
  ),
  att AS (
    SELECT a.id, a.class_id, a.is_submitted, a.evaluation_status::text AS evaluation_status
    FROM student_exam_attempts a
    WHERE a.exam_id IN (SELECT id FROM ex)
  ),
  fr AS (
    -- final_results.attempt_id carries a UNIQUE constraint, so this is 1:1
    -- today; DISTINCT ON is defense-in-depth (mirrors the ps de-dup) so a
    -- future non-upsert write path can never fan-out and inflate the averages.
    SELECT DISTINCT ON (f.attempt_id) f.attempt_id, f.percentage, f.is_pass
    FROM final_results f
    WHERE f.attempt_id IN (SELECT id FROM att)
    ORDER BY f.attempt_id
  ),
  ps AS (
    SELECT p.attempt_id,
           bool_or(p.requires_review) AS requires_review,
           bool_or(p.review_status = 'reviewed') AS reviewed,
           bool_or(p.review_status = 'pending') AS review_pending,
           sum(COALESCE(p.high_severity_events, 0)) AS high_sev
    FROM proctoring_sessions p
    WHERE p.attempt_id IN (SELECT id FROM att)
    GROUP BY p.attempt_id
  ),
  cls AS (
    SELECT id, name, section FROM classes
    WHERE institution_id = _institution_id AND is_active
  ),
  class_perf AS (
    SELECT c.id AS class_id, c.name, c.section,
      -- Submitted attempts only — an unsubmitted (abandoned) attempt is not an
      -- "attempt" the dashboard should count, and this keeps the class/section
      -- totals consistent with the on-demand drill-down (which filters
      -- is_submitted) rather than showing a larger, unreconcilable number.
      count(a.id) FILTER (WHERE a.is_submitted) AS total_attempts,
      count(a.id) FILTER (WHERE a.is_submitted AND a.evaluation_status = 'pending') AS pending_eval,
      count(a.id) FILTER (WHERE ps.requires_review) AS integrity_flags,
      COALESCE(avg(f.percentage) FILTER (WHERE f.attempt_id IS NOT NULL), 0) AS avg_score,
      CASE WHEN count(f.attempt_id) > 0
        THEN (count(*) FILTER (WHERE f.is_pass))::numeric / count(f.attempt_id) * 100
        ELSE 0 END AS pass_rate
    FROM cls c
    LEFT JOIN att a ON a.class_id = c.id
    LEFT JOIN fr f ON f.attempt_id = a.id
    LEFT JOIN ps ON ps.attempt_id = a.id
    GROUP BY c.id, c.name, c.section
  )
  SELECT jsonb_build_object(
    'overview', jsonb_build_object(
      'totalTeachers', (SELECT count(*) FROM user_roles WHERE institution_id = _institution_id AND role = 'teacher'),
      'totalStudents', (SELECT count(*) FROM user_roles WHERE institution_id = _institution_id AND role = 'student'),
      'totalClasses', (SELECT count(*) FROM cls),
      'totalExams', (SELECT count(*) FROM ex)
    ),
    'examHealth', jsonb_build_object(
      'total',     (SELECT count(*) FROM ex),
      'draft',     (SELECT count(*) FROM ex WHERE status = 'draft'),
      'published', (SELECT count(*) FROM ex WHERE status = 'published'),
      'active',    (SELECT count(*) FROM ex WHERE status = 'active'),
      'completed', (SELECT count(*) FROM ex WHERE status = 'completed'),
      'archived',  (SELECT count(*) FROM ex WHERE status = 'archived')
    ),
    'evaluationMetrics', (
      SELECT jsonb_build_object(
        'totalSubmitted', count(*) FILTER (WHERE is_submitted),
        -- "Evaluated" = any submitted attempt past 'pending' (ai_evaluated,
        -- teacher_reviewed, finalized). Counting only 'finalized' understated
        -- progress badly (5757 teacher-reviewed attempts read as pending).
        'totalEvaluated', count(*) FILTER (WHERE is_submitted AND evaluation_status <> 'pending'),
        'pending', count(*) FILTER (WHERE is_submitted AND evaluation_status = 'pending'),
        'evaluationRate', CASE WHEN count(*) FILTER (WHERE is_submitted) > 0
          THEN count(*) FILTER (WHERE is_submitted AND evaluation_status <> 'pending')::numeric
               / count(*) FILTER (WHERE is_submitted) * 100
          ELSE 0 END
      ) FROM att
    ),
    'performanceMetrics', (
      SELECT jsonb_build_object(
        'overallPassRate', CASE WHEN count(*) > 0
          THEN (count(*) FILTER (WHERE is_pass))::numeric / count(*) * 100 ELSE 0 END,
        'averageScore', COALESCE(avg(percentage), 0)
      ) FROM fr
    ),
    'proctoringStats', (
      SELECT jsonb_build_object(
        'totalSessions', count(*),
        'flaggedSessions', count(*) FILTER (WHERE requires_review),
        'reviewedSessions', count(*) FILTER (WHERE reviewed),
        'pendingReview', count(*) FILTER (WHERE review_pending),
        'highSeverityEvents', COALESCE(sum(high_sev), 0)
      ) FROM ps
    ),
    'classPerformance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'classId', class_id,
        'name', name,
        'section', section,
        'totalAttempts', total_attempts,
        'avgScore', round(avg_score::numeric, 2),
        'passRate', round(pass_rate::numeric, 2),
        'pendingEvaluations', pending_eval,
        'integrityFlags', integrity_flags
      ) ORDER BY avg_score DESC)
      FROM class_perf
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_exam_analytics(uuid) TO authenticated;
