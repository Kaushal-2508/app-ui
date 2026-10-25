BEGIN;

ALTER TABLE public.reported_issues DROP COLUMN IF EXISTS admin_notes;

DROP POLICY IF EXISTS "Users can view own reports" ON public.reported_issues;
DROP POLICY IF EXISTS "Super admins view all reports" ON public.reported_issues;
CREATE POLICY "Super admins view all reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));

DO $$
DECLARE
  v_leftover integer;
BEGIN
  SELECT count(*) INTO v_leftover
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ILIKE '%admin_notes%';

  IF v_leftover > 0 THEN
    RAISE EXCEPTION
      'DRY RUN FAILED: % function(s) still reference admin_notes; rewrite them before dropping the column',
      v_leftover;
  END IF;
END $$;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='reported_issues'
           AND column_name='admin_notes') = 1 AS rolled_back_clean;
