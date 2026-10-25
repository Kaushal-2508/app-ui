-- Follow-up audit to 20260825130000 (final_results outage): scanned every
-- UPDATE/ALL policy on prod for the same landmine — a state-pinning USING with
-- NO explicit WITH CHECK, which Postgres then re-applies to the NEW row and so
-- forbids the very state transition the policy exists to allow. Three hits.

-- 1. proctoring_sessions — CONFIRMED BROKEN (the "STILL OPEN" triage error,
--    79×/48h since at least July). useProctoring's exam-end cleanup writes
--    { is_active: false, ended_at } — the new row can never satisfy the
--    implicit CHECK `is_active = true`, so student proctoring sessions were
--    NEVER marked ended (the write is fire-and-forget, so it failed silently).
--    Students may update only their ACTIVE session, but may end it.
DROP POLICY IF EXISTS "Students can update own active session" ON public.proctoring_sessions;
CREATE POLICY "Students can update own active session"
  ON public.proctoring_sessions
  FOR UPDATE
  USING (get_attempt_student_id(attempt_id) = auth.uid() AND is_active = true)
  WITH CHECK (get_attempt_student_id(attempt_id) = auth.uid());

-- 2. appointments — dormant landmine. The policy is literally named
--    "Students can cancel own pending appointments", yet cancelling
--    (status -> 'cancelled') could never pass the implicit CHECK
--    `status = 'pending'`. No student-cancel UI exists yet, so it hasn't
--    fired; defuse it before one is added. Students may touch only their own
--    PENDING appointments and may only keep them pending or cancel them.
DROP POLICY IF EXISTS "Students can cancel own pending appointments" ON public.appointments;
CREATE POLICY "Students can cancel own pending appointments"
  ON public.appointments
  FOR UPDATE
  USING (student_id = auth.uid() AND status = 'pending')
  WITH CHECK (student_id = auth.uid() AND status IN ('pending', 'cancelled'));

-- 3. leave_requests — safe today (students withdraw via DELETE, reviews go
--    through the review_student_leave SECURITY DEFINER RPC), but the same
--    shape. Make the intended semantics EXPLICIT instead of implicit:
--    students may edit their own request only while it stays pending.
--    (Identical behaviour to the implicit check; documentation + upsert-proofing.)
DROP POLICY IF EXISTS "Students can update own pending leave requests" ON public.leave_requests;
CREATE POLICY "Students can update own pending leave requests"
  ON public.leave_requests
  FOR UPDATE
  USING (student_id = auth.uid() AND status = 'pending')
  WITH CHECK (student_id = auth.uid() AND status = 'pending');

-- Audited and left alone:
--   student_exam_attempts "Students can update own non-finalized attempts"
--     (is_finalized = false pin): no client path writes is_finalized; submit &
--     finalization run through their own routes. Freezing finalized attempts
--     against student writes is the intended behaviour.
--   recheck_requests INSERT (fr.is_published = true): checks a REFERENCED
--     row's state, not the row being written — legitimate business rule.
