-- Chapter-wise analysis for the calling student, for ONE subject, honouring the
-- My Results page filters, with a de-identified class average per chapter.
--
-- Why a new function rather than extending student_chapter_performance():
-- that one is the dashboard's "which chapter should I revise" feed (all subjects,
-- all time, weakest-first) and SuggestionsCard depends on its exact shape. This
-- one answers a different question — "for THIS subject, under the filters I have
-- applied, how did I do per chapter versus my class" — so it gets its own name
-- instead of an overload that PostgREST would have to disambiguate.
--
-- Chapter tagging is EXAM-level, not question-level: exam_questions carries no
-- chapter link, so `exam_topics (exam_id, topic_id)` — what the teacher picked
-- when creating the exam — is the only source. A chapter's score is therefore the
-- average of the student's results on the exams covering it, and an exam covering
-- several chapters credits its score to each of them. n_tests is returned so the
-- UI never presents a one-test chapter as settled fact.
--
-- Filter parameters mirror StudentResultsPage exactly so the bar chart and the
-- trajectory line above it always describe the SAME set of tests:
--   p_subject    the subject name (matched normalised, as elsewhere)
--   p_exam_type  NULL = all types, else 'term' | 'unit' | 'weekly' | 'unspecified'
--   p_from       NULL = all time, else the inclusive start date of the window
--   p_last_n     NULL = no cap, else "the most recent N tests" (the Last 5 filter)
--
-- Class average is scoped PER EXAM to the class the student actually sat that exam
-- under (student_exam_attempts.class_id on their own attempt), the same way
-- student_exam_class_comparison does it — NOT to their current class_assignments.
-- That distinction is load-bearing: a student who has since moved section, or
-- whose attempt was recorded against a different section, resolves to a class
-- that never sat the exam, so a current-assignment filter returns an empty cohort
-- and the comparison silently disappears while their own bars still render.
-- Verified in prod: one test student resolved to 190d1d32 while their attempts sat
-- under 38198c45, giving 0 classmates where 10 existed.
--
-- The average is SUPPRESSED below 3 contributing students: with one or two, a
-- "class average" either restates the student's own score or lets them derive a
-- single classmate's exact result. n_students is returned either way so the UI can
-- say why the comparison is missing.

CREATE OR REPLACE FUNCTION public.student_chapter_analysis(
  p_subject   text,
  p_exam_type text DEFAULT NULL,
  p_from      date DEFAULT NULL,
  p_last_n    int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_rows  jsonb;
  v_exams int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF btrim(COALESCE(p_subject, '')) = '' THEN
    RETURN jsonb_build_object('has_data', false, 'n_exams', 0, 'chapters', '[]'::jsonb);
  END IF;

  WITH my_exams AS (
    -- One row per exam the CALLER sat in this subject with a published result.
    -- Grouped by exam so a re-attempt or a duplicated exam_subjects row cannot
    -- weight a single test twice. class_id is the section the caller sat it
    -- under and defines the comparison cohort below.
    SELECT e.id AS exam_id,
           avg(fr.percentage) AS my_pct,
           -- uuid has no min()/max() aggregate, so take the first attempt's class.
           (array_agg(a.class_id ORDER BY a.id))[1] AS class_id,
           max(COALESCE(e.published_at::date, e.scheduled_date::date,
                        a.submitted_at::date, fr.created_at::date)) AS exam_date
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE a.student_id = v_uid
      AND fr.is_published = true
      AND initcap(lower(btrim(us.name))) = initcap(lower(btrim(p_subject)))
      AND (p_exam_type IS NULL
           OR COALESCE(NULLIF(btrim(e.exam_type), ''), 'unspecified') = p_exam_type)
    GROUP BY e.id
  ),
  windowed AS (
    -- Date cutoff first, then the "most recent N" cap, so the two compose the
    -- same way the page's Time range select does.
    SELECT * FROM my_exams
    WHERE (p_from IS NULL OR exam_date >= p_from)
    ORDER BY exam_date DESC
    LIMIT (CASE WHEN COALESCE(p_last_n, 0) > 0 THEN p_last_n ELSE NULL END)
  ),
  chap AS (
    SELECT et.exam_id,
           w.class_id,
           st.id AS chapter_id,
           st.topic_name AS chapter,
           st.chapter_number,
           st.display_order
    FROM exam_topics et
    JOIN syllabus_topics st ON st.id = et.topic_id AND st.is_active
    JOIN windowed w ON w.exam_id = et.exam_id
    WHERE btrim(COALESCE(st.topic_name, '')) <> ''
  ),
  mine AS (
    SELECT c.chapter_id, c.chapter, c.chapter_number, c.display_order,
           round(avg(w.my_pct), 1) AS student_avg,
           count(DISTINCT w.exam_id) AS n_tests
    FROM chap c
    JOIN windowed w ON w.exam_id = c.exam_id
    GROUP BY c.chapter_id, c.chapter, c.chapter_number, c.display_order
  ),
  cohort AS (
    -- Everyone who sat the SAME exam in the SAME section as the caller, with a
    -- published result. De-identified: only an average and a headcount ever
    -- leave this CTE. The caller counts towards their own class average, which
    -- is how student_subject_class_comparison already reads.
    SELECT DISTINCT c.chapter_id, a.student_id, a.id AS attempt_id, fr.percentage
    FROM chap c
    JOIN student_exam_attempts a
      ON a.exam_id = c.exam_id AND a.class_id = c.class_id
    JOIN final_results fr ON fr.attempt_id = a.id AND fr.is_published = true
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
  ),
  cls AS (
    SELECT chapter_id,
           round(avg(percentage), 1) AS class_avg,
           count(DISTINCT student_id) AS n_students
    FROM cohort
    GROUP BY chapter_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'chapter_id',     m.chapter_id,
           'chapter',        m.chapter,
           'chapter_number', m.chapter_number,
           'student_avg',    m.student_avg,
           -- Small-cohort suppression (see header).
           'class_avg',      CASE WHEN COALESCE(c.n_students, 0) >= 3 THEN c.class_avg END,
           'n_students',     COALESCE(c.n_students, 0),
           'n_tests',        m.n_tests
         ) ORDER BY m.chapter_number NULLS LAST, m.display_order, m.chapter), '[]'::jsonb)
    INTO v_rows
  FROM mine m
  LEFT JOIN cls c USING (chapter_id);

  SELECT count(*) INTO v_exams FROM (
    SELECT e.id
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE a.student_id = v_uid
      AND fr.is_published = true
      AND initcap(lower(btrim(us.name))) = initcap(lower(btrim(p_subject)))
      AND (p_exam_type IS NULL
           OR COALESCE(NULLIF(btrim(e.exam_type), ''), 'unspecified') = p_exam_type)
      AND (p_from IS NULL
           OR COALESCE(e.published_at::date, e.scheduled_date::date,
                       a.submitted_at::date, fr.created_at::date) >= p_from)
    GROUP BY e.id
  ) q;

  RETURN jsonb_build_object(
    'has_data', jsonb_array_length(v_rows) > 0,
    -- How many tests the filters matched, so the UI can distinguish "no tests
    -- here" from "tests exist but nobody tagged their chapters".
    'n_exams', COALESCE(v_exams, 0),
    'chapters', v_rows
  );
END $$;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new public
-- function and REVOKE ... FROM PUBLIC does NOT strip that named grant (CLAUDE.md
-- §11). Verified after applying: both revokes are needed. Revoking anon alone
-- leaves PUBLIC:EXECUTE behind, and PUBLIC still includes anon; revoking PUBLIC
-- alone leaves the named anon grant. Do both, then re-grant authenticated.
REVOKE ALL ON FUNCTION public.student_chapter_analysis(text, text, date, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_chapter_analysis(text, text, date, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_chapter_analysis(text, text, date, int) TO authenticated;
