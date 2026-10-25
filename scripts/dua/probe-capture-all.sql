-- DRY RUN, NOTHING IS WRITTEN: for each account in the batch, run the real DELETE
-- (the live triggers capture), force the deferred completeness check, read the
-- archive header inside an aborted subtransaction, and report.
-- Template: run-probe.sh substitutes __OFFSET__ and __LIMIT__.
BEGIN;
CREATE TEMP TABLE dua_probe (user_id uuid, outcome text, is_complete boolean, total_rows integer,
                             mismatches jsonb, ms numeric, error text);
DO $probe$
DECLARE r record; t0 timestamptz; v jsonb; st text; msg text;
BEGIN
  UPDATE dua.settings SET capture_mode = 'required';   -- surface every capture error as a failure
  FOR r IN SELECT u.id FROM auth.users u ORDER BY u.id OFFSET __OFFSET__ LIMIT __LIMIT__ LOOP
    t0 := clock_timestamp(); v := NULL;
    BEGIN
      DELETE FROM auth.users WHERE id = r.id;
      SET CONSTRAINTS auth.dua_check_after_delete IMMEDIATE;
      SELECT jsonb_build_object('kind', u.kind, 'is_complete', u.is_complete, 'total_rows', u.total_rows,
                                'mismatches', u.completeness->'mismatches')
        INTO v FROM dua.users u WHERE u.user_id = r.id ORDER BY u.created_at DESC LIMIT 1;
      RAISE EXCEPTION 'DUA_PROBE_OK';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
      INSERT INTO dua_probe VALUES (r.id,
        CASE WHEN msg <> 'DUA_PROBE_OK' THEN 'error' WHEN v IS NULL THEN 'skipped_olympiad' ELSE v->>'kind' END,
        (v->>'is_complete')::boolean, (v->>'total_rows')::integer, v->'mismatches',
        round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
        CASE WHEN msg = 'DUA_PROBE_OK' THEN NULL ELSE st || ' ' || msg END);
    END;
  END LOOP;
END $probe$;
SELECT outcome, is_complete, count(*) AS accounts, max(ms) AS max_ms, round(avg(ms), 1) AS avg_ms,
       max(total_rows) AS max_rows,
       (array_agg(user_id ORDER BY ms DESC))[1:3] AS slowest,
       (array_agg(DISTINCT coalesce(error, mismatches::text)) FILTER (WHERE error IS NOT NULL OR is_complete = false))[1:5] AS problems
FROM dua_probe GROUP BY outcome, is_complete ORDER BY outcome, is_complete;
ROLLBACK;
