-- Rollback for 20260814120000_salci_support_tasks.sql
--   and its companion 20260814130000_guard_support_task_mutations.sql
--
-- DANGER, and why this file was rewritten on 2026-08-31:
--
-- The original version dropped get_support_institution_id() but left
-- guard_support_task_mutations() and its two triggers on public.tasks in
-- place. A plpgsql body is not a tracked dependency, so the DROP succeeded and
-- every UPDATE and DELETE on tasks then raised
--   42883: function public.get_support_institution_id() does not exist
-- for every user in every school. Running it as written would have taken the
-- entire Tasks module down platform-wide.
--
-- Order is now: dependents first (policy, triggers, trigger function), then the
-- functions they call.
--
-- This also drops resolve_support_task(uuid, text, text), which is live at
-- src/components/tms/TaskDetailPanel.tsx via useResolveSupportRequest. The
-- support owner loses the Resolve action on /tasks the moment it runs.
--
-- This deliberately does NOT delete the SALCI Support institution row or any
-- support tasks already created. Dropping the institution would cascade
-- (institutions -> tasks ON DELETE CASCADE) and destroy real tickets. Remove it
-- by hand only after confirming no tasks reference it:
--   SELECT count(*) FROM tasks WHERE institution_id =
--     (SELECT id FROM institutions WHERE code = 'SALCI-SUPPORT');

-- The 2026-08-31 support thread build sits on top of these objects. Roll that
-- back first or this leaves broken functions behind rather than a clean state.
DO $$
BEGIN
  IF to_regclass('public.support_messages') IS NOT NULL THEN
    RAISE EXCEPTION
      'Run scripts/rollback-salci-support-messages.sql first: the support thread build depends on these objects.';
  END IF;
END $$;

-- 1. Dependents of get_support_institution_id(), in dependency order.
DROP POLICY IF EXISTS "Only SALCI may update support tasks" ON public.tasks;

DROP TRIGGER IF EXISTS guard_support_task_update ON public.tasks;
DROP TRIGGER IF EXISTS guard_support_task_delete ON public.tasks;
DROP FUNCTION IF EXISTS public.guard_support_task_mutations();

-- 2. The support RPCs.
DROP FUNCTION IF EXISTS public.create_support_task(text, text, text, integer, text);
DROP FUNCTION IF EXISTS public.resolve_support_task(uuid, text, text);
DROP FUNCTION IF EXISTS public.set_support_ticket_status(uuid, text, text);
-- Both signatures: the 2026-08-14 build shipped (uuid, text), and Phase 2 of the
-- 2026-08-31 build replaces it with (uuid, text, text) for the p_status scope.
-- Naming only one leaves the other standing.
DROP FUNCTION IF EXISTS public.support_inbox_counts(uuid, text);
DROP FUNCTION IF EXISTS public.support_inbox_counts(uuid, text, text);

-- 3. Only now the helpers everything above called.
DROP FUNCTION IF EXISTS public.get_support_owner_id();
DROP FUNCTION IF EXISTS public.get_support_institution_id();

DROP TABLE IF EXISTS public.support_settings;

-- Keeps the intake rows; only unlinks them from tasks.
ALTER TABLE public.reported_issues DROP COLUMN IF EXISTS task_id;

DROP INDEX IF EXISTS public.idx_reported_issues_task_id;
DROP INDEX IF EXISTS public.idx_reported_issues_reporter_created;
DROP INDEX IF EXISTS public.idx_reported_issues_status_created;
DROP INDEX IF EXISTS public.idx_reported_issues_institution;

-- Verify nothing is left calling a dropped helper:
--   SELECT n.nspname, p.proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE p.prosrc ILIKE '%get_support_institution_id%';
-- Expect zero rows.
