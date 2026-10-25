-- =============================================================
-- probe-user-deletes.sql: can every account actually be deleted?
-- -------------------------------------------------------------
-- DRY RUN, NOTHING IS WRITTEN. Each account's delete runs in its own
-- subtransaction that is always aborted (success raises a sentinel), so the
-- whole cascade is undone and its row locks released before the next user.
-- Outcomes go to a temp table (ON COMMIT DROP) and come back grouped by
-- failure, so one broken FK or guard trigger shows up as one row.
--
-- Why this exists: user delete broke three times (2026-04-22, 2026-09-11,
-- 2026-09-25), each time from a different cause several hops down the
-- cascade that no FK sweep could see (see 20260925120000). GoTrue only ever
-- says "Database error deleting user". This runs the real delete, so it
-- catches FKs, guard triggers and NOT NULL clashes alike, with the real
-- Postgres error.
--
-- Run it after any migration that adds a table, an FK to a user-owned
-- table, or a BEFORE UPDATE/DELETE trigger:
--   powershell -File scripts/run-sql.ps1 -SqlFile scripts/probe-user-deletes.sql -OutFile "$env:TEMP\probe.json"
-- 500 accounts take ~40s (the Management API times out a little past 60s),
-- so step OFFSET by 500 until a batch returns nothing: 3,403 accounts on
-- 2026-09-25 = offsets 0..3000.
--
-- Expected blocker: the support_settings owner (team@salci.in), RESTRICT on
-- purpose; hand ownership over first. Anything else is a bug.
-- Side effects: none. The only outbound call a delete can queue is pg_net on
-- notifications, and pg_net requests are rows, so they roll back too.
-- =============================================================

CREATE TEMP TABLE _probe (user_id uuid, full_name text, roles text, sqlstate text, msg text, ctx text) ON COMMIT DROP;

DO $$
DECLARE
  r record; st text; msg text; ctx text;
BEGIN
  FOR r IN
    SELECT u.id, p.full_name,
           (SELECT string_agg(DISTINCT x.role::text, ',') FROM public.user_roles x WHERE x.user_id = u.id) AS roles
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    ORDER BY u.id
    OFFSET 0 LIMIT 500
  LOOP
    BEGIN
      DELETE FROM auth.users WHERE id = r.id;
      RAISE EXCEPTION 'DRYRUN_OK';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, msg = MESSAGE_TEXT, ctx = PG_EXCEPTION_CONTEXT;
      INSERT INTO _probe VALUES (r.id, r.full_name, coalesce(r.roles, '(no role)'), st, msg,
        CASE WHEN msg = 'DRYRUN_OK' THEN NULL ELSE left(ctx, 400) END);
    END;
  END LOOP;
END $$;

SELECT CASE WHEN msg = 'DRYRUN_OK' THEN 'OK' ELSE 'BLOCKED' END AS outcome,
       CASE WHEN msg = 'DRYRUN_OK' THEN NULL ELSE sqlstate || ' ' || msg END AS error,
       min(ctx) AS where_it_failed,
       count(*) AS users,
       string_agg(DISTINCT roles, ' / ') AS roles,
       (array_agg(coalesce(full_name, user_id::text) ORDER BY full_name))[1:5] AS sample
FROM _probe
GROUP BY 1, 2
ORDER BY 1, users DESC;
