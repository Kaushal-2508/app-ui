-- Follow-up to 20260928160000: every staff-leave decision now goes through
-- review_staff_leave (the Workday Staff Leaves tab and the HR & Payroll
-- StaffLeavePanel both call it since the 2026-09-28 release), so school admins
-- no longer need INSERT / UPDATE / DELETE on other people's rows.
--
-- The old FOR ALL admin policy let an admin approve their OWN request with a
-- direct UPDATE, and let any direct UPDATE skip the on-leave attendance days
-- and the balance. Narrowed to SELECT. An admin's own apply / view / withdraw
-- still works through the staff policies from 20260928160000.
--
-- APPLIED 2026-09-28, after the release that moved the HR panel went live.
-- SHIP ORDER (CLAUDE.md §2): apply only AFTER the frontend that moved
-- StaffLeavePanel onto the RPC is live. Before it, the HR panel's direct
-- UPDATE would update zero rows and still say "Leave request updated".

DROP POLICY IF EXISTS "Admins full access staff leave requests" ON public.staff_leave_requests;

CREATE POLICY "Admins view staff leave requests" ON public.staff_leave_requests
  FOR SELECT TO authenticated
  USING (public.is_institution_admin((select auth.uid()), institution_id));
