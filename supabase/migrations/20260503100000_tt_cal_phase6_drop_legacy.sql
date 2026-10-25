-- =============================================================
-- TIMETABLE + ACADEMIC CALENDAR REBUILD — PHASE 6 (FINAL CLEANUP)
-- -------------------------------------------------------------
-- Drops the seven legacy tables now that every active consumer has
-- been rewired to the tt_* / cal_* schema. Also drops the
-- tt_backfill_from_legacy() SQL function which referenced them.
--
-- IRREVERSIBLE: once this migration applies, restoring the old
-- rows requires a Supabase point-in-time backup. Run only after
-- the Phase 5 cutover has soaked and all code paths have been
-- verified through manual QA.
--
-- Expected state before this migration:
--   * 0 rows in code referencing period_structures / period_slots /
--     class_period_structure / shared_resources / timetable_slots /
--     lesson_plans / academic_calendar. (Verified by grep in
--     Phase 6a commit.)
--   * Edge functions copy-timetable-template and get-working-days
--     redeployed to read/write tt_slots + cal_events.
--   * No dual-write in timetableCompat.ts.
-- =============================================================

-- Drop in dependency order (child tables first) with CASCADE so
-- that any stray FKs, indexes, triggers, or RLS policies attached
-- to these tables come down together. We do NOT use IF EXISTS
-- guards because the whole point of this migration is to assert
-- that the old tables are really gone.

DROP TABLE public.lesson_plans CASCADE;
DROP TABLE public.timetable_slots CASCADE;
DROP TABLE public.class_period_structure CASCADE;
DROP TABLE public.period_slots CASCADE;
DROP TABLE public.period_structures CASCADE;
DROP TABLE public.shared_resources CASCADE;
DROP TABLE public.academic_calendar CASCADE;

-- The backfill function referenced the legacy tables in its SELECT
-- list. It's never invoked again (Phase 2 ran it once) so drop it
-- along with the source tables.
DROP FUNCTION IF EXISTS public.tt_backfill_from_legacy();

-- Drop the academic_calendar-specific enum + triggers that are now
-- orphaned. The enum type lived on a column that just got removed.
DROP TYPE IF EXISTS public.academic_event_type;

-- Sanity notice so the migration log confirms the final state.
DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO remaining_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'lesson_plans',
      'timetable_slots',
      'class_period_structure',
      'period_slots',
      'period_structures',
      'shared_resources',
      'academic_calendar'
    );
  IF remaining_count <> 0 THEN
    RAISE EXCEPTION 'Phase 6 drop incomplete: % legacy tables still present', remaining_count;
  END IF;
  RAISE NOTICE 'Phase 6 drop complete: all 7 legacy tables removed.';
END $$;
