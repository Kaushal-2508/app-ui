-- ---------------------------------------------------------------------------
-- 4. reported_issues gains ticket metadata, and stops destroying history
--
-- category and priority: create_support_task already accepted both and threw
-- them away into free text inside tasks.description. Phase 2 writes them here.
--
-- Unread is computed, never stored:
--   last_message_at > coalesce(reporter_last_read_at, 'epoch')
-- so there is no per-message read table.
--
-- resolved_at exists because updated_at is bumped by
-- update_reported_issues_updated_at on every edit and therefore cannot serve
-- as a resolution timestamp.
--
-- first_response_at is stamped on the first NON-INTERNAL salci message. An
-- internal note is not a response.
-- ---------------------------------------------------------------------------
ALTER TABLE public.reported_issues
  ADD COLUMN IF NOT EXISTS category              text,
  ADD COLUMN IF NOT EXISTS priority              smallint,
  ADD COLUMN IF NOT EXISTS last_message_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reporter_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS salci_last_read_at    timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at     timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at           timestamptz;

COMMENT ON COLUMN public.reported_issues.priority IS
  'Urgency 1..3 as sent by the intake sheet, clamped server side.';
COMMENT ON COLUMN public.reported_issues.last_message_at IS
  'Timestamp of the most recent thread message. Drives unread on both sides.';
COMMENT ON COLUMN public.reported_issues.first_response_at IS
  'First non-internal salci message. An internal note is not a response.';
COMMENT ON COLUMN public.reported_issues.resolved_at IS
  'Set when status enters resolved or closed, cleared on reopen. Rows migrated on 2026-08-31 carry an APPROXIMATE value copied from updated_at, which was the only timestamp available.';

-- The four live statuses are closed (21), resolved (16) and in_progress (4);
-- open is currently 0. NOT VALID then VALIDATE keeps the lock weak, and the
-- VALIDATE is what proves the claim rather than asserting it.
ALTER TABLE public.reported_issues
  DROP CONSTRAINT IF EXISTS reported_issues_status_check;

ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')) NOT VALID;

ALTER TABLE public.reported_issues
  VALIDATE CONSTRAINT reported_issues_status_check;

CREATE INDEX IF NOT EXISTS idx_reported_issues_last_message
  ON public.reported_issues(last_message_at DESC);

-- -------------------------------------------------------------------------
-- reporter_id: ON DELETE CASCADE to auth.users destroys a reporter's entire
-- ticket history the moment a student leaves. That contradicts CLAUDE.md
-- section 21 (authorship references are SET NULL) and contradicts task_id on
-- this very table, which is already deliberately SET NULL.
--
-- Nothing is lost by nulling it: reporter_name, reporter_email, reporter_role
-- and institution_name are all snapshots taken at intake. And
-- is_support_ticket_reporter still fails closed for a NULL reporter, because
-- NULL = auth.uid() is never true.
--
-- The constraint is dropped by its REAL name looked up from pg_constraint,
-- not by a guessed one.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_con text;
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
    RAISE NOTICE 'dropped reporter_id foreign key %', v_con;
  END IF;
END $$;

ALTER TABLE public.reported_issues
  ALTER COLUMN reporter_id DROP NOT NULL;

ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.reported_issues.reporter_id IS
  'auth.users id of the reporter, NULL once that user is deleted. The reporter_* snapshot columns keep the attribution.';

-- FK index requirement: idx_reported_issues_reporter_created already leads on
-- reporter_id (20260814120000), so the re-added FK is covered. Recreated here
-- with IF NOT EXISTS so this section is safe on a fresh database too.
CREATE INDEX IF NOT EXISTS idx_reported_issues_reporter_created
  ON public.reported_issues(reporter_id, created_at DESC);
