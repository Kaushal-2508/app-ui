-- =============================================================================
-- DIAGNOSTIC ONLY — verify the final state after split/regen/constraints.
-- Emits counts via RAISE NOTICE. No schema or data changes.
-- =============================================================================

DO $$
DECLARE
  n INT;
  rec RECORD;
BEGIN
  SELECT COUNT(*) INTO n FROM (
    SELECT us.id
      FROM public.universal_subjects us
      JOIN public.subject_class_group_mappings scgm ON scgm.subject_id = us.id
     WHERE us.institution_id IS NOT NULL AND us.is_active = true
     GROUP BY us.id
    HAVING COUNT(scgm.class_group_id) > 1
  ) t;
  RAISE NOTICE '[verify] multi_class_subjects = %', n;

  SELECT COUNT(*) INTO n
    FROM public.universal_subjects us
    LEFT JOIN public.subject_class_group_mappings scgm ON scgm.subject_id = us.id
   WHERE us.institution_id IS NOT NULL AND us.is_active = true AND scgm.subject_id IS NULL;
  RAISE NOTICE '[verify] orphan_active_subjects = %', n;

  SELECT COUNT(*) INTO n FROM (
    SELECT institution_id, UPPER(TRIM(code))
      FROM public.universal_subjects
     WHERE institution_id IS NOT NULL AND is_active = true
       AND code IS NOT NULL AND TRIM(code) <> ''
     GROUP BY institution_id, UPPER(TRIM(code))
    HAVING COUNT(*) > 1
  ) t;
  RAISE NOTICE '[verify] institution_code_duplicate_groups = %', n;

  SELECT COUNT(*) INTO n
    FROM public.universal_subjects
   WHERE institution_id IS NOT NULL AND is_active = true
     AND (code IS NULL OR TRIM(code) = '');
  RAISE NOTICE '[verify] subjects_without_code = %', n;

  SELECT COUNT(*) INTO n
    FROM public.universal_subjects
   WHERE institution_id IS NOT NULL AND is_active = true;
  RAISE NOTICE '[verify] total_active_inst_subjects = %', n;

  -- Sample of new codes
  RAISE NOTICE '[verify] sample codes:';
  FOR rec IN
    SELECT us.name, us.code, gl.grade_number, cg.name AS class_group
      FROM public.universal_subjects us
      JOIN public.subject_class_group_mappings scgm ON scgm.subject_id = us.id
      JOIN public.class_groups cg ON cg.id = scgm.class_group_id
      JOIN public.grade_levels gl ON gl.id = cg.grade_level_id
     WHERE us.institution_id IS NOT NULL AND us.is_active = true
     ORDER BY us.name, gl.grade_number
     LIMIT 20
  LOOP
    RAISE NOTICE '    name=% code=% grade=% group=%',
      rec.name, rec.code, rec.grade_number, rec.class_group;
  END LOOP;
END
$$;
