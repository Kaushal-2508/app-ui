-- =====================================================================
-- Fix academic_year format on Salci seed rows
-- =====================================================================
-- The app's currentAcademicYearFromDate() helper returns the YYYY-YY
-- short format (e.g. "2026-27"). My seed migrations stored the long
-- form ("2026-2027"), so the teacher / student timetable status query
-- couldn't match any rows for the current academic year — every
-- teacher saw "no-class-assignments" / "Time table is yet to be
-- approved by the admin" even though the rows existed.
--
-- This migration normalises the AY string in every place it appears:
--   class_groups, classes, tt_class_structure, tt_slots, and a few
--   institution-level academic-year tables in case they were touched.
--
-- Idempotent — UPDATEs a no-op once the rows already use the short form.

DO $fix$
DECLARE
  v_inst UUID;
BEGIN
  SELECT id INTO v_inst FROM public.institutions WHERE name = 'Salci National School' LIMIT 1;
  IF v_inst IS NULL THEN
    RAISE NOTICE 'Salci National School not found — skipping AY fix.';
    RETURN;
  END IF;

  -- 2026-2027 → 2026-27
  UPDATE public.tt_slots
  SET academic_year = '2026-27'
  WHERE institution_id = v_inst AND academic_year = '2026-2027';

  UPDATE public.tt_class_structure
  SET academic_year = '2026-27'
  WHERE institution_id = v_inst AND academic_year = '2026-2027';

  UPDATE public.classes
  SET academic_year = '2026-27'
  WHERE institution_id = v_inst AND academic_year = '2026-2027';

  UPDATE public.class_groups
  SET academic_year = '2026-27'
  WHERE institution_id = v_inst AND academic_year = '2026-2027';

  -- And, defensively, the older 2025-2026 form if any rows missed the
  -- previous remediation.
  UPDATE public.tt_slots
  SET academic_year = '2025-26'
  WHERE institution_id = v_inst AND academic_year = '2025-2026';

  UPDATE public.tt_class_structure
  SET academic_year = '2025-26'
  WHERE institution_id = v_inst AND academic_year = '2025-2026';

  UPDATE public.classes
  SET academic_year = '2025-26'
  WHERE institution_id = v_inst AND academic_year = '2025-2026';

  UPDATE public.class_groups
  SET academic_year = '2025-26'
  WHERE institution_id = v_inst AND academic_year = '2025-2026';

  RAISE NOTICE 'Academic-year format normalised to YYYY-YY for Salci National School.';
END;
$fix$;
