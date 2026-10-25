-- Expect FAIL before section 1, PASS after.
SELECT
  (SELECT count(*) FROM public.reported_issues)                     AS live_rows,
  to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NOT NULL
                                                                    AS backup_exists,
  CASE
    WHEN to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NULL
      THEN NULL
    ELSE (xpath(
            '/row/c/text()',
            query_to_xml(
              'SELECT count(*) AS c FROM salci_backups.reported_issues_pre_messages_20260831',
              false, true, '')
          ))[1]::text::bigint
  END                                                               AS backup_rows,
  CASE
    WHEN to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NOT NULL
     AND (SELECT count(*) FROM public.reported_issues) = 41
     AND (xpath(
            '/row/c/text()',
            query_to_xml(
              'SELECT count(*) AS c FROM salci_backups.reported_issues_pre_messages_20260831',
              false, true, '')
          ))[1]::text::bigint = 41
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                               AS verdict;
