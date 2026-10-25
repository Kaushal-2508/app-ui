-- Expect FAIL before section 3, PASS after.
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'support_messages')      AS tbl,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'support_messages'
       AND column_name IN ('id','ticket_id','author_id','author_name','author_side',
                           'kind','body','is_internal','attachments','client_token',
                           'created_at'))                                    AS cols,
  (SELECT coalesce(bool_or(c.relrowsecurity), false)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'support_messages')           AS rls_enabled,
  (SELECT count(*) FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'support_messages'
       AND indexname IN ('idx_support_messages_ticket_created',
                         'idx_support_messages_author',
                         'uq_support_messages_client_token'))                AS idx,
  (SELECT count(*) FROM pg_index i
     JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relname = 'uq_support_messages_client_token'
      AND i.indisunique AND i.indpred IS NOT NULL)                           AS partial_unique_ok,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'support_messages')         AS policies_total,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'support_messages'
       AND cmd <> 'SELECT')                                                  AS write_policies,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'support_messages'
       AND grantee = 'anon')                                                 AS anon_grants,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'support_messages'
       AND grantee = 'authenticated' AND privilege_type <> 'SELECT')         AS authenticated_write_grants,
  (SELECT count(*) FROM pg_constraint
     WHERE conrelid = to_regclass('public.support_messages')
       AND contype = 'f' AND confdeltype = 'n')                              AS fks_set_null,
  CASE
    WHEN (SELECT count(*) FROM information_schema.tables
            WHERE table_schema='public' AND table_name='support_messages') = 1
     AND (SELECT count(*) FROM information_schema.columns
            WHERE table_schema='public' AND table_name='support_messages'
              AND column_name IN ('id','ticket_id','author_id','author_name','author_side',
                                  'kind','body','is_internal','attachments','client_token',
                                  'created_at')) = 11
     AND (SELECT coalesce(bool_or(c.relrowsecurity), false)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname='public' AND c.relname='support_messages')
     AND (SELECT count(*) FROM pg_indexes
            WHERE schemaname='public' AND tablename='support_messages'
              AND indexname IN ('idx_support_messages_ticket_created',
                                'idx_support_messages_author',
                                'uq_support_messages_client_token')) = 3
     AND (SELECT count(*) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
           WHERE ic.relname='uq_support_messages_client_token'
             AND i.indisunique AND i.indpred IS NOT NULL) = 1
     AND (SELECT count(*) FROM pg_policies
            WHERE schemaname='public' AND tablename='support_messages') = 1
     AND (SELECT count(*) FROM pg_policies
            WHERE schemaname='public' AND tablename='support_messages'
              AND cmd <> 'SELECT') = 0
     AND (SELECT count(*) FROM information_schema.role_table_grants
            WHERE table_schema='public' AND table_name='support_messages'
              AND grantee='anon') = 0
     AND (SELECT count(*) FROM information_schema.role_table_grants
            WHERE table_schema='public' AND table_name='support_messages'
              AND grantee='authenticated' AND privilege_type <> 'SELECT') = 0
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                                        AS verdict;
