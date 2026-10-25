-- Student-applied leave: parity with the teacher-marked path (2026-09-03)
-- ============================================================================
-- Follow-up to 20260903120000_teacher_marked_student_leave.sql, which is
-- already applied. Two defects in the STUDENT-APPLIED half:
--
--  1. A REJECTION could now write future-dated `absent` rows. The edit-window
--     exemption that fixed future/retroactive APPROVALS applies to the whole
--     decision, so rejecting a leave for next week began succeeding and
--     marking the student absent on days that have not happened - and
--     `trigger_notify_student_absent` fires AFTER INSERT, so the student was
--     told "You were marked absent in <class> on <future date>". Before the
--     exemption the call simply failed, so this is a regression the exemption
--     introduced. An approval legitimately writes future dates (the leave IS
--     granted); a rejection must not, because "not on leave" is not the same
--     as "absent" - the roster will mark that day when it arrives.
--
--  2. Nothing stopped a student from setting `leave_requests.source` itself.
--     The column landed with the student INSERT/UPDATE policies untouched, so
--     a student could POST `source='staff'` over raw PostgREST and make their
--     own application look like a leave the school granted them - which is
--     exactly the distinction the column exists to record.

-- ── 1. A rejection never writes a future date ───────────────────────────────
CREATE OR REPLACE FUNCTION public.review_student_leave(p_request_id uuid, p_decision text, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.leave_requests%ROWTYPE;
  v_inst uuid;
  v_tz text;
  v_today date;
  v_status text;
  v_date date;
  v_marked int := 0;
  v_skipped int := 0;
  v_deferred int := 0;
  v_is_off boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found' USING ERRCODE = 'P0002';
  END IF;

  -- Re-derive the class's TRUE institution (never trust the request's stored value).
  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = v_req.class_id;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Class not found for leave request' USING ERRCODE = 'P0002';
  END IF;

  -- The student must actually be enrolled in the class before any attendance is written.
  IF NOT public.student_in_class(v_req.student_id, v_req.class_id) THEN
    RAISE EXCEPTION 'Student is not enrolled in this class' USING ERRCODE = '42501';
  END IF;

  -- Authorize on the class's OWN class/institution (never via a caller arg or a
  -- possibly-forged stored institution_id).
  IF NOT public.can_review_student_leave(v_uid, v_req.class_id, v_inst) THEN
    RAISE EXCEPTION 'Not authorized to review this leave request' USING ERRCODE = '42501';
  END IF;

  IF (v_req.end_date - v_req.start_date) > 60 THEN
    RAISE EXCEPTION 'Leave range exceeds 60 days' USING ERRCODE = '22023';
  END IF;

  -- "Today" must be institution-local, never a bare now() (CLAUDE.md §24).
  SELECT i.timezone INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  -- Authority is settled above; the roster's date window must not veto a
  -- decision on a past or future leave.
  PERFORM set_config('salci.leave_write', 'on', true);

  UPDATE public.leave_requests
     SET status = p_decision, reviewed_by = v_uid, reviewed_at = now(),
         reviewer_notes = p_notes, updated_at = now()
   WHERE id = p_request_id;

  v_status := CASE WHEN p_decision = 'approved' THEN 'leave' ELSE 'absent' END;

  v_date := v_req.start_date;
  WHILE v_date <= v_req.end_date LOOP
    -- Skip if the date is a school holiday (calendar) or already marked holiday.
    SELECT
      EXISTS (SELECT 1 FROM public.cal_events ce
              WHERE ce.institution_id = v_inst AND ce.kind = 'holiday'
                AND v_date BETWEEN ce.starts_on AND ce.ends_on)
      OR EXISTS (SELECT 1 FROM public.attendance_records ar
              WHERE ar.class_id = v_req.class_id AND ar.student_id = v_req.student_id
                AND ar.date = v_date AND ar.status = 'holiday')
      INTO v_is_off;

    IF p_decision = 'rejected' AND v_date > v_today THEN
      -- "Refused" is not "absent". Writing it would mark a day that has not
      -- happened and fire the "Marked Absent" notification for a future date.
      -- Counted separately from holidays so the caller can say WHY nothing
      -- was written without guessing.
      v_deferred := v_deferred + 1;
    ELSIF v_is_off THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.attendance_records
        (institution_id, class_id, student_id, date, status, method, marked_by, remarks)
      VALUES
        (v_inst, v_req.class_id, v_req.student_id, v_date, v_status,
         'manual', NULL,
         CASE WHEN p_decision = 'approved' THEN 'Leave approved' ELSE 'Leave rejected' END)
      ON CONFLICT (class_id, student_id, date) DO UPDATE
        SET status = EXCLUDED.status,
            marked_by = attendance_records.marked_by,
            remarks = EXCLUDED.remarks, updated_at = now();
      v_marked := v_marked + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  -- Lower it again immediately. set_config(..., is_local => true) lasts to the
  -- END OF THE TRANSACTION, not the end of this function, so leaving it raised
  -- would exempt any later attendance write in the same transaction from the
  -- edit window. Each PostgREST call is its own transaction today, so nothing
  -- reachable leaks - this keeps it that way if that ever changes.
  PERFORM set_config('salci.leave_write', 'off', true);

  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  VALUES (
    v_req.student_id,
    'leave_decision',
    CASE WHEN p_decision = 'approved' THEN 'Leave approved' ELSE 'Leave rejected' END,
    'Your leave from ' || v_req.start_date::text || ' to ' || v_req.end_date::text
      || CASE WHEN p_decision = 'approved' THEN ' was approved.' ELSE ' was rejected.' END
      || COALESCE(' Note: ' || NULLIF(p_notes, ''), ''),
    '/student/attendance',
    jsonb_build_object('leave_request_id', v_req.id, 'decision', p_decision)
  );

  RETURN jsonb_build_object(
    'status', p_decision,
    'dates_marked', v_marked,
    -- Unchanged meaning: school holidays inside the range.
    'dates_skipped', v_skipped,
    -- New: dates a rejection deliberately left for the roster to mark on the day.
    'dates_deferred', v_deferred
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.review_student_leave(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_student_leave(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_student_leave(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_student_leave(uuid, text, text) TO service_role;

-- ── 2. A student may only ever create/edit a `source='student'` leave ───────
-- `source` is the only thing that distinguishes "I asked for this" from "the
-- school granted me this", and it drives the Leaves-list label plus which
-- rows the roster is allowed to withdraw. It must not be client-settable.
-- Both policies re-created with `(select auth.uid())` so the call is an
-- initplan evaluated once per statement rather than once per row (§23), and
-- the UPDATE keeps BOTH USING and WITH CHECK (§26).
DROP POLICY IF EXISTS "Students can create own leave requests" ON public.leave_requests;
CREATE POLICY "Students can create own leave requests"
  ON public.leave_requests FOR INSERT
  WITH CHECK (
    student_id = (select auth.uid())
    AND public.student_in_class((select auth.uid()), class_id)
    AND institution_id = public.get_user_institution((select auth.uid()))
    AND source = 'student'
  );

DROP POLICY IF EXISTS "Students can update own pending leave requests" ON public.leave_requests;
CREATE POLICY "Students can update own pending leave requests"
  ON public.leave_requests FOR UPDATE
  USING (
    student_id = (select auth.uid())
    AND status = 'pending'
    AND source = 'student'
  )
  WITH CHECK (
    student_id = (select auth.uid())
    AND status = 'pending'
    AND source = 'student'
  );

-- The DELETE policy already gates on status = 'pending', and a staff-marked
-- leave is born 'approved', so a student cannot withdraw one. Re-created only
-- to pick up the initplan wrapping.
DROP POLICY IF EXISTS "Students can delete own pending leave requests" ON public.leave_requests;
CREATE POLICY "Students can delete own pending leave requests"
  ON public.leave_requests FOR DELETE
  USING (
    student_id = (select auth.uid())
    AND status = 'pending'
  );

-- ── 3. Initplan-wrap the two read policies on this table ───────────────────
-- Behaviour-identical: a bare auth.uid() inside a policy is re-evaluated PER
-- ROW, and the staff one also calls a SECURITY DEFINER helper per row on a
-- table that grows with every application (§23). Wrapping makes both a single
-- initplan per statement.
DROP POLICY IF EXISTS "Staff view scoped student leaves" ON public.leave_requests;
CREATE POLICY "Staff view scoped student leaves"
  ON public.leave_requests FOR SELECT
  USING (public.can_review_student_leave((select auth.uid()), class_id, institution_id));

DROP POLICY IF EXISTS "Students can view own leave requests" ON public.leave_requests;
CREATE POLICY "Students can view own leave requests"
  ON public.leave_requests FOR SELECT
  USING (student_id = (select auth.uid()));

COMMENT ON COLUMN public.leave_requests.source IS
  'Who started this leave: ''student'' (applied for it) or ''staff'' (a teacher/admin marked it from the attendance roster, born approved). Not client-settable - the student RLS policies pin it to ''student'' and only save_class_attendance writes ''staff''.';
