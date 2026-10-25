-- Every function that calls a helper the task rollback drops must itself be
-- dropped by that same script, and dropped BEFORE it, or the drop leaves a
-- caller pointing at a function that no longer exists.
--
-- Expect exactly these three, all dropped by sections 1 and 2 of
-- scripts/rollback-salci-support-tasks.sql, ahead of section 3's helper drops:
--   create_support_task, guard_support_task_mutations, resolve_support_task
--
-- Verified against production on 2026-08-31: exactly those three rows.
-- If a NEW name appears here, add it to section 2 of that script before
-- committing. That is precisely the omission that made the original file
-- dangerous: guard_support_task_mutations() called the helper, was never
-- dropped, and a plpgsql body is not a tracked dependency, so the DROP
-- succeeded and every tasks UPDATE/DELETE raised 42883 platform-wide.
SELECT
  p.proname,
  p.prosrc ILIKE '%get_support_institution_id%' AS calls_institution_helper,
  p.prosrc ILIKE '%get_support_owner_id%'       AS calls_owner_helper
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.prosrc ILIKE '%get_support_institution_id%'
       OR p.prosrc ILIKE '%get_support_owner_id%')
ORDER BY p.proname;
