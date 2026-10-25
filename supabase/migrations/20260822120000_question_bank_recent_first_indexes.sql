-- Question Bank "Recent" ordering — covering indexes.
--
-- The Question Bank list orders by created_at DESC inside one institution and,
-- with the Recent toggle on (the default), also runs a second query narrowed to
-- the viewer's own rows. question_bank holds ~99k rows (84.5k in one
-- institution) and had NO index on created_at or created_by, so both shapes
-- fell back to scanning the whole institution partition and top-N sorting it:
--
--   institution + order by created_at desc limit 50   ->  50.6 ms, 53k rows scanned
--   + created_by = me                                 ->  45.2 ms, 84k rows filtered
--   + created_by <> me                                ->  50.9 ms, 53k rows scanned
--
-- Measured with EXPLAIN ANALYZE on prod before this migration. Both indexes
-- carry created_at DESC so the ORDER BY is satisfied by the index and the sort
-- disappears; the leading institution_id column keeps the global tab
-- (institution_id IS NULL) on the same index.
--
-- Rollback: DROP INDEX both names below.

CREATE INDEX IF NOT EXISTS idx_question_bank_institution_created_at
  ON public.question_bank (institution_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_question_bank_institution_creator_created_at
  ON public.question_bank (institution_id, created_by, created_at DESC);
