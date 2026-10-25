-- Expect FAIL before section 2, PASS after.
WITH fns AS (
  SELECT p.oid, p.proname, p.proacl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('is_uuid', 'is_support_ticket_reporter', 'can_access_support_ticket')
),
leaky AS (
  SELECT proname FROM fns WHERE proacl IS NULL
  UNION ALL
  SELECT f.proname
  FROM fns f, unnest(f.proacl) AS a(entry)
  WHERE a.entry::text LIKE '=%'          -- empty grantee == PUBLIC
     OR a.entry::text LIKE 'anon=%'
),
granted AS (
  SELECT DISTINCT f.proname
  FROM fns f, unnest(coalesce(f.proacl, '{}'::aclitem[])) AS a(entry)
  WHERE a.entry::text LIKE 'authenticated=%'
)
SELECT
  (SELECT count(*) FROM fns)                                        AS fn_count,
  (SELECT count(*) FROM leaky)                                      AS leaky_acl_entries,
  (SELECT count(*) FROM granted)                                    AS authenticated_grants,
  (SELECT coalesce(string_agg(proname || ' -> ' || coalesce(array_to_string(proacl, ' | '), 'NULL(default=PUBLIC)'), E'\n'), '')
     FROM fns)                                                      AS acl_dump,
  CASE
    WHEN (SELECT count(*) FROM fns) = 3
     AND (SELECT count(*) FROM leaky) = 0
     AND (SELECT count(*) FROM granted) = 3
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                               AS verdict;
