# Staff leave workflow: apply, review one rung up, mark on-leave

> **Status 2026-09-28: the database half is APPLIED to prod** as `20260928160000_staff_leave_review.sql` (Tushar), verified by `scripts/test-staff-leave.sql` (39 assertions under real RLS, rolled back) and in `pg_proc` / `pg_policies`. Built from the draft below with these changes: leave days are the school's working days only (period-structure weekdays, Mon to Sat by default, minus `cal_events` holidays), not every calendar date; balances move by the days actually written; deciding a request's current status is a no-op; overturning an approval turns its past days back to absent; a coordinator reviewer must hold the coordinator role; the request row is locked while deciding. The HR & Payroll `StaffLeavePanel` now calls the RPC too, and `20260928163000` narrowed the admin policy to SELECT (applied 2026-09-28 after that frontend went live; verified: an admin's direct UPDATE, their own request included, now changes 0 rows). Route renamed to `/staff/workday` (`/staff/my-leaves` redirects).

**Date:** 2026-09-26 · **Asked by:** Naman (product) · **Frontend:** Naman, branch `naman-erp` · **Database:** Tushar (this document is the contract)

## What is being asked

Teachers, coordinators and school admins get the same leave flow students already have at `/student/leave`: apply from a sheet, see the request's status, withdraw while pending. Approval goes one rung up the ladder:

| Requester | Reviewer |
|---|---|
| Teacher | A coordinator of a wing that holds one of the teacher's classes, **or any school admin**. The admin may always decide, not only when the teacher has no wing coordinator (confirmed by Naman, 2026-09-28; the helper below already reads this way), so a teacher is never stuck. |
| Coordinator | A school admin. |
| School admin | Another school admin. Never yourself. |

A person with two roles applies from their highest rung (a teacher who is also a coordinator is reviewed by an admin). Super admins may decide anything, as everywhere else.

## What already exists

* `staff_leave_requests` and `staff_leave_balances` (migration `20260226094405`, HR module). Columns: `user_id`, `institution_id`, `leave_type` in (annual, sick, casual, maternity, paternity, unpaid, other), `start_date`, `end_date`, `reason`, `status` in (pending, approved, rejected), `reviewed_by`, `reviewed_at`, `reviewer_notes`.
* RLS today: `Admins full access staff leave requests` (FOR ALL via `is_institution_admin`) and **`Staff manage own leave requests` FOR ALL with `user_id = auth.uid()`**. The second policy lets any staff member UPDATE their own row, including `status`: a teacher can approve their own leave from the browser console today. Fixing that is part of this work.
* `staff_attendance_records` already has the status `on_leave`, and the 15-minute auto-absent pass (`tt_run_attendance_pass_for_institution`) marks anyone with no check-in as absent. An approved leave must therefore write `on_leave` rows for its dates, or the teacher on leave is marked absent every morning.
* The student flow is the model: `review_student_leave` (SECURITY DEFINER, `20260706194000`) validates, authorises through `can_review_student_leave`, updates the request and writes attendance rows in one transaction; reviewers have a scoped SELECT policy and **no UPDATE policy**.

## Frontend (built 2026-09-26, on `naman-erp`)

* `src/hooks/useStaffLeaveRequests.ts`: own list (paged), apply, withdraw (delete + re-select), balance, reviewer queue (paged, RLS-scoped, own requests excluded), review via the RPC below, and a probe `useStaffLeaveReviewAvailable` that calls the RPC with decision `probe` and treats PGRST202/42883 as "not installed".
* `/staff/my-leaves` is now **Workday** (`WorkdayPage`, still in `src/pages/staff/MyLeavePage.tsx` because the route in `App.tsx` is Tushar's): the whole staff side of attendance. Top: the check-in / check-out card. Tabs for everyone: "My Attendance" (own history calendar) and "My Leaves" (balance tiles when the school keeps balances, list with Withdraw on pending rows). Coordinators and admins also get "Staff Attendance" (`StaffAttendanceTab`), "Staff Leaves" (`StaffLeaveQueueTab`: Pending / Approved / Rejected / All, Approve / Reject; while the RPC is missing it shows "Staff leave approvals aren't switched on yet" instead of an empty queue) and "Substitutions". "Apply for leave" is the page's header action. The on-open attendance-pass kick moved here with the staff tabs. Route roles unchanged: teacher, coordinator, school_admin, super_school_admin. `FEATURE_URL_MAP` gates it on `attendance` (was `hr_payroll`), same as `/student/leave`.
* Attendance page (`/school/attendance`) is **students only**: Today's Attendance / Class Attendance, "Student Leaves" (renamed from "Leaves"), Reports, Settings. Nothing about staff is left on it.
* Dual-role accounts wear one hat at a time on both pages (§25): the tab set and the class scope follow `activeViewRole`. `useScopedAttendanceClasses`, `AttendanceReports` and the Student Leaves list (`useScopedLeaveRequests` gained `classIds`) resolve the active view instead of ranking the raw role flags, which had made a teacher+coordinator see the wing in both views.
* Entry points: a "Workday" tile on the teacher, coordinator and admin dashboards; sidebar "Workday" for every staff role (it replaced "My Leaves").

Applying and withdrawing work today under the existing policies. **Interim (2026-09-28): school admins decide from the Workday Staff Leaves tab** with the same direct UPDATE the HR & Payroll panel makes, allowed by `Admins full access staff leave requests`. `useReviewStaffLeave` takes that path only while the probe says the RPC is missing, guarded by `status = <the status the button was rendered against>`, `user_id <> auth.uid()`, and a re-read as the only success signal (§6). It writes no on-leave attendance rows and no balances. Coordinators cannot decide, and no approval reaches attendance or balances, until the database half lands. "Apply for leave" always shows: every school has a school admin, so every request has an approver. **Ordering for Tushar:** create the RPC before narrowing the admin policy, and move `StaffLeavePanel` onto the RPC before narrowing it; the direct path is dead code once the probe flips to true.

## Database (NEEDS DB, Tushar)

One migration. Names below are proposals; if a name changes, the frontend has exactly one string to update per name (`callReviewRpc` in the hook).

### 1. Authority helper

```sql
CREATE OR REPLACE FUNCTION public.can_review_staff_leave(_reviewer uuid, _requester uuid, _institution uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _reviewer <> _requester AND (
    public.is_super_admin(_reviewer)
    OR (
      -- requester is an admin: any OTHER admin of the school
      public.is_institution_admin(_requester, _institution)
      AND public.is_institution_admin(_reviewer, _institution)
    )
    OR (
      -- requester is a coordinator (and not an admin): an admin
      NOT public.is_institution_admin(_requester, _institution)
      AND EXISTS (SELECT 1 FROM public.user_roles r
                   WHERE r.user_id = _requester AND r.institution_id = _institution AND r.role = 'coordinator')
      AND public.is_institution_admin(_reviewer, _institution)
    )
    OR (
      -- requester is a teacher only: a coordinator whose wing holds one of
      -- the teacher's classes, or an admin as the fallback
      NOT public.is_institution_admin(_requester, _institution)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                       WHERE r.user_id = _requester AND r.institution_id = _institution AND r.role = 'coordinator')
      AND EXISTS (SELECT 1 FROM public.user_roles r
                   WHERE r.user_id = _requester AND r.institution_id = _institution AND r.role = 'teacher')
      AND (
        public.is_institution_admin(_reviewer, _institution)
        OR EXISTS (
          SELECT 1
            FROM public.class_assignments ca
            JOIN public.wing_class_mappings wcm ON wcm.class_id = ca.class_id
            JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
           WHERE ca.user_id = _requester AND ca.role = 'teacher'
             AND wa.user_id = _reviewer
        )
      )
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_review_staff_leave(uuid, uuid, uuid) FROM anon;
```

Check the real column names of `wing_assignments` and `wing_class_mappings` before applying; the join above is written from memory of the class-groups skill and must be verified against `information_schema.columns` (§28: never name a database object from memory).

### 2. Decision RPC

```sql
CREATE OR REPLACE FUNCTION public.review_staff_leave(p_request_id uuid, p_decision text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.staff_leave_requests%ROWTYPE;
  v_inst uuid;
  v_date date;
  v_marked int := 0;
  v_skipped int := 0;
  v_days int;
BEGIN
  -- FIRST statement, before any read: the frontend probes availability by
  -- calling with p_decision = 'probe' and relies on this raising with no
  -- side effects. Keep it first.
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.staff_leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found' USING ERRCODE = 'P0002';
  END IF;

  -- Re-derive the requester's TRUE institution from their profile; never
  -- trust the stored institution_id alone.
  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_req.user_id;
  IF v_inst IS NULL OR v_inst <> v_req.institution_id THEN
    RAISE EXCEPTION 'Request does not belong to the requester''s school' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_review_staff_leave(v_uid, v_req.user_id, v_inst) THEN
    RAISE EXCEPTION 'Not authorized to review this leave request' USING ERRCODE = '42501';
  END IF;

  v_days := (v_req.end_date - v_req.start_date) + 1;
  IF v_days > 61 THEN
    RAISE EXCEPTION 'Leave range exceeds 60 days' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_leave_requests
     SET status = p_decision, reviewed_by = v_uid, reviewed_at = now(),
         reviewer_notes = p_notes, updated_at = now()
   WHERE id = p_request_id;

  IF p_decision = 'approved' THEN
    -- One on_leave row per date. A day the person actually checked in
    -- (present / late) is left alone and counted as skipped; an auto-absent
    -- row is overwritten, because that absence was the missing leave.
    v_date := v_req.start_date;
    WHILE v_date <= v_req.end_date LOOP
      INSERT INTO public.staff_attendance_records
             (institution_id, staff_id, date, status, auto_marked_absent, check_in_at, remarks)
      VALUES (v_inst, v_req.user_id, v_date, 'on_leave', false, NULL, 'Approved leave ' || v_req.id)
      ON CONFLICT (staff_id, date) DO UPDATE
         SET status = 'on_leave', auto_marked_absent = false, remarks = EXCLUDED.remarks
       WHERE public.staff_attendance_records.status IN ('absent', 'on_leave');
      IF FOUND THEN v_marked := v_marked + 1; ELSE v_skipped := v_skipped + 1; END IF;
      v_date := v_date + 1;
    END LOOP;

    -- Balances are optional (HR sets them). Count only the three tracked
    -- types; the others are unlimited.
    IF v_req.leave_type IN ('annual','sick','casual') THEN
      UPDATE public.staff_leave_balances b
         SET annual_used = annual_used + CASE WHEN v_req.leave_type = 'annual' THEN v_days ELSE 0 END,
             sick_used   = sick_used   + CASE WHEN v_req.leave_type = 'sick'   THEN v_days ELSE 0 END,
             casual_used = casual_used + CASE WHEN v_req.leave_type = 'casual' THEN v_days ELSE 0 END,
             updated_at  = now()
       WHERE b.user_id = v_req.user_id AND b.institution_id = v_inst
         AND b.academic_year = (SELECT max(academic_year) FROM public.staff_leave_balances
                                 WHERE user_id = v_req.user_id AND institution_id = v_inst);
    END IF;
  ELSE
    -- Rejecting (including overturning an earlier approval) removes only the
    -- rows this request wrote, identified by the remarks marker, and gives
    -- the days back to the balance if it had taken them.
    DELETE FROM public.staff_attendance_records
     WHERE staff_id = v_req.user_id AND status = 'on_leave'
       AND remarks = 'Approved leave ' || v_req.id;
    GET DIAGNOSTICS v_marked = ROW_COUNT;
    IF v_marked > 0 AND v_req.leave_type IN ('annual','sick','casual') THEN
      UPDATE public.staff_leave_balances b
         SET annual_used = greatest(0, annual_used - CASE WHEN v_req.leave_type = 'annual' THEN v_days ELSE 0 END),
             sick_used   = greatest(0, sick_used   - CASE WHEN v_req.leave_type = 'sick'   THEN v_days ELSE 0 END),
             casual_used = greatest(0, casual_used - CASE WHEN v_req.leave_type = 'casual' THEN v_days ELSE 0 END),
             updated_at  = now()
       WHERE b.user_id = v_req.user_id AND b.institution_id = v_inst
         AND b.academic_year = (SELECT max(academic_year) FROM public.staff_leave_balances
                                 WHERE user_id = v_req.user_id AND institution_id = v_inst);
    END IF;
  END IF;

  RETURN jsonb_build_object('status', p_decision, 'marked', v_marked, 'skipped', v_skipped);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.review_staff_leave(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_staff_leave(uuid, text, text) TO authenticated;
```

Verify against `pg_indexes` that `staff_attendance_records` has a unique index on `(staff_id, date)`; the frontend already upserts on that pair (`useUpsertStaffAttendance`), so it should. If `remarks` does not exist on `staff_attendance_records`, add a nullable `leave_request_id uuid REFERENCES staff_leave_requests(id) ON DELETE SET NULL` instead and key the delete on it.

### 3. Policies

```sql
DROP POLICY IF EXISTS "Staff manage own leave requests" ON public.staff_leave_requests;

CREATE POLICY "Staff apply for own leave" ON public.staff_leave_requests
  FOR INSERT WITH CHECK (user_id = (select auth.uid()) AND status = 'pending' AND reviewed_by IS NULL);
CREATE POLICY "Staff view own leave" ON public.staff_leave_requests
  FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY "Staff withdraw own pending leave" ON public.staff_leave_requests
  FOR DELETE USING (user_id = (select auth.uid()) AND status = 'pending');
-- No self UPDATE. Decisions flow through review_staff_leave only.

CREATE POLICY "Reviewers view scoped staff leave" ON public.staff_leave_requests
  FOR SELECT USING (public.can_review_staff_leave((select auth.uid()), user_id, institution_id));
```

Keep `Admins full access staff leave requests` for now: the HR page's `StaffLeavePanel` still updates rows directly and would break without it. Follow-up: move that panel onto the RPC and narrow the admin policy to SELECT.

### 4. Indexes

```sql
CREATE INDEX IF NOT EXISTS staff_leave_requests_institution_status_idx ON public.staff_leave_requests (institution_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_leave_requests_user_idx ON public.staff_leave_requests (user_id, created_at DESC);
```

### 5. Verification after applying

* `information_schema.routine_privileges`: `anon` has no EXECUTE on either function.
* As a teacher: `select review_staff_leave('00000000-0000-0000-0000-000000000000','probe')` raises 22023 (the frontend probe then flips the tab on).
* As a coordinator: the Staff Leaves tab lists only teachers in that coordinator's wing; Approve writes `on_leave` rows for the dates; the next auto-absent pass leaves them alone.
* As the requester: their own request never appears in their own queue, and an UPDATE to `status` from the client is refused.

## Out of scope for v1

* Notifications to the reviewer on apply and to the requester on decision (the substitution module's edge-function pattern fits; add when asked).
* Automatic substitution planning for approved teacher leave.
* Half-day leave.
