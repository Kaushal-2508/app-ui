-- ============================================================================
-- Close the unauthenticated write path into system_audit_logs.
--
-- FINDING
--
-- public.log_audit_event(...) is SECURITY DEFINER and INSERTs into
-- public.system_audit_logs, whose only INSERT policy is super-admin-only, so
-- the RPC is the sanctioned write path. Measured on prod 2026-08-31:
--   has_function_privilege('anon', oid, 'EXECUTE') = true
-- Its ACL carried BOTH a leading '=X/postgres' (the PUBLIC grant that Supabase's
-- ALTER DEFAULT PRIVILEGES adds to every new public function) AND an explicit
-- 'anon=X/postgres'. Either alone is enough to keep anon executing, so BOTH
-- revokes are required; neither implies the other.
--
-- Effect of the hole: a caller holding nothing but the publishable anon key can
-- write audit rows. auth.uid() is NULL for anon, so actor_id lands NULL, i.e.
-- unattributed forged audit entries.
--
-- WHY THIS IS SAFE TO REVOKE
--
--  * Zero RLS policies reference it. Measured by matching the function name
--    against pg_policies.qual + with_check across schema public: 0 hits.
--    (Contrast public.has_role, which 175 policies reference and which
--    therefore must NOT be revoked from anon: a SECURITY DEFINER helper called
--    inside a policy is evaluated as the querying role.)
--  * Its only caller is authenticated. src/lib/activityLog.ts:29 wraps it as
--    logActivityEvent(), used by UpdateClassSectionSheet, UpdateRollNumberSheet,
--    SegmentManagerSheet, useManageSchoolSubject and useOptionalBatches, all
--    behind ProtectedRoute. `authenticated` keeps EXECUTE below.
--
-- Revoking by name across every overload, so a future added overload is not
-- silently missed.
-- ============================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'log_audit_event'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon',   r.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    RAISE NOTICE 'revoked PUBLIC + anon, kept authenticated: %', r.sig;
  END LOOP;
END $$;

-- Verify with the decisive test, which expands PUBLIC membership. A
-- `WHERE grantee='anon'` filter over information_schema.routine_privileges
-- would MISS a PUBLIC-only grant and report success falsely.
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       array_to_string(p.proacl, ' | ')                          AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'log_audit_event';
