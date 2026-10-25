ALTER TABLE exam_questions
ADD COLUMN parent_question_id uuid REFERENCES exam_questions(id) ON DELETE CASCADE;

CREATE INDEX idx_exam_questions_parent ON exam_questions(parent_question_id)
WHERE parent_question_id IS NOT NULL;