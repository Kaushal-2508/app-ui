UPDATE student_exam_attempts sea
SET evaluation_status = 'ai_evaluated'
WHERE evaluation_status = 'pending'
  AND EXISTS (
    SELECT 1 FROM student_answers sa
    JOIN ai_evaluations ae ON ae.answer_id = sa.id
    WHERE sa.attempt_id = sea.id
  );