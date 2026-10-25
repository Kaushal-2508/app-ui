-- Fix: the engagement cohort excluded every teacher with no activity, which
-- collapsed most schools to a cohort of one and hid the rank entirely.
--
-- MEASURED IN PROD 2026-08-19: Salci National School has 52 teachers holding
-- class assignments. compute_teacher_engagement_monthly ranked exactly 1 of
-- them, because `rankable` filtered `WHERE m.inputs_present > 0`. A teacher who
-- logged nothing therefore vanished from the cohort rather than placing last,
-- so cohort_size was 1 and the strip could only ever say "N points this month"
-- instead of "#N of M this month".
--
-- A teacher who marked nothing, logged no attendance and updated no syllabus
-- scored zero. Zero is a real score and belongs in the ranking; absence is not
-- the same as exclusion. Everyone with a class assignment is now ranked, with
-- COALESCE(score, 0), and inputs_present still records how much evidence sits
-- behind each number.
CREATE OR REPLACE FUNCTION public.compute_teacher_engagement_monthly(_period_key text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n integer := 0;
BEGIN
  WITH inst AS (
    SELECT i.id, COALESCE(i.timezone,'Asia/Kolkata') AS tz FROM institutions i
  ),
  per AS (
    SELECT inst.id AS institution_id,
           COALESCE(_period_key,
                    to_char((now() AT TIME ZONE inst.tz)::date, 'YYYY-MM')) AS period_key
      FROM inst
  ),
  bounds AS (
    SELECT p.institution_id, p.period_key,
           to_date(p.period_key || '-01', 'YYYY-MM-DD')                             AS d_from,
           (to_date(p.period_key || '-01','YYYY-MM-DD') + INTERVAL '1 month')::date AS d_to
      FROM per p
  ),
  teachers AS (
    SELECT DISTINCT ca.user_id AS teacher_id, c.institution_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND COALESCE(c.is_active, true)
     WHERE ca.role = 'teacher'
  ),
  grading AS (
    SELECT t.teacher_id, b.period_key,
           round(count(*) FILTER (WHERE a.evaluation_status IN ('teacher_reviewed','finalized'))
                 * 100.0 / NULLIF(count(*), 0), 2) AS pct
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      JOIN exams e ON e.created_by = t.teacher_id
      JOIN student_exam_attempts a ON a.exam_id = e.id AND a.is_submitted
                                  AND a.submitted_at >= b.d_from AND a.submitted_at < b.d_to
     GROUP BY t.teacher_id, b.period_key
  ),
  attend AS (
    SELECT t.teacher_id, b.period_key,
           LEAST(count(DISTINCT ar.date) * 100.0 / 20.0, 100)::numeric(5,2) AS pct
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      JOIN attendance_records ar ON ar.marked_by = t.teacher_id
                                AND ar.date >= b.d_from AND ar.date < b.d_to
     GROUP BY t.teacher_id, b.period_key
  ),
  hw AS (
    SELECT t.teacher_id, b.period_key,
           round(count(*) FILTER (WHERE r.id IS NOT NULL) * 100.0 / NULLIF(count(*), 0), 2) AS pct
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      JOIN homework_assignments h ON h.created_by = t.teacher_id
      JOIN homework_submissions s ON s.homework_assignment_id = h.id
                                 AND s.submitted_at >= b.d_from AND s.submitted_at < b.d_to
      LEFT JOIN homework_results r ON r.submission_id = s.id
     GROUP BY t.teacher_id, b.period_key
  ),
  syl AS (
    SELECT t.teacher_id, b.period_key,
           LEAST(count(*) * 100.0 / 8.0, 100)::numeric(5,2) AS pct
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      JOIN syllabus_progress_events spe ON spe.recorded_by = t.teacher_id
                                       AND spe.date >= b.d_from AND spe.date < b.d_to
     GROUP BY t.teacher_id, b.period_key
  ),
  merged AS (
    SELECT t.teacher_id, t.institution_id, b.period_key,
           g.pct AS c_grading, at.pct AS c_attendance, hw.pct AS c_homework, sy.pct AS c_syllabus,
           (CASE WHEN g.pct  IS NULL THEN 0 ELSE 1 END
          + CASE WHEN at.pct IS NULL THEN 0 ELSE 1 END
          + CASE WHEN hw.pct IS NULL THEN 0 ELSE 1 END
          + CASE WHEN sy.pct IS NULL THEN 0 ELSE 1 END)::smallint AS inputs_present,
           -- Eligibility-weighted over the components that exist; 0 when none do.
           COALESCE(
             ((COALESCE(g.pct,0) + COALESCE(at.pct,0) + COALESCE(hw.pct,0) + COALESCE(sy.pct,0))
              / NULLIF((CASE WHEN g.pct IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN at.pct IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN hw.pct IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN sy.pct IS NULL THEN 0 ELSE 1 END), 0)), 0)::numeric(5,2) AS score
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      LEFT JOIN grading g ON g.teacher_id = t.teacher_id AND g.period_key = b.period_key
      LEFT JOIN attend at ON at.teacher_id = t.teacher_id AND at.period_key = b.period_key
      LEFT JOIN hw ON hw.teacher_id = t.teacher_id AND hw.period_key = b.period_key
      LEFT JOIN syl sy ON sy.teacher_id = t.teacher_id AND sy.period_key = b.period_key
  ),
  -- NO inputs_present filter: everyone with a class assignment is ranked.
  rankable AS (
    SELECT m.*,
           count(*) OVER (PARTITION BY m.institution_id, m.period_key)                      AS cohort_size,
           rank()   OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.score DESC) AS rnk,
           rank()   OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.c_grading    DESC NULLS LAST) AS r_grading,
           rank()   OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.c_attendance DESC NULLS LAST) AS r_attend,
           rank()   OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.c_homework   DESC NULLS LAST) AS r_hw,
           rank()   OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.c_syllabus   DESC NULLS LAST) AS r_syl
      FROM merged m
  )
  INSERT INTO public.teacher_engagement_monthly AS tem
    (teacher_id, institution_id, period_key, cohort_size, score, rank,
     inputs_present, c_grading, c_attendance, c_homework, c_syllabus, badge_label, computed_at)
  SELECT r.teacher_id, r.institution_id, r.period_key, r.cohort_size, r.score, r.rnk,
         r.inputs_present, r.c_grading, r.c_attendance, r.c_homework, r.c_syllabus,
         (SELECT b.lbl FROM (
            VALUES ('marking turnaround', r.r_grading,  r.c_grading),
                   ('attendance logging', r.r_attend,   r.c_attendance),
                   ('homework marking',   r.r_hw,       r.c_homework),
                   ('syllabus logging',   r.r_syl,      r.c_syllabus)
          ) AS b(lbl, rk, val)
          WHERE b.val IS NOT NULL
          ORDER BY b.rk ASC, b.val DESC
          LIMIT 1),
         now()
    FROM rankable r
  ON CONFLICT (teacher_id, period_key) DO UPDATE SET
    cohort_size = EXCLUDED.cohort_size, score = EXCLUDED.score, rank = EXCLUDED.rank,
    inputs_present = EXCLUDED.inputs_present, c_grading = EXCLUDED.c_grading,
    c_attendance = EXCLUDED.c_attendance, c_homework = EXCLUDED.c_homework,
    c_syllabus = EXCLUDED.c_syllabus, badge_label = EXCLUDED.badge_label,
    computed_at = now();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.compute_teacher_engagement_monthly(text) FROM PUBLIC, anon, authenticated;

-- Recompute both seeded months with the full cohort.
SELECT public.compute_teacher_engagement_monthly(
  to_char((now() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 month', 'YYYY-MM'));
SELECT public.compute_teacher_engagement_monthly();
