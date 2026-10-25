-- =============================================================
-- Deleted-user archive (dua), part 3: switch capture on, in best_effort mode.
-- Proven first by scripts/dua/test-capture.sql and scripts/dua/run-probe.sh on
-- every account. A capture error never blocks a delete in this mode (Plan 2
-- moves to 'required'). The brief lock that CREATE TRIGGER takes on
-- auth.users is bounded by lock_timeout.
-- =============================================================
SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS dua_stmt_before_delete ON auth.users;
DROP TRIGGER IF EXISTS dua_capture_before_delete ON auth.users;
DROP TRIGGER IF EXISTS dua_stmt_after_delete ON auth.users;
CREATE TRIGGER dua_stmt_before_delete BEFORE DELETE ON auth.users
  FOR EACH STATEMENT EXECUTE FUNCTION dua.trg_stmt_before();
CREATE TRIGGER dua_capture_before_delete BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION dua.trg_capture();
CREATE TRIGGER dua_stmt_after_delete AFTER DELETE ON auth.users
  FOR EACH STATEMENT EXECUTE FUNCTION dua.trg_stmt_after();
