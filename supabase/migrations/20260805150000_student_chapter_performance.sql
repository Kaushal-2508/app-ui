-- Per-CHAPTER performance for the calling student.
--
-- Chapters are not recorded on individual questions (exam_questions has no
-- topic_id and no link back to question_bank). They are recorded at the EXAM
-- level: when a teacher creates an exam they pick the chapters it covers, and
-- useSaveExam writes those into `exam_topics (exam_id, topic_id)` where topic_id
-- references syllabus_topics — the chapter master.
--
-- So a chapter's score for a student = the average of their published results on
-- the exams that cover that chapter. An exam covering several chapters credits
-- the same score to each, which is the honest limit of exam-level tagging; the
-- test count is returned so the UI can avoid over-claiming from a single test.
--
-- Subject comes from the chapter itself (syllabus_topics.subject_id), normalised
-- with initcap(lower(btrim(name))) so it matches student_subject_class_comparison
-- and the dashboard's subject picker exactly.

CREATE OR REPLACE FUNCTION public.student_chapter_performance()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  WITH mine AS (
    SELECT DISTINCT
           e.id AS exam_id,
           fr.percentage,
           st.id AS chapter_id,
           st.topic_name AS chapter,
           initcap(lower(btrim(us.name))) AS subject
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    JOIN exam_topics et ON et.exam_id = e.id
    JOIN syllabus_topics st ON st.id = et.topic_id AND st.is_active
    JOIN universal_subjects us ON us.id = st.subject_id
    WHERE a.student_id = v_uid
      AND fr.is_published = true
      AND btrim(COALESCE(us.name, '')) <> ''
      AND btrim(COALESCE(st.topic_name, '')) <> ''
  ),
  agg AS (
    SELECT subject, chapter,
           round(avg(percentage), 1) AS avg_pct,
           count(DISTINCT exam_id) AS n_tests
    FROM mine
    GROUP BY subject, chapter
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subject', subject,
           'chapter', chapter,
           'avg_pct', avg_pct,
           'n_tests', n_tests
         ) ORDER BY avg_pct ASC, chapter), '[]'::jsonb)
    INTO v_rows
  FROM agg;

  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.student_chapter_performance() TO authenticated;
