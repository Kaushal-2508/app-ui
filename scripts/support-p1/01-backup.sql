-- ---------------------------------------------------------------------------
-- 1. Full-row backup, taken BEFORE any change
--
-- A whole-table copy rather than just the admin_notes column, so the entire
-- phase is reversible from one place. It is also the only trigger-immune copy
-- of updated_at: update_reported_issues_updated_at bumps updated_at on every
-- UPDATE, so the backfill in section 5 must read resolution timestamps from
-- here, never from the live table it is in the middle of rewriting.
--
-- RLS is enabled with no policies, so the copy is unreachable from PostgREST
-- even if salci_backups were ever exposed. The Management API runs as postgres
-- (BYPASSRLS), so the rollback script can still read it.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS salci_backups;

REVOKE ALL ON SCHEMA salci_backups FROM anon;
REVOKE ALL ON SCHEMA salci_backups FROM authenticated;

CREATE TABLE IF NOT EXISTS salci_backups.reported_issues_pre_messages_20260831 AS
SELECT * FROM public.reported_issues;

ALTER TABLE salci_backups.reported_issues_pre_messages_20260831
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE salci_backups.reported_issues_pre_messages_20260831 FROM anon;
REVOKE ALL ON TABLE salci_backups.reported_issues_pre_messages_20260831 FROM authenticated;

COMMENT ON TABLE salci_backups.reported_issues_pre_messages_20260831 IS
  'Full copy of public.reported_issues taken 2026-08-31 immediately before the support thread migration, including the admin_notes column that migration drops. Restore path: scripts/rollback-salci-support-messages.sql.';
