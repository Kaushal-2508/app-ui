-- Student portal consolidation — class-comparison RPCs (parent/student facing).
-- The live student dashboard previously SHOWED FABRICATED class numbers (avg*0.95 etc.) because student
-- RLS blocks reading classmates' final_results / class_aggregates. These read-only SECURITY DEFINER RPCs
-- aggregate classmates' PUBLISHED results server-side and return ONLY de-identified aggregates
-- (averages, high, percentile, counts) — never a classmate's identity or raw row. Mirrors the §23
-- "aggregate server-side" contract and the dash_* RPC patterns (20260602100300 / 20260602100500).
--
-- Cohort = the CALLING student's own assigned section(s) (class_assignments role='student').
-- "Finalised / safe to compare" = final_results.is_published = true AND exams.status IN
-- ('published','active','completed') — matching what the student already sees in My Results.
-- percentage is a GENERATED column (CLAUDE.md §9) — read only.

-- Index supporting per-exam-per-class cohort scans (FK-adjacent, §23).
CREATE INDEX IF NOT EXISTS idx_sea_exam_class
  ON public.student_exam_attempts (exam_id, class_id);

-- The set of class_ids the caller is enrolled in as a student.
CREATE OR REPLACE FUNCTION public.student_resolve_classes()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT ca.class_id), '{}'::uuid[])
  FROM class_assignments ca
  WHERE ca.user_id = auth.uid() AND ca.role = 'student';
$$;

-- A) Per-subject: the calling student's average vs the class average, over published finalised tests.
--    Weakest-first (matches the dashboard "subject snapshot"). The frontend label engine applies the
--    ±5% threshold band to (student_avg, class_avg). All exam types included (Q2: type-aware, unspecified counts).
CREATE OR REPLACE FUNCTION public.student_subject_class_comparison()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_classes uuid[]; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_classes := public.student_resolve_classes();

  WITH res AS (
    SELECT a.student_id,
           initcap(lower(btrim(us.name))) AS subject_name,
           fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE fr.is_published = true
      AND a.class_id = ANY(v_classes)
  ),
  mine AS (
    SELECT subject_name, round(avg(percentage),1) AS student_avg, count(*) AS n_tests
    FROM res WHERE student_id = v_uid
    GROUP BY subject_name
  ),
  cls AS (
    SELECT subject_name, round(avg(percentage),1) AS class_avg,
           count(DISTINCT student_id) AS n_students
    FROM res
    GROUP BY subject_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subject', m.subject_name,
           'student_avg', m.student_avg,
           'class_avg', c.class_avg,
           'n_tests', m.n_tests,
           'n_students', c.n_students
         ) ORDER BY m.student_avg ASC), '[]'::jsonb)
    INTO v_rows
  FROM mine m LEFT JOIN cls c USING (subject_name);

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $$;

-- B) For ONE finalised test the calling student took: class average, class high, the student's percentile
--    (cume_dist, robust to ties so an all-100% class reads as "top", not "bottom"), and cohort size.
--    Frontend maps percentile -> band (>=75 top quarter / <=25 bottom quarter / else middle) and only
--    shows a band when cohort_size is large enough to be meaningful.
CREATE OR REPLACE FUNCTION public.student_exam_class_comparison(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_exam uuid; v_class uuid; v_my_pct numeric;
  v_class_avg numeric; v_class_high numeric; v_n int; v_cd numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  -- Ownership: the attempt MUST belong to the caller.
  IF public.get_attempt_student_id(p_attempt_id) IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not authorized for this attempt';
  END IF;

  SELECT a.exam_id, a.class_id INTO v_exam, v_class
  FROM student_exam_attempts a WHERE a.id = p_attempt_id;

  -- The caller's own result must be published to be comparable (matches My Results visibility).
  SELECT fr.percentage INTO v_my_pct
  FROM final_results fr WHERE fr.attempt_id = p_attempt_id AND fr.is_published = true;

  IF v_my_pct IS NULL THEN
    RETURN jsonb_build_object('has_data', false);
  END IF;

  WITH cohort AS (
    SELECT a.student_id, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE a.exam_id = v_exam AND a.class_id = v_class AND fr.is_published = true
  ),
  ranked AS (
    SELECT student_id, cume_dist() OVER (ORDER BY percentage) AS cd
    FROM cohort
  )
  SELECT round(avg(c.percentage),1), max(c.percentage), count(*),
         (SELECT cd FROM ranked WHERE student_id = v_uid LIMIT 1)
    INTO v_class_avg, v_class_high, v_n, v_cd
  FROM cohort c;

  RETURN jsonb_build_object(
    'has_data', true,
    'student_percentage', v_my_pct,
    'class_average', v_class_avg,
    'class_high', v_class_high,
    'student_percentile', CASE WHEN v_cd IS NULL THEN NULL ELSE round(v_cd*100)::int END,
    'cohort_size', v_n
  );
END $$;

-- C) The calling student's own score trend: last p_limit published results, chronological. Joins only
--    final_results+attempts+exams (NO exam_subjects) so multi-subject exams do not fan out / double-count.
--    Drives the dashboard single-line trend, the "average of last 5 tests" tile, and "improved/declined
--    since last test". exam_type is returned so the frontend can group/filter by type (never mixing types).
CREATE OR REPLACE FUNCTION public.student_score_trend(p_limit int DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  WITH mine AS (
    SELECT e.id AS exam_id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, a.submitted_at::date, fr.created_at::date) AS exam_date,
           fr.percentage,
           COALESCE(fr.published_at, fr.finalized_at, fr.created_at) AS ord
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE a.student_id = v_uid AND fr.is_published = true
    ORDER BY ord DESC
    LIMIT GREATEST(p_limit, 1)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'exam_id', exam_id, 'title', title, 'exam_type', exam_type,
           'exam_date', exam_date, 'percentage', percentage
         ) ORDER BY ord ASC), '[]'::jsonb)
    INTO v_rows FROM mine;
  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.student_resolve_classes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_subject_class_comparison() TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_exam_class_comparison(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_score_trend(int) TO authenticated;
