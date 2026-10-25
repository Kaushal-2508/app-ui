DO $$
BEGIN
  IF to_regclass('public.ptm_notifications_sent') IS NULL THEN
    RAISE EXCEPTION 'FAIL: table ptm_notifications_sent is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='ptm_audience') THEN
    RAISE EXCEPTION 'FAIL: function ptm_audience is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='_ptm_fanout') THEN
    RAISE EXCEPTION 'FAIL: function _ptm_fanout is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND tablename='ptm_notifications_sent'
                    AND indexdef ILIKE '%(recipient_id)%') THEN
    RAISE EXCEPTION 'FAIL: recipient_id index is missing (CLAUDE.md 23: every new FK gets an index)';
  END IF;
  -- the claim ledger's own uniqueness must be a real constraint, not just an index
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ptm_notifications_sent_uniq' AND contype = 'u') THEN
    RAISE EXCEPTION 'FAIL: the (ptm_id, recipient_id, notification_type) UNIQUE is missing';
  END IF;
  -- anon must not be able to execute any of the new functions
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee='anon'
                AND routine_name IN ('ptm_audience','_ptm_fanout')) THEN
    RAISE EXCEPTION 'FAIL: anon still holds EXECUTE (CLAUDE.md 26)';
  END IF;
  -- _ptm_fanout must not be executable by authenticated or PUBLIC either
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND routine_name='_ptm_fanout'
                AND grantee IN ('authenticated','PUBLIC')) THEN
    RAISE EXCEPTION 'FAIL: _ptm_fanout still executable by authenticated/PUBLIC';
  END IF;
  -- ptm_audience must not be executable by authenticated or PUBLIC either
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND routine_name='ptm_audience'
                AND grantee IN ('authenticated','PUBLIC')) THEN
    RAISE EXCEPTION 'FAIL: ptm_audience still executable by authenticated/PUBLIC';
  END IF;
  -- both functions must stay SECURITY DEFINER with a pinned search_path
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('ptm_audience','_ptm_fanout')
                AND (NOT p.prosecdef
                     OR coalesce(array_to_string(p.proconfig,','),'') NOT ILIKE '%search_path%')) THEN
    RAISE EXCEPTION 'FAIL: a PTM function is not SECURITY DEFINER with a pinned search_path';
  END IF;
  -- the UPDATE policy must now carry an explicit WITH CHECK
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='ptm_schedules'
                    AND policyname='ptm_update' AND with_check IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: ptm_update has no WITH CHECK (CLAUDE.md 26)';
  END IF;
  RAISE NOTICE 'PASS: foundation objects present and locked down';
END $$;
