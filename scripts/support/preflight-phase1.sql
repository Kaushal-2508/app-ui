-- Phase 2 preflight. Every row whose gate reads 'phase1' must read PASS before
-- the RPC migration is applied: Phase 2 depends on Phase 1 having landed in
-- PROD, and the migration ledger is not maintained in this repo, so file
-- presence on disk proves nothing.
--
-- The one row gated 'phase2' is NOT a Phase 1 blocker. create_support_task does
-- not seed support_messages yet, so every ticket raised since Phase 1 opens with
-- an empty thread. Two real user tickets arrived that way while Phase 1 was
-- being applied (fbc1807e "Related to syllabus", 908fa9db "Attendance cannot be
-- edited"). Closing that window is Phase 2's job: the migration changes
-- create_support_task and then runs an idempotent catch-up backfill. Expect this
-- row to read FAIL before the migration and PASS after.
WITH checks AS (
  SELECT 'a01 support_messages table exists' AS check_name, 'phase1' AS gate,
         to_regclass('public.support_messages') IS NOT NULL AS ok
  UNION ALL
  SELECT 'a02 support_messages has client_token', 'phase1',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'support_messages'
                   AND column_name = 'client_token')
  UNION ALL
  SELECT 'a03 support_messages has is_internal', 'phase1',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'support_messages'
                   AND column_name = 'is_internal')
  UNION ALL
  -- B-6 depends on this index actually existing: without it a repeated
  -- client_token inserts a second row instead of being refused.
  SELECT 'a04 uq_support_messages_client_token is a partial unique index', 'phase1',
         EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'public' AND tablename = 'support_messages'
                   AND indexname = 'uq_support_messages_client_token'
                   AND indexdef LIKE '%UNIQUE%'
                   AND indexdef LIKE '%WHERE (client_token IS NOT NULL)%')
  UNION ALL
  SELECT 'a05 reported_issues.admin_notes is dropped', 'phase1',
         NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'reported_issues'
                       AND column_name = 'admin_notes')
  UNION ALL
  SELECT 'a06 reported_issues has the seven new columns', 'phase1',
         (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'reported_issues'
            AND column_name IN ('category','priority','last_message_at',
                                'reporter_last_read_at','salci_last_read_at',
                                'first_response_at','resolved_at')) = 7
  UNION ALL
  SELECT 'a07 reported_issues.reporter_id is nullable', 'phase1',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'reported_issues'
                   AND column_name = 'reporter_id' AND is_nullable = 'YES')
  UNION ALL
  SELECT 'a08 is_uuid(text) exists', 'phase1',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'is_uuid')
  UNION ALL
  SELECT 'a09 is_support_ticket_reporter(uuid) exists', 'phase1',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'is_support_ticket_reporter')
  UNION ALL
  SELECT 'a10 can_access_support_ticket(uuid) exists', 'phase1',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'can_access_support_ticket')
  UNION ALL
  SELECT 'a11 get_support_owner_id() and get_support_institution_id() exist', 'phase1',
         (SELECT count(DISTINCT p.proname) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('get_support_owner_id','get_support_institution_id')) = 2
  UNION ALL
  SELECT 'b01 every ticket has at least one message (closed by phase 2)', 'phase2',
         NOT EXISTS (SELECT 1 FROM public.reported_issues ri
                     WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                                       WHERE m.ticket_id = ri.id))
)
SELECT check_name, gate, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY check_name;
