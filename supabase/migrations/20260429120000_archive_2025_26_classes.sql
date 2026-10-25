-- =============================================================
-- ARCHIVE 2025-26 CLASSES (post-rollover cleanup)
-- -------------------------------------------------------------
-- The 2025-26 → 2026-27 rollover (20260428120000_rollover_*)
-- mirrored every class and group into the new academic year and
-- moved class_assignments across. The 2025-26 class_groups and
-- classes rows themselves were left untouched so that historical
-- exam_classes / attendance / final_results / lesson_plans /
-- timetable_slots / chapter_topics / question_bank_section_scope
-- continue to resolve.
--
-- This migration SOFT-DELETES those now-empty shells by flipping
-- is_active=false. Every consumer that filters by is_active=true
-- stops surfacing them immediately; historical reads that resolve
-- by class_id directly are unaffected.
--
-- Idempotent — guarded UPDATEs are no-ops on re-run.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. classes (sections)
-- -------------------------------------------------------------
UPDATE public.classes
SET is_active = false
WHERE academic_year = '2025-26'
  AND is_active = true;

-- -------------------------------------------------------------
-- 2. class_groups (parent containers)
-- -------------------------------------------------------------
UPDATE public.class_groups
SET is_active = false
WHERE academic_year = '2025-26'
  AND is_active = true;

-- -------------------------------------------------------------
-- Diagnostics
-- -------------------------------------------------------------
DO $$
DECLARE
  v_archived_classes INT;
  v_archived_groups  INT;
  v_orphan_assigns   INT;
BEGIN
  SELECT COUNT(*) INTO v_archived_classes
  FROM public.classes
  WHERE academic_year = '2025-26' AND is_active = false;

  SELECT COUNT(*) INTO v_archived_groups
  FROM public.class_groups
  WHERE academic_year = '2025-26' AND is_active = false;

  -- class_assignments rows that the rollover couldn't move because
  -- a UNIQUE (user_id, class_id, subject_id) conflict existed on
  -- the 2026-27 mirror. Left in place; they point at archived
  -- classes so UI JOINs that filter by is_active drop them.
  SELECT COUNT(*) INTO v_orphan_assigns
  FROM public.class_assignments ca
  JOIN public.classes c ON c.id = ca.class_id
  WHERE c.academic_year = '2025-26';

  RAISE NOTICE 'Archived 2025-26 data:';
  RAISE NOTICE '  classes archived:               %', v_archived_classes;
  RAISE NOTICE '  class_groups archived:          %', v_archived_groups;
  RAISE NOTICE '  class_assignments still on 2025-26 (orphans, kept): %', v_orphan_assigns;
END $$;

COMMIT;
