DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='homework_assignments'
                    AND column_name='published_at') THEN
    RAISE EXCEPTION 'FAIL: homework_assignments.published_at is missing';
  END IF;
  -- tgname alone would still PASS for a same-named trigger pointing at the
  -- wrong function, or with the wrong timing/row-scope, or missing the
  -- INSERT/UPDATE event bits. Join to pg_proc for the function identity and
  -- check the tgtype bitmask for BEFORE (2) + FOR EACH ROW (1) + INSERT (4)
  -- + UPDATE (16) = 23.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE t.tgname = 'set_homework_published_at'
      AND NOT t.tgisinternal
      AND t.tgrelid = 'public.homework_assignments'::regclass
      AND n.nspname = 'public'
      AND p.proname = 'tg_set_homework_published_at'
      AND (t.tgtype & 1) = 1   -- FOR EACH ROW
      AND (t.tgtype & 2) = 2   -- BEFORE
      AND (t.tgtype & 4) = 4   -- INSERT
      AND (t.tgtype & 16) = 16 -- UPDATE
  ) THEN
    RAISE EXCEPTION 'FAIL: set_homework_published_at is not a BEFORE INSERT OR UPDATE ROW trigger on public.homework_assignments calling public.tg_set_homework_published_at()';
  END IF;
  -- indexname alone would still PASS for a rebuilt index with the wrong
  -- columns, order, or predicate. Check indexdef for the exact
  -- (created_by, published_at) column pair and a status-scoped WHERE clause.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='homework_assignments'
      AND indexname='idx_homework_assignments_creator_published'
      AND indexdef LIKE '%(created_by, published_at)%'
      AND indexdef LIKE '%WHERE (status%'
  ) THEN
    RAISE EXCEPTION 'FAIL: idx_homework_assignments_creator_published is missing or does not index (created_by, published_at) with a status predicate';
  END IF;
  -- every already-published row must have been backfilled
  IF EXISTS (SELECT 1 FROM public.homework_assignments
              WHERE status IN ('published','checked') AND published_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: % published/checked rows still have NULL published_at',
      (SELECT count(*) FROM public.homework_assignments
        WHERE status IN ('published','checked') AND published_at IS NULL);
  END IF;
  -- a draft must NOT have one
  IF EXISTS (SELECT 1 FROM public.homework_assignments
              WHERE status='draft' AND published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: draft rows carry a published_at';
  END IF;
  RAISE NOTICE 'PASS: verify-01 homework published_at';
END $$;
