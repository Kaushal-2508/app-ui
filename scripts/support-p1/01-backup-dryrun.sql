BEGIN;

CREATE SCHEMA IF NOT EXISTS salci_backups;

REVOKE ALL ON SCHEMA salci_backups FROM anon;
REVOKE ALL ON SCHEMA salci_backups FROM authenticated;

CREATE TABLE IF NOT EXISTS salci_backups.reported_issues_pre_messages_20260831 AS
SELECT * FROM public.reported_issues;

ALTER TABLE salci_backups.reported_issues_pre_messages_20260831
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE salci_backups.reported_issues_pre_messages_20260831 FROM anon;
REVOKE ALL ON TABLE salci_backups.reported_issues_pre_messages_20260831 FROM authenticated;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NULL
         AS rolled_back_clean;
