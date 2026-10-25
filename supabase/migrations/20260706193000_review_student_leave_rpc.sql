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

  -- Authorize on the request's OWN class/institution (never via a caller arg).
  IF NOT public.can_review_student_leave(v_uid, v_req.class_id, v_req.institution_id) THEN
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
              WHERE ce.institution_id = v_req.institution_id AND ce.kind = 'holiday'
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
        (v_req.institution_id, v_req.class_id, v_req.student_id, v_date, v_status,
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

REVOKE ALL ON FUNCTION public.review_student_leave(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.review_student_leave(uuid, text, text) TO authenticated;
