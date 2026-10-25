-- Class comparison for a HYBRID exam attempt (student-facing).
--
-- Hybrid exams are sat by the whole class just like any other exam, so the cohort
-- exists — `hybrid_exam_attempts` carries exam_id, class_id, student_id and the
-- marks. The only thing standing in the way was RLS: a student can read their own
-- hybrid attempt but not their classmates'. This is the same problem
-- student_exam_class_comparison solves for `final_results`, so it gets the same
-- solution: a read-only SECURITY DEFINER function that returns ONLY de-identified
-- aggregates (average, high, percentile, count) and never a classmate's row.
--
-- Percentile uses cume_dist(), not percent_rank(), so an all-100% cohort reads as
-- "top", not "bottom" (matches the sibling RPC).

CREATE OR REPLACE FUNCTION public.student_hybrid_class_comparison(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_exam uuid;
  v_class uuid;
  v_my_pct numeric;
  v_class_avg numeric;
  v_class_high numeric;
  v_n int;
  v_cd numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT a.student_id, a.status, a.exam_id, a.class_id,
         CASE WHEN COALESCE(a.total_max_marks, 0) > 0
              THEN (a.total_marks_awarded / a.total_max_marks) * 100 END
    INTO v_owner, v_status, v_exam, v_class, v_my_pct
  FROM hybrid_exam_attempts a
  WHERE a.id = p_attempt_id;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'attempt not found'; END IF;
  -- Ownership: the attempt MUST belong to the caller.
  IF v_owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'not authorized for this attempt'; END IF;

  -- Only a marked attempt is comparable (mirrors what the student already sees).
  IF v_status IS DISTINCT FROM 'evaluated' OR v_my_pct IS NULL THEN
    RETURN jsonb_build_object('has_data', false);
  END IF;

  WITH cohort AS (
    SELECT a.student_id,
           (a.total_marks_awarded / a.total_max_marks) * 100 AS pct
    FROM hybrid_exam_attempts a
    WHERE a.exam_id = v_exam
      AND a.status = 'evaluated'
      AND COALESCE(a.total_max_marks, 0) > 0
      -- Compare within the student's own class when the attempt records one, so a
      -- multi-class hybrid exam doesn't average other sections into the figure.
      AND (v_class IS NULL OR a.class_id = v_class)
  ),
  ranked AS (
    SELECT student_id, cume_dist() OVER (ORDER BY pct) AS cd FROM cohort
  )
  SELECT round(avg(c.pct), 1), round(max(c.pct), 1), count(*),
         (SELECT cd FROM ranked WHERE student_id = v_uid LIMIT 1)
    INTO v_class_avg, v_class_high, v_n, v_cd
  FROM cohort c;

  RETURN jsonb_build_object(
    'has_data', true,
    'student_percentage', round(v_my_pct, 1),
    'class_average', v_class_avg,
    'class_high', v_class_high,
    'student_percentile', CASE WHEN v_cd IS NULL THEN NULL ELSE round(v_cd * 100)::int END,
    'cohort_size', v_n
  );
END $$;

GRANT EXECUTE ON FUNCTION public.student_hybrid_class_comparison(uuid) TO authenticated;
