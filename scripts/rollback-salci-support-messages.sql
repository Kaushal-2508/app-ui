-- Rollback for supabase/migrations/20260831120000_support_messages_and_thread.sql
--
-- BREAK GLASS ONLY. Step 3 restores the "Users can view own reports" SELECT
-- policy, and step 1 restores admin_notes with its 14 rows of SALCI notes.
-- Together they REINSTATE THE CONFIDENTIALITY LEAK the migration existed to
-- close: every reporter can once again read SALCI's private notes on their own
-- ticket. Do not run this to tidy up. Run it only to recover a broken
-- production, and re-apply the forward migration as soon as the cause is fixed.
--
-- Run through the Management API:
--   powershell -File scripts/run-sql.ps1 -SqlFile scripts/rollback-salci-support-messages.sql -OutFile "%TEMP%\rollback.json"
--
-- Order matters throughout: the RPCs are restored before the column they write
-- is dropped from under them, and support_messages goes before the helpers its
-- policy calls.

-- ---------------------------------------------------------------------------
-- 0. Refuse to run if phase 2 or later shipped
--
-- _support_apply_status and the jsonb set_support_ticket_status are built on
-- support_messages. Dropping the table under them leaves broken functions
-- rather than a clean rollback.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_support_apply_status'
  ) THEN
    RAISE EXCEPTION
      'Phase 2 is applied. Roll back the support RPCs first, then run this script.';
  END IF;

  IF to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NULL THEN
    RAISE EXCEPTION
      'The pre-migration backup is missing. Without it admin_notes cannot be restored; do not continue.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Restore admin_notes and its 14 rows from the backup
-- ---------------------------------------------------------------------------
ALTER TABLE public.reported_issues ADD COLUMN IF NOT EXISTS admin_notes text;

UPDATE public.reported_issues r
SET admin_notes = b.admin_notes
FROM salci_backups.reported_issues_pre_messages_20260831 b
WHERE b.id = r.id
  AND b.admin_notes IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Restore the two RPC bodies exactly as 20260814150000 left them
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
    RAISE EXCEPTION 'Could not update this support request. Please refresh and try again.';
  END IF;

  UPDATE public.reported_issues
  SET status = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
      admin_notes = coalesce(v_note, admin_notes),
      updated_at = now()
  WHERE task_id = p_task_id;
END;
$$;

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
-- 3. Restore the original SELECT policy. THIS REINSTATES THE LEAK.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Super admins view all reports" ON public.reported_issues;
DROP POLICY IF EXISTS "Users can view own reports" ON public.reported_issues;
CREATE POLICY "Users can view own reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Drop the added columns, constraint and index
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_reported_issues_last_message;

ALTER TABLE public.reported_issues
  DROP CONSTRAINT IF EXISTS reported_issues_status_check;

ALTER TABLE public.reported_issues
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS last_message_at,
  DROP COLUMN IF EXISTS reporter_last_read_at,
  DROP COLUMN IF EXISTS salci_last_read_at,
  DROP COLUMN IF EXISTS first_response_at,
  DROP COLUMN IF EXISTS resolved_at;

-- ---------------------------------------------------------------------------
-- 5. Restore reporter_id to NOT NULL + ON DELETE CASCADE
--
-- Only when no row has already been nulled by a user deletion. If one has, the
-- NOT NULL cannot be restored without destroying that ticket, so the FK is
-- returned to CASCADE and the column is left nullable, which is reported.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_con   text;
  v_nulls integer;
BEGIN
  SELECT c.conname INTO v_con
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.reported_issues'::regclass
    AND c.contype = 'f'
    AND a.attname = 'reporter_id'
  LIMIT 1;

  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reported_issues DROP CONSTRAINT %I', v_con);
  END IF;

  ALTER TABLE public.reported_issues
    ADD CONSTRAINT reported_issues_reporter_id_fkey
    FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;

  SELECT count(*) INTO v_nulls
  FROM public.reported_issues WHERE reporter_id IS NULL;

  IF v_nulls = 0 THEN
    ALTER TABLE public.reported_issues ALTER COLUMN reporter_id SET NOT NULL;
  ELSE
    RAISE WARNING
      'reporter_id left nullable: % ticket(s) belong to a deleted user and would be destroyed by restoring NOT NULL.',
      v_nulls;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Drop the thread and its helpers
--
-- SECTION 6 IS ONLY SAFE WHILE NOTHING ELSE DEPENDS ON THESE HELPERS.
-- Phase 6 (Task 32) creates two storage.objects policies that call
-- can_access_support_ticket() and is_uuid(). A policy is a tracked pg_depend
-- dependency, so once Phase 6 is applied these DROP FUNCTION statements raise
-- 2BP01 and abort this script AFTER section 1 restored admin_notes and section 3
-- restored the leaking SELECT policy. Task 32 therefore inserts a section 5b
-- into this file that drops those policies and the bucket first. If you are
-- reading this file and section 5b is missing while the bucket exists, add it
-- before running anything.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.support_messages;

DROP FUNCTION IF EXISTS public.can_access_support_ticket(uuid);
DROP FUNCTION IF EXISTS public.is_support_ticket_reporter(uuid);
DROP FUNCTION IF EXISTS public.is_uuid(text);

-- The backup table is deliberately left in place. Drop it by hand, only after
-- confirming the rollback restored what you expected:
--   DROP TABLE salci_backups.reported_issues_pre_messages_20260831;
