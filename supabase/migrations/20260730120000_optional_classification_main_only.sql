-- =============================================================
-- OPTIONAL CHOICES ARE ALWAYS "MAIN"
-- -------------------------------------------------------------
-- The per-choice main/optional pill is retired (user decision
-- 2026-07-30). Every optional subject a student picks through an
-- Optional Group counts as a MAIN subject, so the classification
-- is pinned to 'main' at the database:
--
--   * existing rows backfilled to 'main' (9 of 12 prod rows were
--     'optional' at write time — snapshot kept in salci_backups),
--   * DEFAULT flipped 'optional' -> 'main' so every future row
--     (group Save RPC + the dormant P1 upsert, neither of which
--     writes the column) lands on 'main',
--   * CHECK narrowed to ('main') so nothing can reintroduce the
--     distinction silently — a stale cached client calling the
--     removed classification write now fails loudly instead.
--
-- The COLUMN IS KEPT (not dropped): get_student_subject_assignment
-- and get_student_optional_group_assignment both read it, so
-- dropping it would mean rewriting two large RPCs for zero gain.
-- The value they return is now a constant 'main' and no client
-- reads it any more — vestigial but harmless.
--
-- Rollback: restore from salci_backups.soe_classification_20260730,
-- widen the CHECK back to ('main','optional'), reset the DEFAULT.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Snapshot current values (idempotent — keeps the FIRST run's
--    pre-change picture if this migration is ever re-applied).
-- -------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS salci_backups;

CREATE TABLE IF NOT EXISTS salci_backups.soe_classification_20260730 AS
SELECT id, student_id, subject_id, classification, now() AS backed_up_at
FROM public.student_optional_enrollments;

-- -------------------------------------------------------------
-- 2. Backfill every row to 'main'.
-- -------------------------------------------------------------
UPDATE public.student_optional_enrollments
SET classification = 'main'
WHERE classification IS DISTINCT FROM 'main';

-- -------------------------------------------------------------
-- 3. Pin the default + constraint.
-- -------------------------------------------------------------
ALTER TABLE public.student_optional_enrollments
  ALTER COLUMN classification SET DEFAULT 'main';

ALTER TABLE public.student_optional_enrollments
  DROP CONSTRAINT IF EXISTS soe_classification_check;

ALTER TABLE public.student_optional_enrollments
  ADD CONSTRAINT soe_classification_check CHECK (classification = 'main');

COMMENT ON COLUMN public.student_optional_enrollments.classification IS
  'Vestigial. Pinned to ''main'' 2026-07-30 — the main/optional distinction was retired and no client reads this. Kept only because two RPCs still select it.';

-- -------------------------------------------------------------
-- 4. Sanity check — fail loudly if anything is not 'main'.
-- -------------------------------------------------------------
DO $$
DECLARE
  stray INTEGER;
BEGIN
  SELECT count(*) INTO stray
  FROM public.student_optional_enrollments
  WHERE classification IS DISTINCT FROM 'main';

  IF stray > 0 THEN
    RAISE EXCEPTION 'classification backfill incomplete: % row(s) still not main', stray;
  END IF;
END;
$$;
