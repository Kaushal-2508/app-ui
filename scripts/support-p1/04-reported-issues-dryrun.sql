BEGIN;

ALTER TABLE public.reported_issues
  ADD COLUMN IF NOT EXISTS category              text,
  ADD COLUMN IF NOT EXISTS priority              smallint,
  ADD COLUMN IF NOT EXISTS last_message_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reporter_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS salci_last_read_at    timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at     timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at           timestamptz;

ALTER TABLE public.reported_issues
  DROP CONSTRAINT IF EXISTS reported_issues_status_check;
ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')) NOT VALID;
ALTER TABLE public.reported_issues
  VALIDATE CONSTRAINT reported_issues_status_check;

CREATE INDEX IF NOT EXISTS idx_reported_issues_last_message
  ON public.reported_issues(last_message_at DESC);

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
  END IF;
END $$;

ALTER TABLE public.reported_issues ALTER COLUMN reporter_id DROP NOT NULL;

ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reported_issues_reporter_created
  ON public.reported_issues(reporter_id, created_at DESC);

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'reported_issues'
           AND column_name = 'resolved_at') = 0 AS rolled_back_clean;
