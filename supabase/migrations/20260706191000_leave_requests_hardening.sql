-- §23: index every FK on leave_requests (none existed).
CREATE INDEX IF NOT EXISTS idx_leave_requests_student_created
  ON public.leave_requests (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_class_status
  ON public.leave_requests (class_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_institution_status
  ON public.leave_requests (institution_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_reviewed_by
  ON public.leave_requests (reviewed_by);

-- Integrity: end_date must not precede start_date.
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_date_order_check CHECK (end_date >= start_date);
