-- Contracts introduced by 20260909120000_support_system_institution_resilience.sql
-- (the 2026-09-02 "SALCI Support institution deleted" incident).
--
-- Run:  powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/verify-support-resilience.sql -OutFile out.json
-- Read the result file with encoding utf-8-sig (run-sql.ps1 writes a UTF-8 BOM).
--
-- Every row must read PASS. Verify against production, never against the
-- migration ledger (supabase_migrations.schema_migrations is not maintained).

SELECT 'SALCI Support institution present and flagged is_system' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM public.institutions WHERE code = 'SALCI-SUPPORT' AND is_system
       ) THEN 'PASS' ELSE 'FAIL' END AS result

UNION ALL
SELECT 'get_support_institution_id() resolves',
       CASE WHEN public.get_support_institution_id() IS NOT NULL THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'both guard_system_institution triggers installed',
       CASE WHEN (
         SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'public.institutions'::regclass
           AND tgname IN ('guard_system_institution_delete', 'guard_system_institution_update')
       ) = 2 THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'support_health_events exists with RLS enabled',
       CASE WHEN (
         SELECT relrowsecurity FROM pg_class WHERE oid = 'public.support_health_events'::regclass
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- Writes happen only through SECURITY DEFINER RPCs.
SELECT 'support_health_events has no write policy',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'support_health_events'
           AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'authenticated cannot INSERT into support_health_events',
       CASE WHEN NOT has_table_privilege('authenticated', 'public.support_health_events', 'INSERT')
       THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'anon has no rights on support_health_events',
       CASE WHEN NOT has_table_privilege('anon', 'public.support_health_events', 'SELECT')
             AND NOT has_table_privilege('anon', 'public.support_health_events', 'INSERT')
       THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- aclexplode grantee = 0 is PUBLIC. information_schema does not expand it.
SELECT 'no PUBLIC or anon EXECUTE on the seven resilience functions',
       CASE WHEN (
         SELECT count(*) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('create_support_task', 'log_support_intake_failure', 'support_health',
                             'support_backfill_mirror_tasks', 'ensure_support_institution',
                             '_support_record_health', 'guard_system_institution')
           AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                OR p.proacl IS NULL
                OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       ) = 0 THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'internal helpers are not callable by authenticated',
       CASE WHEN NOT has_function_privilege('authenticated', 'public.ensure_support_institution()'::regprocedure, 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public._support_record_health(text, text, uuid, uuid, text)'::regprocedure, 'EXECUTE')
       THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'callable RPCs keep their authenticated EXECUTE grant',
       CASE WHEN has_function_privilege('authenticated', 'public.create_support_task(text, text, text, integer, text)'::regprocedure, 'EXECUTE')
             AND has_function_privilege('authenticated', 'public.log_support_intake_failure(text, text, text)'::regprocedure, 'EXECUTE')
             AND has_function_privilege('authenticated', 'public.support_health()'::regprocedure, 'EXECUTE')
             AND has_function_privilege('authenticated', 'public.support_backfill_mirror_tasks()'::regprocedure, 'EXECUTE')
       THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'weekly health-event purge is scheduled',
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'support-health-events-purge')
       THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- Recovery contract: after support_backfill_mirror_tasks() every live ticket
-- has its /tasks mirror again.
SELECT 'no open or in-progress ticket without a mirror task',
       CASE WHEN (
         SELECT count(*) FROM public.reported_issues
         WHERE task_id IS NULL AND status IN ('open', 'in_progress')
       ) = 0 THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- The original Phase 2 contract must still hold: this change only adds.
SELECT 'the ten Phase 2 support functions are all present',
       CASE WHEN (
         SELECT count(*) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             '_support_apply_status', 'list_my_support_tickets', 'get_support_thread',
             'post_support_message', 'set_support_ticket_status', 'resolve_support_task',
             'mark_support_ticket_read', 'support_inbox_counts', 'get_support_ticket_transcript',
             'create_support_task')
       ) = 10 THEN 'PASS' ELSE 'FAIL' END;
