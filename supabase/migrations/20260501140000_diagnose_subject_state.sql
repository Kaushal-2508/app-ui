-- =============================================================================
-- DIAGNOSTIC ONLY — no schema or data changes.
-- Reports counts + examples so we know how to size the subject-code cleanup.
-- Emits results via RAISE NOTICE. Safe to re-run.
-- =============================================================================

DO $$
DECLARE
  rec RECORD;
  n INT;
BEGIN
  -----------------------------------------------------------------
  -- 1. Multi-class subjects (one subject mapped to >1 class_group)
  -----------------------------------------------------------------
  SELECT COUNT(*) INTO n FROM (
    SELECT us.id
    FROM public.universal_subjects us
    JOIN public.subject_class_group_mappings scgm ON scgm.subject_id = us.id
    WHERE us.institution_id IS NOT NULL AND us.is_active = true
    GROUP BY us.id
    HAVING COUNT(scgm.class_group_id) > 1
  ) t;
  RAISE NOTICE '[1] multi_class_subjects count = %', n;

  FOR rec IN
    SELECT us.id, us.name, us.code,
           COUNT(scgm.class_group_id) AS n_groups,
           ARRAY_AGG(cg.name ORDER BY scgm.created_at) AS groups
    FROM public.universal_subjects us
    JOIN public.subject_class_group_mappings scgm ON scgm.subject_id = us.id
    JOIN public.class_groups cg ON cg.id = scgm.class_group_id
    WHERE us.institution_id IS NOT NULL AND us.is_active = true
    GROUP BY us.id, us.name, us.code
    HAVING COUNT(scgm.class_group_id) > 1
    ORDER BY n_groups DESC, us.name
    LIMIT 20
  LOOP
    RAISE NOTICE '    multi_class: id=% name=% code=% n=% groups=%',
      rec.id, rec.name, COALESCE(rec.code, '(null)'), rec.n_groups, rec.groups;
  END LOOP;

  -----------------------------------------------------------------
  -- 2. Orphan subjects (no class_group mapping at all)
  -----------------------------------------------------------------
  SELECT COUNT(*) INTO n
    FROM public.universal_subjects us
    LEFT JOIN public.subject_class_group_mappings scgm ON scgm.subject_id = us.id
   WHERE us.institution_id IS NOT NULL
     AND us.is_active = true
     AND scgm.subject_id IS NULL;
  RAISE NOTICE '[2] orphan_subjects count = %', n;

  FOR rec IN
    SELECT us.id, us.name, us.code, us.institution_id
      FROM public.universal_subjects us
      LEFT JOIN public.subject_class_group_mappings scgm ON scgm.subject_id = us.id
     WHERE us.institution_id IS NOT NULL
       AND us.is_active = true
       AND scgm.subject_id IS NULL
     ORDER BY us.created_at
     LIMIT 20
  LOOP
    RAISE NOTICE '    orphan: id=% name=% code=% inst=%',
      rec.id, rec.name, COALESCE(rec.code, '(null)'), rec.institution_id;
  END LOOP;

  -----------------------------------------------------------------
  -- 3. Institution-wide code duplicates
  -----------------------------------------------------------------
  SELECT COUNT(*) INTO n FROM (
    SELECT institution_id, UPPER(TRIM(code)) AS c
    FROM public.universal_subjects
    WHERE institution_id IS NOT NULL AND is_active = true
      AND code IS NOT NULL AND TRIM(code) <> ''
    GROUP BY institution_id, UPPER(TRIM(code))
    HAVING COUNT(*) > 1
  ) t;
  RAISE NOTICE '[3] institution_code_duplicate_groups = %', n;

  FOR rec IN
    SELECT institution_id,
           UPPER(TRIM(code)) AS norm_code,
           COUNT(*) AS n_subjects,
           ARRAY_AGG(name ORDER BY created_at) AS names
      FROM public.universal_subjects
     WHERE institution_id IS NOT NULL AND is_active = true
       AND code IS NOT NULL AND TRIM(code) <> ''
     GROUP BY institution_id, UPPER(TRIM(code))
    HAVING COUNT(*) > 1
     ORDER BY n_subjects DESC
     LIMIT 20
  LOOP
    RAISE NOTICE '    code_dup: inst=% code=% n=% names=%',
      rec.institution_id, rec.norm_code, rec.n_subjects, rec.names;
  END LOOP;

  -----------------------------------------------------------------
  -- 4. Subjects without a code (NULL or blank)
  -----------------------------------------------------------------
  SELECT COUNT(*) INTO n
    FROM public.universal_subjects
   WHERE institution_id IS NOT NULL
     AND is_active = true
     AND (code IS NULL OR TRIM(code) = '');
  RAISE NOTICE '[4] subjects_without_code count = %', n;

  -----------------------------------------------------------------
  -- 5. Total active institution-scoped subjects (denominator)
  -----------------------------------------------------------------
  SELECT COUNT(*) INTO n
    FROM public.universal_subjects
   WHERE institution_id IS NOT NULL AND is_active = true;
  RAISE NOTICE '[5] total_active_inst_subjects = %', n;
END
$$;
