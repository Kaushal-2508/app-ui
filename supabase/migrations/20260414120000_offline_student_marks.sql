ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_offline BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS offline_student_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  marks_obtained NUMERIC,
  is_published BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, student_id)
);

ALTER TABLE offline_student_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "institution members can manage offline marks" ON offline_student_marks USING (
  EXISTS (
    SELECT 1 FROM exams e
    JOIN user_roles ur ON ur.institution_id = e.institution_id
    WHERE e.id = offline_student_marks.exam_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('teacher', 'coordinator', 'school_admin', 'super_school_admin', 'super_admin')
  )
);

CREATE POLICY "students read own published marks" ON offline_student_marks FOR SELECT USING (
  student_id = auth.uid() AND is_published = TRUE
);
