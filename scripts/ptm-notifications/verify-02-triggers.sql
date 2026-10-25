-- tg_ptm_notify_booking was deliberately dropped in Task 7 (multi-class
-- PTM): a booking no longer notifies anyone, teachers see bookings via
-- "View Bookings" instead. Only the two ptm_schedules triggers survive.
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(t.name, ', ') INTO v_missing
    FROM (VALUES ('tg_ptm_notify_scheduled', 'ptm_schedules'),
                 ('tg_ptm_notify_changed',   'ptm_schedules')) AS t(name, relname)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_trigger tg
       JOIN pg_class c ON c.oid = tg.tgrelid
      WHERE tg.tgname = t.name
        AND NOT tg.tgisinternal
        AND c.relname = t.relname
        AND tg.tgenabled = 'O'
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: missing or disabled triggers: %', v_missing;
  END IF;

  -- Positive check: a future accidental re-add of the retired booking
  -- trigger must fail this script, not slip back in silently.
  IF EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
              WHERE tg.tgname = 'tg_ptm_notify_booking' AND c.relname = 'ptm_bookings'
                AND NOT tg.tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: tg_ptm_notify_booking exists but was retired in Task 7';
  END IF;

  RAISE NOTICE 'PASS: both surviving PTM triggers installed, tg_ptm_notify_booking stays retired';
END $$;

-- run-sql.ps1 returns only the result set, and RAISE NOTICE is not part of
-- it, so a passing script would otherwise return [] and look identical to
-- "did nothing". This makes PASS visible through the runner too.
SELECT 'PASS: both surviving PTM triggers installed, tg_ptm_notify_booking stays retired' AS result;
