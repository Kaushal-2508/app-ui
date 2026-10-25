-- ============================================================================
-- Salci Support hardening, from the adversarial review of the 2026-08-14 change
--
-- 1. The `REVOKE ... FROM anon` in 20260814120000 was INEFFECTIVE.
--
--    Checking `information_schema.routine_privileges WHERE grantee='anon'`
--    returned nothing and looked clean, but that view does not expand PUBLIC
--    membership. The real ACL was:
--
--      =X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
--       ^^^^^^^^^^ empty grantee == PUBLIC
--
--    anon is a member of PUBLIC, so it still held EXECUTE on all six support
--    functions. get_support_owner_id() leaked the support owner's uuid and
--    get_support_institution_id() leaked the marker the whole authority model
--    is keyed on, to anyone holding the public anon key.
--
--    CLAUDE.md section 11 says to revoke from anon BY NAME because
--    REVOKE FROM PUBLIC alone does not strip an explicit anon grant. The
--    converse is equally true and is the half that bit here: revoking anon by
--    name does not strip the PUBLIC grant. BOTH are required.
--
--    Verify with pg_proc.proacl, NOT information_schema:
--      SELECT proname, array_to_string(proacl,' | ') FROM pg_proc ...
--    A leading `=X/postgres` entry means PUBLIC still has EXECUTE.
--
-- 2. resolve_support_task could report success while changing nothing, and
--    dead-ended on done_pending_approval.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 2. resolve_support_task: handle done_pending_approval, never lie about success
--
-- A support ticket can reach done_pending_approval (the assignee is the support
-- owner, and the card surface offers "Mark as Done"). From there the normal
-- ladder needs the ASSIGNER to approve, and the assigner is the reporter, who
-- is blocked by the RESTRICTIVE policy. The ticket would be stuck forever while
-- the RPC's UPDATE matched zero rows and reported_issues still flipped to
-- resolved: a silent divergence.
--
-- done_pending_approval -> in_progress is an unguarded pair in
-- validate_task_state_transition(), so step back through it, then close.
-- ---------------------------------------------------------------------------
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

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  IF v_note IS NOT NULL THEN
    INSERT INTO public.task_comments (task_id, user_id, content)
    VALUES (p_task_id, v_uid, v_note);
  END IF;

  -- Already where we want it: mirror the intake row and stop. Covers the
  -- double-click case without raising 'Completed tasks cannot be modified'.
  IF v_status = 'completed' OR v_status = v_new THEN
    UPDATE public.reported_issues
    SET status = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
        admin_notes = coalesce(v_note, admin_notes),
        updated_at = now()
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
  SET status = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
      admin_notes = coalesce(v_note, admin_notes),
      updated_at = now()
  WHERE task_id = p_task_id;
END;
$$;

-- Same dead-end handling for the inbox path.
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
      admin_notes = coalesce(v_note, admin_notes),
      updated_at  = now()
  WHERE id = p_ticket_id;

  IF v_task IS NULL THEN
    RETURN;
  END IF;

  SELECT status INTO v_task_status FROM public.tasks WHERE id = v_task;
  IF v_task_status IS NULL OR v_task_status = 'completed' THEN
    RETURN;
  END IF;

  -- Step off the approval dead-end before closing (see above).
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

-- ---------------------------------------------------------------------------
-- 1. Strip the PUBLIC grant. `authenticated` keeps its explicit grant, which is
--    what the RESTRICTIVE policy on tasks needs to call
--    get_support_institution_id() as the querying user.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_support_owner_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_support_institution_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_support_owner_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_support_institution_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text) FROM anon;