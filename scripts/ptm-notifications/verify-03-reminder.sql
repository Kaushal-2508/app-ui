DO $$
DECLARE v_src text; v_code text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='ptm_send_day_before_reminders';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: ptm_send_day_before_reminders is missing';
  END IF;
  -- Strip line comments before pattern-matching. prosrc stores comments
  -- verbatim, so a comment merely discussing a hazard in prose (e.g. the
  -- words CURRENT_DATE) must not trip a check meant to catch real code.
  v_code := regexp_replace(v_src, '--[^\n]*', '', 'g');
  -- CLAUDE.md 24: the 2026-05-25 regression test. The function MUST read
  -- "tomorrow" in the institution's timezone, never the server's.
  IF v_code NOT ILIKE '%AT TIME ZONE%COALESCE(i.timezone%' THEN
    RAISE EXCEPTION 'FAIL: reminder does not use institution-local time (section 24)';
  END IF;
  IF v_code ~* '\mCURRENT_DATE\M' THEN
    RAISE EXCEPTION 'FAIL: reminder uses CURRENT_DATE (section 24 regression)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='ptm-day-before-reminders') THEN
    RAISE EXCEPTION 'FAIL: cron job ptm-day-before-reminders is not scheduled';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee IN ('anon','authenticated')
                AND routine_name='ptm_send_day_before_reminders') THEN
    RAISE EXCEPTION 'FAIL: anon/authenticated can run the reminder pass';
  END IF;
  RAISE NOTICE 'PASS: reminder function is institution-local and scheduled';
END $$;

-- run-sql.ps1 returns only the result set, and RAISE NOTICE is not part of
-- it, so a passing DO block above would otherwise return [] and look
-- identical to "did nothing". This makes PASS visible through the runner.
SELECT 'PASS: reminder function is institution-local and scheduled' AS result;
