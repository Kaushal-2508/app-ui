-- Add student_id and attempt_id to ocr_uploads for student-to-sheet matching
ALTER TABLE ocr_uploads 
ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS attempt_id UUID REFERENCES student_exam_attempts(id);

-- Add auto-grade flag to teacher_overrides
ALTER TABLE teacher_overrides 
ADD COLUMN IF NOT EXISTS is_auto_graded BOOLEAN DEFAULT FALSE;

-- Add offline flag to student_exam_attempts
ALTER TABLE student_exam_attempts 
ADD COLUMN IF NOT EXISTS is_offline BOOLEAN DEFAULT FALSE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_ocr_uploads_student_id ON ocr_uploads(student_id);
CREATE INDEX IF NOT EXISTS idx_ocr_uploads_attempt_id ON ocr_uploads(attempt_id);
CREATE INDEX IF NOT EXISTS idx_teacher_overrides_auto_graded ON teacher_overrides(is_auto_graded);