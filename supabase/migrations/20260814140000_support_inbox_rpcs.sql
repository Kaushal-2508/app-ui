-- ============================================================================
-- Support Inbox (/admin/issues) server side
--
-- Two RPCs so the redesigned inbox never counts rows client-side and never
-- issues two dependent writes from the browser:
--
--   support_inbox_counts()      per-status counts computed in Postgres
--   set_support_ticket_status() intake row + linked task moved together
--
-- Companion to 20260814120000_salci_support_tasks.sql, which made every new
-- support request a `tasks` row linked from reported_issues.task_id. Legacy
-- rows (the 24 that pre-date it) have task_id NULL and simply skip the task
-- half.
-- ============================================================================

-- Backs both the list ordering and the status tabs.
CREATE INDEX IF NOT EXISTS idx_reported_issues_status_created
  ON public.reported_issues(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reported_issues_institution
  ON public.reported_issues(institution_id);

-- ---------------------------------------------------------------------------
-- Per-status counts, honouring the same filters as the list so the tab badges
-- always match what the user is looking at.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_inbox_counts(
  p_institution_id uuid DEFAULT NULL,
  p_role           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only SALCI support can view the support inbox.';
  END IF;

  SELECT jsonb_build_object(
    'open',        count(*) FILTER (WHERE status = 'open'),
    'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
    'resolved',    count(*) FILTER (WHERE status = 'resolved'),
    'closed',      count(*) FILTER (WHERE status = 'closed'),
    'total',       count(*)
  )
  INTO v
  FROM public.reported_issues
  WHERE (p_institution_id IS NULL OR institution_id = p_institution_id)
    AND (p_role IS NULL OR reporter_role = p_role);

  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.support_inbox_counts(uuid, text) IS
  'Per-status counts for the Salci Support inbox. Super admins only.';

-- ---------------------------------------------------------------------------
-- Move a ticket, and its linked task, in ONE transaction.
--
-- Task mapping, chosen to fit validate_task_state_transition()'s check-list
-- (which has no rule for these pairs, and no trailing ELSE):
--   resolved    -> tasks.completed
--   closed      -> tasks.rejected
--   in_progress -> tasks.in_progress   (allowed: the actor IS the assignee)
--   open        -> task left alone; there is no path back from completed
--
-- A task already completed is never touched: the trigger raises
-- 'Completed tasks cannot be modified'.
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
  FROM public.reported_issues
  WHERE id = p_ticket_id;

  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  UPDATE public.reported_issues
  SET status      = p_status,
      admin_notes = coalesce(v_note, admin_notes),
      updated_at  = now()
  WHERE id = p_ticket_id;

  IF v_task IS NULL THEN
    RETURN;  -- legacy ticket with no task behind it
  END IF;

  SELECT status INTO v_task_status FROM public.tasks WHERE id = v_task;
  IF v_task_status IS NULL OR v_task_status = 'completed' THEN
    RETURN;
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
  'Move a Salci Support ticket and its linked task together. Super admins only.';

-- Supabase grants EXECUTE to anon on every new public function by default.
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text) FROM anon;