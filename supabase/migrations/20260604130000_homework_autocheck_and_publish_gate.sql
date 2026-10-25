-- =====================================================================
-- Homework refined behavior, Phase C.
--
-- R3: assignments that do NOT carry marks auto-move to status='checked'
--     once due_at passes, with no teacher action. A SECURITY DEFINER pass
--     + a 15-min pg_cron job perform the transition (due_at is timestamptz,
--     an absolute instant, so no timezone handling needed).
--
-- R4: MARKED assignments can only be published when (a) every assigned
--     student has submitted OR the due date has passed, AND (b) every
--     submission is graded/skipped. (b) already existed; (a) is added.
--     Unmarked "Mark as Checked" keeps no gate (R3 auto-move covers it).
-- =====================================================================

-- ---------------------------------------------------------------------
-- R3: auto-check pass for unmarked, past-due, published assignments.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_auto_check_pass()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE public.homework_assignments
       SET status = 'checked', checked_at = now()
     WHERE carries_marks = false
       AND status = 'published'
       AND due_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_auto_check_pass() FROM public;

do $$
begin
  perform cron.unschedule('homework-autocheck-15min');
exception when others then null;
end;
$$;

select cron.schedule(
  'homework-autocheck-15min',
  '*/15 * * * *',
  $job$ select public.homework_auto_check_pass(); $job$
);

-- ---------------------------------------------------------------------
-- R4: publish gate. (a) all submitted OR due passed (marked only) + (b).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_publish_marks(_homework_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_status       text;
  v_carries      boolean;
  v_due          timestamptz;
  v_unprocessed  integer;
  v_missing      integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF NOT public.can_manage_homework(v_uid, _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT status, carries_marks, due_at
    INTO v_status, v_carries, v_due
    FROM public.homework_assignments WHERE id = _homework_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  IF v_status = 'draft' THEN RAISE EXCEPTION 'Publish the assignment before marking.'; END IF;

  IF v_carries THEN
    -- (a) everyone submitted OR due has passed
    IF v_due > now() THEN
      SELECT count(*) INTO v_missing FROM (
        SELECT DISTINCT ca.user_id
        FROM public.homework_assignment_classes hac
        JOIN public.class_assignments ca
          ON ca.class_id = hac.class_id AND ca.role = 'student'
        WHERE hac.homework_assignment_id = _homework_id
          AND NOT EXISTS (
            SELECT 1 FROM public.homework_submissions s
            WHERE s.homework_assignment_id = _homework_id AND s.student_id = ca.user_id
          )
      ) x;
      IF v_missing > 0 THEN
        RAISE EXCEPTION 'Wait until everyone submits or the due date passes (% student(s) have not submitted yet).', v_missing;
      END IF;
    END IF;

    -- (b) every submission marked
    SELECT count(*) INTO v_unprocessed
    FROM public.homework_submissions s
    LEFT JOIN public.homework_results r ON r.submission_id = s.id
    WHERE s.homework_assignment_id = _homework_id
      AND (r.id IS NULL OR r.status NOT IN ('graded','skipped'));
    IF v_unprocessed > 0 THEN
      RAISE EXCEPTION '% submission(s) not yet marked.', v_unprocessed;
    END IF;
  END IF;

  UPDATE public.homework_assignments
    SET status = 'checked', evaluated_by = v_uid, checked_at = now()
    WHERE id = _homework_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.homework_publish_marks(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_publish_marks(uuid) TO authenticated;
