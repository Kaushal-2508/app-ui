-- Remove the 'late' status from STUDENT attendance (attendance_records only).
-- Staff attendance (staff_attendance_records) is intentionally untouched.

-- 1. Backfill: a past 'late' means the student physically showed up -> present.
UPDATE public.attendance_records SET status = 'present' WHERE status = 'late';

-- 2. Swap the inline (auto-named) CHECK constraint.
ALTER TABLE public.attendance_records
  DROP CONSTRAINT attendance_records_status_check;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('present','absent','sick','casual','holiday'));
