-- =============================================================
-- Deleted-user archive (dua), fix: run the completeness check at COMMIT.
-- Found 2026-10-09 when the triggers went live: Postgres fires the cascade from
-- profiles to its children (attempts, answers, attendance...) AFTER the
-- AFTER STATEMENT trigger on auth.users, because RI actions queue their own
-- triggers to the outer query level. So the old statement-level check saw
-- "0 deleted" on every child table and marked every archive partial.
-- The rolled-back proofs called dua.stmt_end() as a separate statement after
-- the DELETE, which is why they never saw it.
--
-- Now: the baseline is taken once per TRANSACTION (first delete), archives
-- accumulate across statements, and a DEFERRED constraint trigger runs the
-- comparison once at commit, after every cascade has finished. A transaction
-- that also deletes unrelated rows shows those as mismatches (partial), which
-- is honest: completeness cannot be proven then.
-- =============================================================

CREATE OR REPLACE FUNCTION dua.stmt_begin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(current_setting('dua.baseline', true), '') <> '' THEN
    RETURN;   -- an earlier delete in this transaction already took the baseline
  END IF;
  PERFORM set_config('dua.baseline',
    (SELECT jsonb_build_object(
              'del', coalesce(jsonb_object_agg(s.relid::text, s.n_tup_del), '{}'::jsonb),
              'upd', coalesce(jsonb_object_agg(s.relid::text, s.n_tup_upd), '{}'::jsonb))::text
       FROM pg_catalog.pg_stat_xact_user_tables s), true);
  PERFORM set_config('dua.stmt_archives', '', true);
  PERFORM set_config('dua.stmt_token', gen_random_uuid()::text, true);
  PERFORM set_config('dua.checked', '', true);
END $$;

-- Deferred: fires at commit (or SET CONSTRAINTS ... IMMEDIATE), once per row; runs
-- the check once per transaction.
CREATE OR REPLACE FUNCTION dua.trg_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(current_setting('dua.checked', true), '') = coalesce(current_setting('dua.stmt_archives', true), '') THEN
    RETURN NULL;   -- already checked with this exact set of archives
  END IF;
  PERFORM dua.stmt_end();
  PERFORM set_config('dua.checked', coalesce(current_setting('dua.stmt_archives', true), ''), true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION dua.trg_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION dua.stmt_begin() FROM PUBLIC, anon, authenticated;

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS dua_stmt_after_delete ON auth.users;
DROP TRIGGER IF EXISTS dua_check_after_delete ON auth.users;
CREATE CONSTRAINT TRIGGER dua_check_after_delete AFTER DELETE ON auth.users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION dua.trg_check();
