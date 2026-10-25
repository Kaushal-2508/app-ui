-- Delete the old OCR upload record (file doesn't exist)
DELETE FROM ocr_uploads WHERE id = '8d5fb57d-2e4f-414d-9066-fe9cf50470ab';

-- Delete the attempt so a new one can be created with proper upload
DELETE FROM student_answers WHERE attempt_id = 'e664bb1f-29ad-4729-b2fd-cbf74216bf29';
DELETE FROM student_exam_attempts WHERE id = 'e664bb1f-29ad-4729-b2fd-cbf74216bf29';