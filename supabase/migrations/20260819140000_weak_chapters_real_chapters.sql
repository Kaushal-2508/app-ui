-- Fix: "Weak chapters" listed question TAGS, not chapters.
--
-- OBSERVED: the card showed "Symbolism", "Classroom", "Themes", "Nostalgia",
-- "Patriotism". Those are keyword tags on individual questions. The real
-- chapters for English Core / Class 12 are "Deep Water", "The Rattrap",
-- "Indigo", "Poets and Pancakes", "The Interview" and 25 more — exactly what
-- the exam-creation screen lists under "Chapters (30)".
--
-- WHY I GOT IT WRONG: the earlier audit recommended exam_questions.tags as a
-- replacement for the empty concept_mastery table, and I took that at face
-- value. exam_questions has NO chapter or topic column at all (verified against
-- information_schema) — tags are the only topic-ish field on it, so tags looked
-- like the only option.
--
-- THE REAL SOURCE: exam_topics(exam_id, topic_id) -> syllabus_topics.topic_name.
-- That is the table the "Chapters" multi-select writes to (966 rows in prod).
--
-- ATTRIBUTION CAVEAT, stated because it is a genuine limitation: a question
-- cannot be tied to a single chapter, since exam_questions carries no chapter
-- FK. Chapter mastery is therefore computed at EXAM level — a student's score on
-- an exam counts toward every chapter that exam covers. Teacher2's exams span
-- 1-4 chapters each, so a multi-chapter paper contributes the same score to all
-- of its chapters. That is honest and useful ("papers covering The Rattrap are
-- going badly"), but it is not per-question precision, and it will only become
-- precise if exam_questions gains a chapter reference.
CREATE OR REPLACE FUNCTION public.dash_teacher_weak_chapters(p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_rows jsonb; v_pc uuid[]; v_ps uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps
    FROM public.dash_resolve_scoped_pairs() p;

  IF v_pc IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'chapters', '[]'::jsonb);
  END IF;

  WITH scored AS (
    SELECT st.topic_name          AS chapter,
           us.name                AS subject_name,
           a.student_id,
           fr.percentage::numeric AS pct
      FROM exams e
      JOIN exam_topics et          ON et.exam_id = e.id
      JOIN syllabus_topics st      ON st.id = et.topic_id
      JOIN exam_subjects esx       ON esx.exam_id = e.id
      JOIN universal_subjects us   ON us.id = esx.subject_id
      JOIN student_exam_attempts a ON a.exam_id = e.id
      JOIN final_results fr        ON fr.attempt_id = a.id
     WHERE e.created_by = v_uid
       AND e.status IN ('published','active','completed')
       AND COALESCE(btrim(st.topic_name), '') <> ''
       -- The exam's class AND subject must both be mine.
       AND EXISTS (
         SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
          WHERE pr.cid = a.class_id
            AND (pr.sid IS NULL OR pr.sid = esx.subject_id)
       )
  ),
  per_student AS (
    -- One figure per pupil per chapter, so a pupil who sat three papers on the
    -- same chapter counts once rather than three times.
    SELECT chapter, subject_name, student_id, avg(pct) AS pct
      FROM scored GROUP BY chapter, subject_name, student_id
  ),
  per_chapter AS (
    SELECT chapter, subject_name,
           round(avg(pct), 1)               AS mastery_pct,
           count(*)                         AS students,
           count(*) FILTER (WHERE pct < 50) AS below_50
      FROM per_student GROUP BY chapter, subject_name
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY mastery_pct ASC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'tag',          chapter,          -- key kept as `tag` so the UI is unchanged
             'subject_name', subject_name,
             'mastery_pct',  mastery_pct,
             'students',     students,
             'below_50',     below_50
           ) AS x, mastery_pct
      FROM per_chapter
     -- Minimum evidence: 3 pupils, not 5. Five was borrowed from advice written
     -- for large cohorts and hid every genuine result in a 9-pupil class.
     WHERE students >= 3 AND mastery_pct < 70
     ORDER BY mastery_pct ASC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'chapters', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_weak_chapters(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_weak_chapters(integer) TO authenticated;
