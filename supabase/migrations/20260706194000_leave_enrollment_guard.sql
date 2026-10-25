-- Security hardening: close the cross-tenant leave-forgery path.
-- The pre-existing leave_requests INSERT policy only checked student_id = auth.uid(),
-- letting a student create a request for ANY class_id / institution_id. Once approval
-- writes attendance_records, that becomes an attendance-forgery / cross-tenant write.
-- Defense in depth: (1) constrain INSERT to the student's real enrollment + institution;
-- (2) re-derive the true institution from the class inside the RPC and require enrollment,
-- so a forged row (if one ever existed) still cannot produce a bad attendance write.

-- (1) Enrollment helper.
CREATE OR REPLACE FUNCTION public.student_in_class(_student uuid, _class uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = _student AND ca.class_id = _class AND ca.role = 'student'
  );
$$;

-- (2) Tighten the student INSERT policy: own row, own class, own institution.
DROP POLICY IF EXISTS "Students can create own leave requests" ON public.leave_requests;
CREATE POLICY "Students can create own leave requests"
  ON public.leave_requests FOR INSERT
  WITH CHECK (
    student_id = auth.uid()
    AND public.student_in_class(auth.uid(), class_id)
    AND institution_id = public.get_user_institution(auth.uid())
  );

-- (3) Align helper search_path hygiene (add pg_temp).
CREATE OR REPLACE FUNCTION public.can_review_student_leave(
  _user uuid, _class uuid, _institution uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.is_teacher_for_class(_user, _class)
      OR public.is_coordinator_for_class(_user, _class)
      OR public.is_institution_admin(_user, _institution)
      OR public.is_super_admin(_user);
$$;

-- (4) Harden the RPC: trust the CLASS's real institution, not the request's stored value,
-- and require the student to actually be enrolled before writing any attendance.
CREATE OR REPLACE FUNCTION public.review_student_leave(
  p_request_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.leave_requests%ROWTYPE;
  v_inst uuid;
  v_status text;
  v_date date;
  v_marked int := 0;
  v_skipped int := 0;
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

  UPDATE public.leave_requests
     SET status = p_decision, reviewed_by = v_uid, reviewed_at = now(),
         reviewer_notes = p_notes, updated_at = now()
   WHERE id = p_request_id;

  v_status := CASE WHEN p_decision = 'approved' THEN 'present' ELSE 'absent' END;

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

    IF v_is_off THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.attendance_records
        (institution_id, class_id, student_id, date, status, method, marked_by, remarks)
      VALUES
        (v_inst, v_req.class_id, v_req.student_id, v_date, v_status,
         'manual', v_uid,
         CASE WHEN p_decision = 'approved' THEN 'Leave approved' ELSE 'Leave rejected' END)
      ON CONFLICT (class_id, student_id, date) DO UPDATE
        SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by,
            remarks = EXCLUDED.remarks, updated_at = now();
      v_marked := v_marked + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

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

  RETURN jsonb_build_object('status', p_decision, 'dates_marked', v_marked, 'dates_skipped', v_skipped);
END;
$$;
