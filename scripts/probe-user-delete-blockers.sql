-- =============================================================
-- probe-user-delete-blockers.sql: what COULD stop a user delete?
-- -------------------------------------------------------------
-- READ-ONLY catalog scan, instant. Companion to probe-user-deletes.sql,
-- which runs the real (rolled-back) delete but only finds blockers the
-- current data happens to hit. This one walks the cascade graph from
-- auth.users and lists every structure that can abort a delete even when
-- no row exercises it yet. Run both after any migration that adds a table,
-- an FK or a BEFORE UPDATE/DELETE trigger.
--
--   kind = fk       FK into a table the delete reaches (CASCADE closure)
--                   that can abort it: RESTRICT, NO ACTION on a table the
--                   cascade does not also delete, or SET NULL on NOT NULL.
--                   Fix per CLAUDE.md §21 (ownership CASCADE, authorship
--                   SET NULL + DROP NOT NULL).
--   kind = trigger  BEFORE UPDATE guard that RAISEs, on a table a SET NULL
--                   cascade UPDATEs, and does not yet call
--                   is_user_delete_cascade_update(). Review it: if its
--                   condition can hold for an UPDATE that only nulls a user
--                   column (e.g. it fires on every UPDATE, or checks
--                   auth.uid(), which is NULL during a delete), add the
--                   helper call before its RAISE (see 20260925120000).
--
-- Known and intended on 2026-09-25: support_settings.owner_id (RESTRICT);
-- trigger rows for guards that only fire on status/content columns
-- (exams, homework_assignments, oly_campaigns, student_exam_attempts,
-- tasks status, universal_subjects), attendance_records (skips a NULL
-- auth.uid()) and cal_events (0 overlapping exam blocks). Anything new is
-- worth a look.
-- =============================================================

WITH RECURSIVE closure(rel) AS (
  SELECT 'auth.users'::regclass::oid
  UNION
  SELECT c.conrelid
  FROM pg_constraint c JOIN closure cl ON c.confrelid = cl.rel
  WHERE c.contype = 'f' AND c.confdeltype = 'c'
),
fk AS (
  SELECT c.conrelid, c.confrelid, c.conname, c.confdeltype,
         string_agg(a.attname::text, ',') AS cols,
         bool_or(a.attnotnull) AS any_not_null
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f' AND c.confrelid IN (SELECT rel FROM closure)
  GROUP BY c.conrelid, c.confrelid, c.conname, c.confdeltype
)
SELECT 'fk' AS kind,
       fk.conrelid::regclass::text || '.' || fk.cols AS what,
       fk.conname || ' -> ' || fk.confrelid::regclass::text || ' ON DELETE ' ||
         CASE fk.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
              WHEN 'n' THEN 'SET NULL on NOT NULL' ELSE 'SET DEFAULT on NOT NULL' END AS detail
FROM fk
WHERE fk.confdeltype = 'r'
   OR (fk.confdeltype = 'a' AND fk.conrelid NOT IN (SELECT rel FROM closure))
   OR (fk.confdeltype IN ('n', 'd') AND fk.any_not_null)
UNION ALL
SELECT 'trigger',
       t.tgrelid::regclass::text || ' :: ' || t.tgname,
       p.proname || CASE WHEN pg_get_triggerdef(t.oid) ~ ' WHEN ' THEN ' (has WHEN clause)' ELSE '' END
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND (t.tgtype & 2) > 0 AND (t.tgtype & 1) > 0 AND (t.tgtype & 16) > 0   -- BEFORE, ROW, UPDATE
  AND p.prosrc ~* 'RAISE\s+EXCEPTION'
  AND p.prosrc NOT LIKE '%is_user_delete_cascade_update%'
  AND t.tgrelid IN (SELECT conrelid FROM fk WHERE confdeltype IN ('n', 'd'))
ORDER BY 1, 2;
