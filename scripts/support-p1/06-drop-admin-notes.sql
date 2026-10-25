-- ---------------------------------------------------------------------------
-- 6. Close the confidentiality hole at the schema level
--
-- The field the inbox labels "Internal notes" is reported_issues.admin_notes,
-- and the SELECT policy is
--   reporter_id = auth.uid() OR is_super_admin(auth.uid())
-- so every reporter could read SALCI's notes on their own ticket. 14 rows hold
-- such text today. Not rendering the column would not have fixed anything; the
-- column has to go, and the policy has to stop admitting reporters.
--
-- Order matters. The two live RPCs both write admin_notes, so they are
-- rewritten FIRST. These are interim bodies: phase 2 replaces both with thin
-- wrappers over _support_apply_status. Signatures are untouched here, so
-- nothing on the client moves. set_support_ticket_status keeps RETURNS void
-- until phase 2 DROPs and recreates it as RETURNS jsonb.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_support_ticket_status(
  p_ticket_id uuid,
  p_status    text,
  p_note      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_task        uuid;
  v_task_status public.task_status;
  v_note        text;
  v_found       boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can update a support request.';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown status for a support request.';
  END IF;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  SELECT true, task_id INTO v_found, v_task
  FROM public.reported_issues WHERE id = p_ticket_id;

  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  UPDATE public.reported_issues
  SET status      = p_status,
      resolved_at = CASE
                      WHEN p_status IN ('resolved', 'closed') THEN coalesce(resolved_at, now())
                      ELSE NULL
                    END,
      updated_at  = now()
  WHERE id = p_ticket_id;

  -- The note lands in the thread as a genuinely private message instead of in
  -- a column the reporter can read.
  IF v_note IS NOT NULL THEN
    INSERT INTO public.support_messages (
      ticket_id, author_id, author_name, author_side, kind, body, is_internal
    )
    VALUES (
      p_ticket_id,
      (SELECT p.id FROM public.profiles p WHERE p.id = v_uid),
      coalesce((SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid), 'SALCI Support'),
      'salci',
      'message',
      v_note,
      true
    );
  END IF;

  IF v_task IS NULL THEN
    RETURN;  -- legacy ticket with no task behind it
  END IF;

  SELECT status INTO v_task_status FROM public.tasks WHERE id = v_task;
  IF v_task_status IS NULL OR v_task_status = 'completed' THEN
    RETURN;
  END IF;

  -- Step off the approval dead-end before closing: from
  -- done_pending_approval the normal ladder needs the ASSIGNER, who on a
  -- support ticket is the reporter, and the RESTRICTIVE policy blocks them.
  IF v_task_status = 'done_pending_approval' AND p_status IN ('resolved', 'closed') THEN
    UPDATE public.tasks SET status = 'in_progress' WHERE id = v_task;
    v_task_status := 'in_progress';
  END IF;

  IF p_status = 'resolved' THEN
    UPDATE public.tasks SET status = 'completed'
    WHERE id = v_task AND status IN ('open', 'in_progress', 'rejected');
  ELSIF p_status = 'closed' THEN
    UPDATE public.tasks SET status = 'rejected'
    WHERE id = v_task AND status IN ('open', 'in_progress');
  ELSIF p_status = 'in_progress' THEN
    UPDATE public.tasks SET status = 'in_progress'
    WHERE id = v_task AND status = 'open';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_support_ticket_status(uuid, text, text) IS
  'Move a Salci Support ticket and its linked task together, and file any note as an internal thread message. Super admins only. Interim body: phase 2 replaces this with a wrapper over _support_apply_status.';

CREATE OR REPLACE FUNCTION public.resolve_support_task(
  p_task_id uuid,
  p_outcome text,
  p_note    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_inst      uuid;
  v_task_inst uuid;
  v_status    public.task_status;
  v_new       public.task_status;
  v_note      text;
  v_rows      integer;
  v_ticket    uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can resolve a support request.';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'rejected') THEN
    RAISE EXCEPTION 'Unknown outcome for a support request.';
  END IF;
  v_new := p_outcome::public.task_status;

  v_inst := public.get_support_institution_id();

  SELECT institution_id, status INTO v_task_inst, v_status
  FROM public.tasks WHERE id = p_task_id;

  IF v_task_inst IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  IF v_inst IS NULL OR v_task_inst <> v_inst THEN
    RAISE EXCEPTION 'That task is not a support request.';
  END IF;

  SELECT id INTO v_ticket FROM public.reported_issues WHERE task_id = p_task_id LIMIT 1;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  IF v_note IS NOT NULL THEN
    INSERT INTO public.task_comments (task_id, user_id, content)
    VALUES (p_task_id, v_uid, v_note);

    IF v_ticket IS NOT NULL THEN
      INSERT INTO public.support_messages (
        ticket_id, author_id, author_name, author_side, kind, body, is_internal
      )
      VALUES (
        v_ticket,
        (SELECT p.id FROM public.profiles p WHERE p.id = v_uid),
        coalesce((SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid), 'SALCI Support'),
        'salci',
        'message',
        v_note,
        true
      );
    END IF;
  END IF;

  -- Already where we want it: mirror the intake row and stop, so a double
  -- click never raises 'Completed tasks cannot be modified'.
  IF v_status = 'completed' OR v_status = v_new THEN
    UPDATE public.reported_issues
    SET status      = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
        resolved_at = coalesce(resolved_at, now()),
        updated_at  = now()
    WHERE task_id = p_task_id;
    RETURN;
  END IF;

  IF v_status = 'done_pending_approval' THEN
    UPDATE public.tasks SET status = 'in_progress' WHERE id = p_task_id;
    v_status := 'in_progress';
  END IF;

  UPDATE public.tasks
  SET status = v_new
  WHERE id = p_task_id
    AND status IN ('open', 'in_progress', 'rejected');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Never mirror a change that did not happen.
    RAISE EXCEPTION 'Could not update this support request. Please refresh and try again.';
  END IF;

  UPDATE public.reported_issues
  SET status      = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
      resolved_at = coalesce(resolved_at, now()),
      updated_at  = now()
  WHERE task_id = p_task_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_support_task(uuid, text, text) IS
  'Resolve a Salci Support ticket from /tasks. Super admins only; asserts the task belongs to the SALCI Support institution. Interim body: phase 2 replaces this with a wrapper over _support_apply_status.';

-- Nothing writes the column any more, so it can go. This, not a UI label, is
-- what closes the leak.
ALTER TABLE public.reported_issues DROP COLUMN IF EXISTS admin_notes;

-- Narrow the read. The only client readers are the two super-admin inbox
-- hooks in src/hooks/useReportedIssues.ts, re-verified before applying.
-- Reporters read exclusively through list_my_support_tickets() from phase 2,
-- which returns an explicit column list.
--
-- The "Users can insert own reports" INSERT policy becomes dead (every insert
-- goes through create_support_task) but is left in place: removing it is an
-- unrelated cleanup and this migration is already wide enough.
DROP POLICY IF EXISTS "Users can view own reports" ON public.reported_issues;
DROP POLICY IF EXISTS "Super admins view all reports" ON public.reported_issues;
CREATE POLICY "Super admins view all reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));
