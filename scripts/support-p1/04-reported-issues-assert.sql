-- Expect FAIL before section 4, PASS after.
WITH cols AS (
  SELECT column_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'reported_issues'
),
fk AS (
  SELECT c.conname, c.confdeltype
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.reported_issues'::regclass
    AND c.contype = 'f'
    AND a.attname = 'reporter_id'
)
SELECT
  (SELECT count(*) FROM cols
    WHERE column_name IN ('category','priority','last_message_at',
                          'reporter_last_read_at','salci_last_read_at',
                          'first_response_at','resolved_at'))            AS new_cols,
  (SELECT is_nullable FROM cols WHERE column_name = 'reporter_id')       AS reporter_id_nullable,
  (SELECT count(*) FROM fk WHERE confdeltype = 'n')                      AS fk_set_null,
  -- confdeltype is "char"; `name || text || "char"` has no operator and the
  -- Management API returns a bare 400 for it. Cast is cosmetic: fk_dump is
  -- diagnostic output and takes no part in the verdict below.
  (SELECT string_agg(conname || ':' || confdeltype::text, ',') FROM fk)  AS fk_dump,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.reported_issues'::regclass
      AND conname = 'reported_issues_status_check'
      AND contype = 'c' AND convalidated)                                AS status_check_validated,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'reported_issues'
      AND indexname = 'idx_reported_issues_last_message')                AS last_message_index,
  (SELECT count(*) FROM public.reported_issues
    WHERE status NOT IN ('open','in_progress','resolved','closed'))      AS rogue_statuses,
  CASE
    WHEN (SELECT count(*) FROM cols
            WHERE column_name IN ('category','priority','last_message_at',
                                  'reporter_last_read_at','salci_last_read_at',
                                  'first_response_at','resolved_at')) = 7
     AND (SELECT is_nullable FROM cols WHERE column_name = 'reporter_id') = 'YES'
     AND (SELECT count(*) FROM fk WHERE confdeltype = 'n') = 1
     AND (SELECT count(*) FROM pg_constraint
            WHERE conrelid = 'public.reported_issues'::regclass
              AND conname = 'reported_issues_status_check'
              AND contype = 'c' AND convalidated) = 1
     AND (SELECT count(*) FROM pg_indexes
            WHERE schemaname='public' AND tablename='reported_issues'
              AND indexname='idx_reported_issues_last_message') = 1
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                                    AS verdict;
