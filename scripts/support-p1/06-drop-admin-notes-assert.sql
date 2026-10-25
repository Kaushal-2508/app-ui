-- Expect FAIL before section 6, PASS after.
WITH pol AS (
  SELECT policyname, cmd, qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'reported_issues' AND cmd = 'SELECT'
),
rpc AS (
  SELECT p.proname, p.prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('set_support_ticket_status', 'resolve_support_task')
)
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'reported_issues'
       AND column_name = 'admin_notes')                       AS admin_notes_col,
  (SELECT count(*) FROM pol)                                  AS select_policies,
  (SELECT count(*) FROM pol WHERE policyname = 'Super admins view all reports')
                                                              AS narrowed_policy,
  (SELECT count(*) FROM pol WHERE qual ILIKE '%reporter_id%') AS reporter_readable,
  (SELECT count(*) FROM rpc)                                  AS rpcs_present,
  (SELECT count(*) FROM rpc WHERE prosrc ILIKE '%admin_notes%')
                                                              AS rpcs_still_writing_admin_notes,
  (SELECT count(*) FROM rpc WHERE prosrc ILIKE '%support_messages%')
                                                              AS rpcs_filing_internal_messages,
  (SELECT count(*) FROM public.support_messages WHERE is_internal)
                                                              AS internal_messages_preserved,
  CASE
    WHEN (SELECT count(*) FROM information_schema.columns
            WHERE table_schema='public' AND table_name='reported_issues'
              AND column_name='admin_notes') = 0
     AND (SELECT count(*) FROM pol) = 1
     AND (SELECT count(*) FROM pol WHERE policyname='Super admins view all reports') = 1
     AND (SELECT count(*) FROM pol WHERE qual ILIKE '%reporter_id%') = 0
     AND (SELECT count(*) FROM rpc) = 2
     AND (SELECT count(*) FROM rpc WHERE prosrc ILIKE '%admin_notes%') = 0
     AND (SELECT count(*) FROM rpc WHERE prosrc ILIKE '%support_messages%') = 2
     AND (SELECT count(*) FROM public.support_messages WHERE is_internal) = 14
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                         AS verdict;
