BEGIN;

-- Guard behaviour: the backup must exist and phase 2 must not be applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_support_apply_status'
  ) THEN
    RAISE EXCEPTION 'DRY RUN: phase 2 detected, rollback would refuse (correct).';
  END IF;
  IF to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NULL THEN
    RAISE EXCEPTION 'DRY RUN FAILED: backup missing, rollback would be impossible.';
  END IF;
END $$;

ALTER TABLE public.reported_issues ADD COLUMN IF NOT EXISTS admin_notes text;

UPDATE public.reported_issues r
SET admin_notes = b.admin_notes
FROM salci_backups.reported_issues_pre_messages_20260831 b
WHERE b.id = r.id AND b.admin_notes IS NOT NULL;

DROP POLICY IF EXISTS "Super admins view all reports" ON public.reported_issues;
DROP POLICY IF EXISTS "Users can view own reports" ON public.reported_issues;
CREATE POLICY "Users can view own reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP INDEX IF EXISTS public.idx_reported_issues_last_message;
ALTER TABLE public.reported_issues DROP CONSTRAINT IF EXISTS reported_issues_status_check;
ALTER TABLE public.reported_issues
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS last_message_at,
  DROP COLUMN IF EXISTS reporter_last_read_at,
  DROP COLUMN IF EXISTS salci_last_read_at,
  DROP COLUMN IF EXISTS first_response_at,
  DROP COLUMN IF EXISTS resolved_at;

DROP TABLE IF EXISTS public.support_messages;
DROP FUNCTION IF EXISTS public.can_access_support_ticket(uuid);
DROP FUNCTION IF EXISTS public.is_support_ticket_reporter(uuid);
DROP FUNCTION IF EXISTS public.is_uuid(text);

DO $$
DECLARE
  v_restored integer;
BEGIN
  SELECT count(*) INTO v_restored
  FROM public.reported_issues
  WHERE nullif(btrim(coalesce(admin_notes, '')), '') IS NOT NULL;

  IF v_restored <> 14 THEN
    RAISE EXCEPTION 'DRY RUN FAILED: restored % admin_notes rows, expected 14', v_restored;
  END IF;
  RAISE NOTICE 'rollback dry run restored 14 admin_notes rows as expected';
END $$;

ROLLBACK;

SELECT 'rollback dry run completed with no error'      AS result,
       to_regclass('public.support_messages') IS NOT NULL AS thread_still_live,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='reported_issues'
           AND column_name='admin_notes') = 0            AS leak_still_closed;
