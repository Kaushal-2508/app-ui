-- =====================================================================
-- Salci Environment — TEST DATA seed (Phase 1: classes + subjects + wings)
-- =====================================================================
-- Idempotent. Re-runnable. Cleanup query (when you're done testing):
--   DELETE FROM auth.users WHERE email LIKE '%@sdrl.test';
-- (cascades through profiles, user_roles, class_assignments,
--  wing_assignments, attendance_pins, etc.)
--
-- Structural rows only: class_groups, classes, subjects, mappings, wings.
-- The user-facing seed (school_admin, coordinators, teachers, students)
-- lives in 20260515000100_seed_salci_environment_users.sql.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $seed$
DECLARE
  v_inst UUID;
  v_year TEXT := '2025-2026';
  v_group_id UUID;
  v_grade_id UUID;
  v_subject_id UUID;
  v_wing_junior UUID;
  v_wing_senior UUID;

  -- (group_name, grade_number, sort_order)
  group_specs CONSTANT TEXT[][] := ARRAY[
    ARRAY['Nursery', '-3', '1'],
    ARRAY['LKG',     '-2', '2'],
    ARRAY['UKG',     '-1', '3'],
    ARRAY['Class 1',  '1', '4'],
    ARRAY['Class 2',  '2', '5'],
    ARRAY['Class 3',  '3', '6'],
    ARRAY['Class 4',  '4', '7'],
    ARRAY['Class 5',  '5', '8'],
    ARRAY['Class 6',  '6', '9'],
    ARRAY['Class 7',  '7', '10'],
    ARRAY['Class 8',  '8', '11'],
    ARRAY['Class 9',  '9', '12'],
    ARRAY['Class 10','10', '13'],
    ARRAY['Class 11','11', '14'],
    ARRAY['Class 12','12', '15']
  ];

  -- (group_name, subject_name)
  subj_specs CONSTANT TEXT[][] := ARRAY[
    -- pre-primary
    ARRAY['Nursery', 'English'], ARRAY['Nursery', 'Hindi'], ARRAY['Nursery', 'Mathematics'], ARRAY['Nursery', 'Environmental Studies'],
    ARRAY['LKG',     'English'], ARRAY['LKG',     'Hindi'], ARRAY['LKG',     'Mathematics'], ARRAY['LKG',     'Environmental Studies'],
    ARRAY['UKG',     'English'], ARRAY['UKG',     'Hindi'], ARRAY['UKG',     'Mathematics'], ARRAY['UKG',     'Environmental Studies'],
    -- primary 1-3 (no Computer)
    ARRAY['Class 1', 'English'], ARRAY['Class 1', 'Hindi'], ARRAY['Class 1', 'Mathematics'], ARRAY['Class 1', 'Environmental Studies'],
    ARRAY['Class 2', 'English'], ARRAY['Class 2', 'Hindi'], ARRAY['Class 2', 'Mathematics'], ARRAY['Class 2', 'Environmental Studies'],
    ARRAY['Class 3', 'English'], ARRAY['Class 3', 'Hindi'], ARRAY['Class 3', 'Mathematics'], ARRAY['Class 3', 'Environmental Studies'],
    -- primary 4-5 add Computer Science
    ARRAY['Class 4', 'English'], ARRAY['Class 4', 'Hindi'], ARRAY['Class 4', 'Mathematics'], ARRAY['Class 4', 'Environmental Studies'], ARRAY['Class 4', 'Computer Science'],
    ARRAY['Class 5', 'English'], ARRAY['Class 5', 'Hindi'], ARRAY['Class 5', 'Mathematics'], ARRAY['Class 5', 'Environmental Studies'], ARRAY['Class 5', 'Computer Science'],
    -- middle 6-8 (drop EVS, add Science + Social)
    ARRAY['Class 6', 'English'], ARRAY['Class 6', 'Hindi'], ARRAY['Class 6', 'Mathematics'], ARRAY['Class 6', 'Science'], ARRAY['Class 6', 'Social Studies'], ARRAY['Class 6', 'Computer Science'],
    ARRAY['Class 7', 'English'], ARRAY['Class 7', 'Hindi'], ARRAY['Class 7', 'Mathematics'], ARRAY['Class 7', 'Science'], ARRAY['Class 7', 'Social Studies'], ARRAY['Class 7', 'Computer Science'],
    ARRAY['Class 8', 'English'], ARRAY['Class 8', 'Hindi'], ARRAY['Class 8', 'Mathematics'], ARRAY['Class 8', 'Science'], ARRAY['Class 8', 'Social Studies'], ARRAY['Class 8', 'Computer Science'],
    -- secondary 9-10 (split Science → Physics + Chem + Bio)
    ARRAY['Class 9', 'English'], ARRAY['Class 9', 'Hindi'], ARRAY['Class 9', 'Mathematics'], ARRAY['Class 9', 'Physics'], ARRAY['Class 9', 'Chemistry'], ARRAY['Class 9', 'Biology'], ARRAY['Class 9', 'Social Studies'], ARRAY['Class 9', 'Computer Science'],
    ARRAY['Class 10','English'], ARRAY['Class 10','Hindi'], ARRAY['Class 10','Mathematics'], ARRAY['Class 10','Physics'], ARRAY['Class 10','Chemistry'], ARRAY['Class 10','Biology'], ARRAY['Class 10','Social Studies'], ARRAY['Class 10','Computer Science'],
    -- senior 11-12 (Sci stream)
    ARRAY['Class 11','English'], ARRAY['Class 11','Mathematics'], ARRAY['Class 11','Physics'], ARRAY['Class 11','Chemistry'], ARRAY['Class 11','Biology'],
    ARRAY['Class 12','English'], ARRAY['Class 12','Mathematics'], ARRAY['Class 12','Physics'], ARRAY['Class 12','Chemistry'], ARRAY['Class 12','Biology']
  ];

  -- (subject_name, category) — master subject list (universal_subjects with NULL institution_id + grade_level_id)
  subject_master CONSTANT TEXT[][] := ARRAY[
    ARRAY['English',                'language'],
    ARRAY['Hindi',                  'language'],
    ARRAY['Mathematics',            'core'],
    ARRAY['Environmental Studies',  'core'],
    ARRAY['Science',                'core'],
    ARRAY['Social Studies',         'core'],
    ARRAY['Computer Science',       'core'],
    ARRAY['Physics',                'core'],
    ARRAY['Chemistry',              'core'],
    ARRAY['Biology',                'core']
  ];
BEGIN
  -- Locate the institution by name. If absent, no-op.
  SELECT id INTO v_inst FROM public.institutions WHERE name = 'Salci Environment' LIMIT 1;
  IF v_inst IS NULL THEN
    RAISE NOTICE 'Salci Environment not found — skipping seed.';
    RETURN;
  END IF;
  RAISE NOTICE 'Seeding Salci Environment (institution_id=%)', v_inst;

  -- ------------------------------------------------------------
  -- Universal subjects — ensure one GLOBAL row per subject
  -- (institution_id IS NULL, grade_level_id IS NULL).
  -- ------------------------------------------------------------
  DROP TABLE IF EXISTS pg_temp.sdrl_seed_subj_lookup;
  CREATE TEMP TABLE pg_temp.sdrl_seed_subj_lookup (
    name TEXT PRIMARY KEY,
    id   UUID NOT NULL
  );

  FOR i IN 1..array_length(subject_master, 1) LOOP
    SELECT id INTO v_subject_id
    FROM public.universal_subjects
    WHERE institution_id IS NULL
      AND grade_level_id IS NULL
      AND LOWER(name) = LOWER(subject_master[i][1])
    LIMIT 1;

    IF v_subject_id IS NULL THEN
      INSERT INTO public.universal_subjects (name, category, is_active, institution_id, grade_level_id)
      VALUES (subject_master[i][1], subject_master[i][2], true, NULL, NULL)
      RETURNING id INTO v_subject_id;
    END IF;

    INSERT INTO pg_temp.sdrl_seed_subj_lookup (name, id) VALUES (subject_master[i][1], v_subject_id)
    ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  END LOOP;

  -- ------------------------------------------------------------
  -- Class groups (15) + grade_levels lookup.
  -- ------------------------------------------------------------
  FOR i IN 1..array_length(group_specs, 1) LOOP
    INSERT INTO public.grade_levels (grade_number, grade_name, display_order)
    VALUES (group_specs[i][2]::INTEGER, group_specs[i][1], group_specs[i][3]::INTEGER)
    ON CONFLICT (grade_number) DO NOTHING;

    SELECT id INTO v_grade_id FROM public.grade_levels WHERE grade_number = group_specs[i][2]::INTEGER;

    INSERT INTO public.class_groups (institution_id, name, grade_level_id, academic_year, is_active)
    VALUES (v_inst, group_specs[i][1], v_grade_id, v_year, true)
    ON CONFLICT (institution_id, name, academic_year) DO UPDATE
      SET grade_level_id = EXCLUDED.grade_level_id;
  END LOOP;

  -- ------------------------------------------------------------
  -- Two sections (A, B) per class group.
  -- ------------------------------------------------------------
  FOR i IN 1..array_length(group_specs, 1) LOOP
    SELECT id INTO v_group_id FROM public.class_groups
    WHERE institution_id = v_inst AND name = group_specs[i][1] AND academic_year = v_year;

    INSERT INTO public.classes (institution_id, name, section, academic_year, class_group_id, is_active)
    SELECT v_inst, group_specs[i][1], 'A', v_year, v_group_id, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.classes
      WHERE institution_id = v_inst AND name = group_specs[i][1] AND section = 'A' AND academic_year = v_year
    );

    INSERT INTO public.classes (institution_id, name, section, academic_year, class_group_id, is_active)
    SELECT v_inst, group_specs[i][1], 'B', v_year, v_group_id, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.classes
      WHERE institution_id = v_inst AND name = group_specs[i][1] AND section = 'B' AND academic_year = v_year
    );
  END LOOP;

  -- ------------------------------------------------------------
  -- Subject ↔ class group mappings.
  -- The fanout trigger (§22) materializes per-section rows in
  -- subject_class_mappings automatically.
  -- ------------------------------------------------------------
  FOR i IN 1..array_length(subj_specs, 1) LOOP
    SELECT id INTO v_group_id FROM public.class_groups
    WHERE institution_id = v_inst AND name = subj_specs[i][1] AND academic_year = v_year;

    SELECT id INTO v_subject_id FROM pg_temp.sdrl_seed_subj_lookup
    WHERE name = subj_specs[i][2];

    IF v_group_id IS NOT NULL AND v_subject_id IS NOT NULL THEN
      INSERT INTO public.subject_class_group_mappings (institution_id, class_group_id, subject_id)
      VALUES (v_inst, v_group_id, v_subject_id)
      ON CONFLICT (institution_id, class_group_id, subject_id) DO NOTHING;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------
  -- Wings — Junior (Nursery–5) and Senior (6–12).
  -- ------------------------------------------------------------
  INSERT INTO public.wings (institution_id, name, description, display_order, is_active)
  VALUES
    (v_inst, 'Junior Wing', 'Nursery to Class 5', 1, true),
    (v_inst, 'Senior Wing', 'Class 6 to Class 12', 2, true)
  ON CONFLICT (institution_id, name) DO NOTHING;

  SELECT id INTO v_wing_junior FROM public.wings WHERE institution_id = v_inst AND name = 'Junior Wing';
  SELECT id INTO v_wing_senior FROM public.wings WHERE institution_id = v_inst AND name = 'Senior Wing';

  INSERT INTO public.wing_class_mappings (wing_id, class_id)
  SELECT v_wing_junior, c.id
  FROM public.classes c
  JOIN public.class_groups cg ON cg.id = c.class_group_id
  WHERE c.institution_id = v_inst
    AND c.academic_year = v_year
    AND cg.name IN ('Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5')
  ON CONFLICT (wing_id, class_id) DO NOTHING;

  INSERT INTO public.wing_class_mappings (wing_id, class_id)
  SELECT v_wing_senior, c.id
  FROM public.classes c
  JOIN public.class_groups cg ON cg.id = c.class_group_id
  WHERE c.institution_id = v_inst
    AND c.academic_year = v_year
    AND cg.name IN ('Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12')
  ON CONFLICT (wing_id, class_id) DO NOTHING;

  RAISE NOTICE 'Structural seed complete: 15 class groups, 30 classes, 10 subjects, 2 wings.';
END;
$seed$;
