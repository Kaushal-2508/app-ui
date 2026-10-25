-- The authoritative privilege check for the Phase 2 support RPCs.
-- All ten rows must read PASS, and there must be exactly ten of them.
--
-- has_function_privilege(role, oid, 'EXECUTE') is the only correct instrument
-- here. It expands PUBLIC membership and role inheritance, so it answers the
-- question actually being asked: "can anon call this?"
--
--   * information_schema.routine_privileges lists EXPLICIT grants only. A
--     function whose EXECUTE reaches anon purely through the implicit PUBLIC
--     grant does not appear there at all, so filtering it on grantee = 'anon'
--     reads clean on exactly the functions that are leaking.
--   * proacl read by eye is worse: proacl IS NULL means "default privileges",
--     and the default for a function is EXECUTE TO PUBLIC. The most dangerous
--     case is the one with nothing to look at.
--
-- proacl is touched below only through aclexplode(), and only to name PUBLIC
-- (grantee OID 0) in the detail column, so a FAIL says which grant it was.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       (p.proacl IS NULL
        OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))  AS public_execute,
       coalesce(array_to_string(p.proacl, ' | '),
                '(NULL: default privileges, PUBLIC has EXECUTE)')          AS acl,
       CASE
         -- anon must never hold EXECUTE, however it arrives.
         WHEN has_function_privilege('anon', p.oid, 'EXECUTE')             THEN 'FAIL'
         WHEN p.proacl IS NULL                                            THEN 'FAIL'
         WHEN EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN 'FAIL'
         -- _support_apply_status is internal; every other one must stay callable.
         WHEN p.proname = '_support_apply_status'
              AND has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'FAIL'
         WHEN p.proname <> '_support_apply_status'
              AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'FAIL'
         ELSE 'PASS'
       END AS verdict
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    '_support_apply_status','list_my_support_tickets','get_support_thread',
    'post_support_message','set_support_ticket_status','resolve_support_task',
    'mark_support_ticket_read','support_inbox_counts','get_support_ticket_transcript',
    'create_support_task')
ORDER BY p.proname;
