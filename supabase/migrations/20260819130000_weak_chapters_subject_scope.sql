-- Fix: "Weak chapters" showed chapters from subjects the teacher does not teach.
--
-- OBSERVED: Teacher2 teaches ONLY English Core, yet the card listed Mammals,
-- Animals, Biology, Water Cycle and Photosynthesis, every one tagged Computer
-- Science.
--
-- CAUSE: dash_teacher_weak_chapters scoped purely by authorship —
--   JOIN exams e ON e.id = sec.exam_id AND e.created_by = v_uid
-- It joined exam_subjects only to LABEL each row, never to FILTER it. That is
-- the exact defect the Phase 1 audit found in dash_scoped_subject_performance,
-- reintroduced here. Any exam the teacher happened to author counted, whatever
-- subject it belonged to.
--
-- FIX: require the exam's (class, subject) to be one of the caller's own pairs
-- from dash_resolve_scoped_pairs(), the same boundary every other teacher panel
-- uses. Authorship is kept as well, so the card stays "chapters from MY papers"
-- rather than the whole department's.
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

  WITH graded AS (
    SELECT lower(btrim(t.tag))      AS tag,
           us.name                  AS subject_name,
           a.student_id,
           tov.final_marks::numeric AS got,
           tov.max_marks::numeric   AS possible
      FROM teacher_overrides tov
      JOIN student_answers sa      ON sa.id = tov.answer_id
      JOIN student_exam_attempts a ON a.id = sa.attempt_id
      JOIN exam_questions q        ON q.id = sa.question_id
      JOIN exam_sections sec       ON sec.id = q.section_id
      JOIN exams e                 ON e.id = sec.exam_id AND e.created_by = v_uid
      JOIN exam_subjects esx       ON esx.exam_id = e.id
      JOIN universal_subjects us   ON us.id = esx.subject_id
      CROSS JOIN LATERAL unnest(COALESCE(q.tags, ARRAY[]::text[])) AS t(tag)
     WHERE tov.max_marks > 0
       AND btrim(COALESCE(t.tag,'')) <> ''
       -- THE FIX: the exam's class AND subject must both be mine.
       AND EXISTS (
         SELECT 1
           FROM unnest(v_pc, v_ps) AS pr(cid, sid)
          WHERE pr.cid = a.class_id
            AND (pr.sid IS NULL OR pr.sid = esx.subject_id)
       )
  ),
  per_student AS (
    SELECT tag, subject_name, student_id,
           sum(got) / NULLIF(sum(possible), 0) * 100 AS pct
      FROM graded GROUP BY tag, subject_name, student_id
  ),
  per_tag AS (
    SELECT tag, subject_name,
           round(avg(pct), 1)               AS mastery_pct,
           count(*)                         AS students,
           count(*) FILTER (WHERE pct < 50) AS below_50
      FROM per_student GROUP BY tag, subject_name
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY mastery_pct ASC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'tag',          tag,
             'subject_name', subject_name,
             'mastery_pct',  mastery_pct,
             'students',     students,
             'below_50',     below_50
           ) AS x, mastery_pct
      FROM per_tag
     -- Minimum evidence. The floor is 3, not 5: 5 was borrowed from advice
     -- written for large cohorts, and it silently swallowed every real result
     -- here — Teacher2's English Core chapters ("classroom" 33%, "symbolism"
     -- 33%) are each answered by exactly 3 pupils in a 9-pupil class. The row
     -- always prints "N of M students below 50%", so the teacher can weigh the
     -- evidence themselves rather than having it hidden.
     WHERE students >= 3 AND mastery_pct < 70
     ORDER BY mastery_pct ASC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'chapters', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_weak_chapters(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_weak_chapters(integer) TO authenticated;
