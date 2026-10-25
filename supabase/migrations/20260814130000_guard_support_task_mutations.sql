-- ============================================================================
-- Guard support tasks against the SECURITY DEFINER escape hatches
--
-- Companion to 20260814120000_salci_support_tasks.sql.
--
-- The RESTRICTIVE policy added there covers the PostgREST path, but it does NOT
-- cover `delete_task` and `cancel_task`: both are SECURITY DEFINER RPCs, so
-- they bypass RLS entirely. Their permission model is `canManageTask`, which
-- grants rights to the task's ASSIGNER -- and on a support ticket the assigner
-- is the REPORTER. Without this guard a teacher could delete the support
-- request they filed, or (once SALCI started work) cancel it, freezing SALCI's
-- own work item.
--
-- A trigger rather than a rewrite of those two RPCs: triggers fire inside
-- SECURITY DEFINER functions too, and this keeps the shared task RPCs
-- untouched.
--
-- Fail-open for ordinary tasks by construction: when the support institution
-- is missing, get_support_institution_id() returns NULL, `institution_id = NULL`
-- is NULL (not true), and nothing raises. Same reasoning as the IS DISTINCT FROM
-- in the RESTRICTIVE policy.
--
-- Note auth.uid() is NULL for service_role / cron callers, and
-- is_super_admin(NULL) is false, so those are denied on support tasks too.
-- That is the safe direction; nothing writes support tasks out of band today.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_support_task_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- AND short-circuits, so is_super_admin() is only evaluated for the
    -- handful of rows that live in the support institution.
    IF OLD.institution_id = public.get_support_institution_id()
       AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only SALCI support can remove a support request.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE. Catches cancel_task (which writes cancelled_at) and any future
  -- DEFINER path that would otherwise sidestep the RESTRICTIVE policy.
  IF NEW.institution_id = public.get_support_institution_id()
     AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only SALCI support can change a support request.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_support_task_mutations() IS
  'Blocks non-super-admins from updating or deleting tasks in the SALCI Support institution, including through the SECURITY DEFINER delete_task / cancel_task RPCs.';

DROP TRIGGER IF EXISTS guard_support_task_update ON public.tasks;
CREATE TRIGGER guard_support_task_update
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_support_task_mutations();

DROP TRIGGER IF EXISTS guard_support_task_delete ON public.tasks;
CREATE TRIGGER guard_support_task_delete
  BEFORE DELETE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_support_task_mutations();