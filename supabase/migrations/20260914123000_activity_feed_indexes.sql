-- =============================================================
-- Indexes for the federated Activity Logs feed
-- -------------------------------------------------------------
-- The rebuilt /school/activity and /admin/activity page (naman-erp round 4)
-- reads FOUR audit sources per page, each ordered by its own timestamp
-- descending with a LIMIT, plus one HEAD count per source for the trailing
-- 7-day KPI strip. Two of the four had no index on the column they are ordered
-- by, so every page turn and every KPI refresh was a full scan plus a top-N
-- sort:
--
--   system_audit_logs           idx_audit_logs_created (created_at DESC)   OK
--   class_assignment_deletions  cad_institution_deleted_idx
--                               (institution_id, deleted_at DESC)          OK
--   task_audit_logs             (created_at)  MISSING  <- added here
--   exam_publication_logs       (created_at)  MISSING  <- added here
--
-- The `id` tiebreaker is part of the key on purpose. The feed pages with a
-- keyset cursor, and the client sorts ties by `source:id`; without a
-- deterministic secondary sort the fixed-size window shifts between pages and
-- rows are silently skipped. Ordering by (created_at DESC, id DESC) makes the
-- per-source window stable and lets the index satisfy the sort outright.
-- The frontend half of that fix is in src/hooks/useActivityLogs.ts.
--
-- Small tables today (task_audit_logs 4,562 rows; exam_publication_logs 1,622)
-- so this builds instantly, but both grow forever and are now on an admin
-- page's hot path. Plain CREATE INDEX, not CONCURRENTLY: the Management API
-- wraps statements in a transaction, and at this size the lock is negligible.
--
-- Prod: applied 2026-09-14 via scripts/run-sql.ps1 (the migration ledger is
-- not maintained, verify with the block at the end).
-- =============================================================

CREATE INDEX IF NOT EXISTS task_audit_logs_created_idx
  ON public.task_audit_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS exam_publication_logs_created_idx
  ON public.exam_publication_logs (created_at DESC, id DESC);

-- Verify after applying:
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname IN ('task_audit_logs_created_idx', 'exam_publication_logs_created_idx');
--   -- 2 rows.
--   EXPLAIN SELECT id FROM public.task_audit_logs ORDER BY created_at DESC, id DESC LIMIT 30;
--   -- Index Scan using task_audit_logs_created_idx, no Sort node.
