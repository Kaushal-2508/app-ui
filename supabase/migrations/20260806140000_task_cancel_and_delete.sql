-- =====================================================================
-- Task deletion and cancellation
-- =====================================================================
-- Two different escape hatches for the person who created a task (or an
-- admin), depending on whether anyone has started work yet:
--
--   * NOT STARTED (status = 'open')  -> DELETE. Nothing of value exists, so
--     the row goes and every child cascades with it.
--   * STARTED                        -> CANCEL. Work already exists, so
--     nothing is destroyed. The task freezes exactly where it is.
--
-- Cancelling is TERMINAL (product decision 2026-08-06): a cancelled task can
-- be neither resumed nor deleted. It stays in Pending as the record that the
-- work was stopped. There is deliberately no resume_task function.
--
-- Cancellation is modelled as an OVERLAY (`cancelled_at`), not as a new
-- `task_status` value. That is deliberate:
--
--   * "all the progress done till the cancel gets saved" is literal — status,
--     evidence and comments are untouched, so resuming restores the exact
--     state rather than reconstructing it.
--   * `task_status` is referenced by validate_task_state_transition, several
--     dashboard RPCs and every exhaustive switch in the frontend. Adding an
--     enum value would touch all of them, and ALTER TYPE ... ADD VALUE cannot
--     be used in the same transaction that adds it.
--
-- "Everything is paused" is enforced in the database, not just hidden in the
-- UI: no status transition and no new evidence while cancelled_at is set.
-- =====================================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ,
  -- Authorship column: the row must survive the canceller being deleted (§21).
  ADD COLUMN IF NOT EXISTS cancelled_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

COMMENT ON COLUMN public.tasks.cancelled_at IS
  'Set while a task is paused. The task keeps its status, evidence and comments; resuming clears this. NULL = active.';

-- Cancelled rows are a small minority, and every list filters on them.
CREATE INDEX IF NOT EXISTS idx_tasks_cancelled_at
  ON public.tasks (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

-- §23: every new FK gets an index in the same migration.
CREATE INDEX IF NOT EXISTS idx_tasks_cancelled_by
  ON public.tasks (cancelled_by);


-- ---------------------------------------------------------------------
-- Freeze 1: no status movement while cancelled
-- ---------------------------------------------------------------------
-- Replaces validate_task_state_transition VERBATIM (captured from prod
-- 2026-08-06) plus the cancellation guard. The trigger is
-- `BEFORE UPDATE OF status ... WHEN (old.status IS DISTINCT FROM new.status)`,
-- so this only runs on real status changes and never blocks the cancel/resume
-- writes themselves.
CREATE OR REPLACE FUNCTION public.validate_task_state_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assigner_id UUID;
  v_assignee_id UUID;
  v_actor_id UUID;
BEGIN
  -- Get actor (current user)
  v_actor_id := auth.uid();

  -- A cancelled task is frozen. Resuming clears cancelled_at in the same
  -- statement, so that case passes through untouched.
  IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This task is cancelled. Resume it before changing its status.';
  END IF;

  -- Get assignment info
  SELECT assigner_id, assignee_id INTO v_assigner_id, v_assignee_id
  FROM public.task_assignments WHERE task_id = NEW.id;

  -- Rule 1: Only assignee can move to in_progress
  IF OLD.status = 'open' AND NEW.status = 'in_progress' THEN
    IF v_actor_id != v_assignee_id THEN
      RAISE EXCEPTION 'Only the assignee can start a task';
    END IF;
  END IF;

  -- Rule 2: Only assignee can submit for approval, and evidence required
  IF OLD.status = 'in_progress' AND NEW.status = 'done_pending_approval' THEN
    IF v_actor_id != v_assignee_id THEN
      RAISE EXCEPTION 'Only the assignee can submit task for approval';
    END IF;
    IF NOT public.task_has_evidence(NEW.id) THEN
      RAISE EXCEPTION 'Evidence is required before submitting for approval';
    END IF;
  END IF;

  -- Rule 3: Only assigner can approve (no self-approval)
  IF OLD.status = 'done_pending_approval' AND NEW.status = 'completed' THEN
    IF v_actor_id != v_assigner_id THEN
      RAISE EXCEPTION 'Only the task assigner can approve completion';
    END IF;
    IF v_actor_id = v_assignee_id THEN
      RAISE EXCEPTION 'Self-approval is not allowed';
    END IF;
  END IF;

  -- Rule 4: Only assigner can reject
  IF OLD.status = 'done_pending_approval' AND NEW.status = 'rejected' THEN
    IF v_actor_id != v_assigner_id THEN
      RAISE EXCEPTION 'Only the task assigner can reject';
    END IF;
  END IF;

  -- Rule 5: Rejected tasks can only go to in_progress (by assignee)
  IF OLD.status = 'rejected' AND NEW.status = 'in_progress' THEN
    IF v_actor_id != v_assignee_id THEN
      RAISE EXCEPTION 'Only the assignee can rework a rejected task';
    END IF;
  END IF;

  -- Prevent invalid transitions
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Completed tasks cannot be modified';
  END IF;

  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------
-- Freeze 2: no new evidence while cancelled
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_evidence_on_cancelled_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tasks
     WHERE id = NEW.task_id AND cancelled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This task is cancelled. You cannot add evidence until it is resumed.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_evidence_on_cancelled_task ON public.task_evidence;
CREATE TRIGGER block_evidence_on_cancelled_task
  BEFORE INSERT ON public.task_evidence
  FOR EACH ROW EXECUTE FUNCTION public.block_evidence_on_cancelled_task();


-- ---------------------------------------------------------------------
-- Who may delete / cancel / resume a task
-- ---------------------------------------------------------------------
-- The task's creator, or a school admin of that institution, or a super
-- admin. Auto-generated tasks have assigner_id NULL, so only admins qualify.
CREATE OR REPLACE FUNCTION public.can_manage_task(_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tasks t
      LEFT JOIN public.task_assignments ta ON ta.task_id = t.id
     WHERE t.id = _task_id
       AND (
         ta.assigner_id = auth.uid()
         OR public.has_role_at_institution(auth.uid(), 'school_admin', t.institution_id)
         OR public.has_role(auth.uid(), 'super_admin')
       )
  )
$$;


-- ---------------------------------------------------------------------
-- delete_task — ONLY while the task is untouched: still 'open' and not
-- cancelled. Children cascade (assignments, evidence, comments, links, audit
-- logs); dashboard_flags.task_id is SET NULL.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_task(
  p_task_id        UUID,
  p_apply_to_group BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   UUID;
  v_ids     UUID[];
  v_blocked INT;
  v_deleted INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You need to be signed in to delete a task';
  END IF;

  IF NOT public.can_manage_task(p_task_id) THEN
    RAISE EXCEPTION 'Only the person who created this task, or a school admin, can delete it';
  END IF;

  SELECT task_group_id INTO v_group FROM public.tasks WHERE id = p_task_id;

  IF p_apply_to_group AND v_group IS NOT NULL THEN
    SELECT array_agg(id) INTO v_ids FROM public.tasks WHERE task_group_id = v_group;
  ELSE
    v_ids := ARRAY[p_task_id];
  END IF;

  -- Only untouched work may be deleted. Anything started must be cancelled
  -- instead, and a cancelled task is a permanent record that cannot be
  -- cleared away.
  SELECT count(*) INTO v_blocked
    FROM public.tasks
   WHERE id = ANY(v_ids)
     AND (status <> 'open' OR cancelled_at IS NOT NULL);

  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'This task can no longer be deleted. Work has started on it, or it was cancelled.';
  END IF;

  DELETE FROM public.tasks WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted, 'task_group_id', v_group);
END;
$$;


-- ---------------------------------------------------------------------
-- cancel_task — freeze in place. Nothing is destroyed: status, evidence and
-- comments stay exactly as they are so a resume restores the real state.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_task(
  p_task_id        UUID,
  p_reason         TEXT DEFAULT NULL,
  p_apply_to_group BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     UUID := auth.uid();
  v_group     UUID;
  v_ids       UUID[];
  v_cancelled INT;
  v_reason    TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You need to be signed in to cancel a task';
  END IF;

  IF NOT public.can_manage_task(p_task_id) THEN
    RAISE EXCEPTION 'Only the person who created this task, or a school admin, can cancel it';
  END IF;

  SELECT task_group_id INTO v_group FROM public.tasks WHERE id = p_task_id;

  IF p_apply_to_group AND v_group IS NOT NULL THEN
    SELECT array_agg(id) INTO v_ids FROM public.tasks WHERE task_group_id = v_group;
  ELSE
    v_ids := ARRAY[p_task_id];
  END IF;

  -- Completed work is closed; the state trigger forbids touching it at all.
  UPDATE public.tasks
     SET cancelled_at  = now(),
         cancelled_by  = v_actor,
         cancel_reason = v_reason
   WHERE id = ANY(v_ids)
     AND cancelled_at IS NULL
     AND status <> 'completed';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  IF v_cancelled = 0 THEN
    RAISE EXCEPTION 'Nothing to cancel here. The task is already cancelled or already completed.';
  END IF;

  -- Tell the people whose work just stopped.
  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  SELECT ta.assignee_id,
         'task_cancelled',
         'Task Cancelled',
         'Your task "' || t.title || '" has been cancelled and is now paused.'
           || CASE WHEN v_reason IS NOT NULL THEN ' Reason: ' || v_reason ELSE '' END,
         '/tasks',
         jsonb_build_object('task_id', t.id)
    FROM public.tasks t
    JOIN public.task_assignments ta ON ta.task_id = t.id
   WHERE t.id = ANY(v_ids)
     AND ta.assignee_id IS DISTINCT FROM v_actor;

  RETURN jsonb_build_object('cancelled', v_cancelled, 'task_group_id', v_group);
END;
$$;


-- No resume_task by design: cancelling is terminal. If a task needs to
-- restart, a new one is assigned.
DROP FUNCTION IF EXISTS public.resume_task(UUID, BOOLEAN);


-- ---------------------------------------------------------------------
-- Grants. Supabase's default privileges grant EXECUTE to anon on every new
-- function in `public`, and REVOKE ... FROM PUBLIC does NOT remove it, so
-- each one is revoked from anon by name.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.can_manage_task(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_task(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_task(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_manage_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_task(UUID, TEXT, BOOLEAN) TO authenticated;
