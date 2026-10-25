-- 20260706180000_attendance_records_student_date_idx.sql
-- The student attendance calendar filters attendance_records by
-- (student_id + date range). The only existing composite index is
-- UNIQUE(class_id, student_id, date) — class-leading, so it does not serve a
-- student-leading range scan. Add the covering index.
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_date
  ON public.attendance_records (student_id, date);
