-- =============================================================
-- ACADEMIC-YEAR ROLLOVER — 2025-26 → 2026-27 (all institutions)
-- -------------------------------------------------------------
-- One-shot tenant-wide rollover: map every currently enrolled
-- user (students, teachers, coordinators) from the 2025-26
-- academic year to 2026-27 WITHOUT promoting students (a user
-- tied to "Class 9A 2025-26" becomes tied to "Class 9A 2026-27",
-- same grade, same section, same subject for teachers).
--
-- Carry-forward scope:
--   1. class_groups             (required — FK parent of classes)
--   2. classes                  (required — FK target of assignments)
--   3. wing_class_mappings      (so wings aren't empty)
--   4. class_period_structure   (so timetable grid has a structure)
--   5. subject_class_group_mappings (trigger fans out to per-section)
--   6. class_assignments (all roles)   ← the actual mapping
--
-- Explicitly NOT carried forward:
--   * timetable_slots           (use copy-timetable-template EF)
--   * academic_calendar         (admin action on each institution)
--   * fees                      (out of scope per §22 invariants)
--   * Inactive classes          (skipped at every level)
--
-- Idempotent — every INSERT is guarded by NOT EXISTS so this
-- migration is safe to re-run. class_assignments rows whose
-- target (user_id, class_id, subject_id) already exists on a
-- 2026-27 class are left untouched to respect the UNIQUE key.
-- =============================================================

BEGIN;

-- Source and target academic year labels, kept in temp so every
-- statement below reads the same literal and the migration stays
-- easy to audit.
CREATE TEMP TABLE rollover_config (
  source_year TEXT NOT NULL,
  target_year TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO rollover_config (source_year, target_year)
VALUES ('2025-26', '2026-27');

-- -------------------------------------------------------------
-- 1. class_groups mirror
-- -------------------------------------------------------------
-- Each (institution, name) active in 2025-26 gets a matching row
-- for 2026-27. grade_level_id carried verbatim — no promotion.
-- UNIQUE (institution_id, name, academic_year) handles dedup when
-- re-run; the ON CONFLICT clause keeps the migration idempotent.
-- -------------------------------------------------------------
INSERT INTO public.class_groups (
  institution_id, name, grade_level_id, academic_year, is_active
)
SELECT
  cg.institution_id,
  cg.name,
  cg.grade_level_id,
  (SELECT target_year FROM rollover_config),
  true
FROM public.class_groups cg
WHERE cg.academic_year = (SELECT source_year FROM rollover_config)
  AND cg.is_active = true
ON CONFLICT (institution_id, name, academic_year) DO NOTHING;

-- -------------------------------------------------------------
-- 2. classes (sections) mirror
-- -------------------------------------------------------------
-- For every 2025-26 active class, create a matching row for
-- 2026-27 under the corresponding NEW class_group. Match the
-- parent group by (institution_id, name, target_year).
--
-- No natural UNIQUE on `classes`, so we de-dup manually by
-- (institution_id, name, section, academic_year) via NOT EXISTS.
-- -------------------------------------------------------------
INSERT INTO public.classes (
  institution_id,
  name,
  section,
  academic_year,
  is_active,
  class_group_id
)
SELECT
  c.institution_id,
  c.name,
  c.section,
  (SELECT target_year FROM rollover_config),
  true,
  new_cg.id
FROM public.classes c
JOIN public.class_groups new_cg
  ON  new_cg.institution_id = c.institution_id
  AND new_cg.name           = c.name
  AND new_cg.academic_year  = (SELECT target_year FROM rollover_config)
WHERE c.academic_year = (SELECT source_year FROM rollover_config)
  AND c.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.classes c2
    WHERE c2.institution_id = c.institution_id
      AND c2.name           = c.name
      AND COALESCE(c2.section, '') = COALESCE(c.section, '')
      AND c2.academic_year  = (SELECT target_year FROM rollover_config)
  );

-- -------------------------------------------------------------
-- 3. wing_class_mappings mirror
-- -------------------------------------------------------------
-- For every (wing, 2025-26 class) pair, create the same (wing,
-- 2026-27 class) pair. The JOIN is on (institution, name,
-- section) so we find the newly-created mirror class from step 2.
-- -------------------------------------------------------------
INSERT INTO public.wing_class_mappings (wing_id, class_id)
SELECT
  wcm.wing_id,
  new_c.id
FROM public.wing_class_mappings wcm
JOIN public.classes old_c ON old_c.id = wcm.class_id
JOIN public.classes new_c
  ON  new_c.institution_id = old_c.institution_id
  AND new_c.name           = old_c.name
  AND COALESCE(new_c.section, '') = COALESCE(old_c.section, '')
  AND new_c.academic_year  = (SELECT target_year FROM rollover_config)
WHERE old_c.academic_year = (SELECT source_year FROM rollover_config)
  AND old_c.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.wing_class_mappings wcm2
    WHERE wcm2.wing_id   = wcm.wing_id
      AND wcm2.class_id  = new_c.id
  );

-- -------------------------------------------------------------
-- 4. class_period_structure mirror
-- -------------------------------------------------------------
-- The assignment is 1:1 per class (`class_id UNIQUE`) so we only
-- insert a new row if the new class doesn't already have a
-- structure assigned.
-- -------------------------------------------------------------
INSERT INTO public.class_period_structure (
  institution_id, class_id, structure_id
)
SELECT
  cps.institution_id,
  new_c.id,
  cps.structure_id
FROM public.class_period_structure cps
JOIN public.classes old_c ON old_c.id = cps.class_id
JOIN public.classes new_c
  ON  new_c.institution_id = old_c.institution_id
  AND new_c.name           = old_c.name
  AND COALESCE(new_c.section, '') = COALESCE(old_c.section, '')
  AND new_c.academic_year  = (SELECT target_year FROM rollover_config)
WHERE old_c.academic_year = (SELECT source_year FROM rollover_config)
  AND old_c.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.class_period_structure cps2
    WHERE cps2.class_id = new_c.id
  );

-- -------------------------------------------------------------
-- 5. subject_class_group_mappings mirror
-- -------------------------------------------------------------
-- Writing here triggers `fanout_subject_class_group_mapping()`
-- (§22 dual-table invariant) which materialises one
-- subject_class_mappings row per child section automatically.
-- DO NOT also write to subject_class_mappings directly.
-- -------------------------------------------------------------
INSERT INTO public.subject_class_group_mappings (
  institution_id, class_group_id, subject_id
)
SELECT
  scgm.institution_id,
  new_cg.id,
  scgm.subject_id
FROM public.subject_class_group_mappings scgm
JOIN public.class_groups old_cg ON old_cg.id = scgm.class_group_id
JOIN public.class_groups new_cg
  ON  new_cg.institution_id = old_cg.institution_id
  AND new_cg.name           = old_cg.name
  AND new_cg.academic_year  = (SELECT target_year FROM rollover_config)
WHERE old_cg.academic_year = (SELECT source_year FROM rollover_config)
  AND old_cg.is_active = true
ON CONFLICT (institution_id, class_group_id, subject_id) DO NOTHING;

-- -------------------------------------------------------------
-- 6. class_assignments — carry forward ALL users
-- -------------------------------------------------------------
-- The core request. For every enrolled user (students, teachers,
-- coordinators) on a 2025-26 class, re-point the row to the
-- matching 2026-27 class. Match by (institution, name, section)
-- so grade stays identical (Class 9A → Class 9A), and subject_id
-- is preserved verbatim (teacher of "Class 9A Maths" 2025-26
-- becomes teacher of "Class 9A Maths" 2026-27).
--
-- The UNIQUE key on (user_id, class_id, subject_id) means we
-- must skip any source row whose move would collide with an
-- existing 2026-27 row for the same person+subject — this keeps
-- the migration safe to re-run after partial/manual rollovers.
-- `IS NOT DISTINCT FROM` handles the NULL subject_id case
-- (students/coordinators) the same way the UNIQUE does.
-- -------------------------------------------------------------
WITH assignment_moves AS (
  SELECT
    ca.id            AS assignment_id,
    new_c.id         AS new_class_id
  FROM public.class_assignments ca
  JOIN public.classes old_c ON old_c.id = ca.class_id
  JOIN public.classes new_c
    ON  new_c.institution_id = old_c.institution_id
    AND new_c.name           = old_c.name
    AND COALESCE(new_c.section, '') = COALESCE(old_c.section, '')
    AND new_c.academic_year  = (SELECT target_year FROM rollover_config)
  WHERE old_c.academic_year = (SELECT source_year FROM rollover_config)
    AND old_c.is_active = true
    -- Skip if moving would collide with an existing 2026-27 row
    -- for the same (user, class, subject) tuple. IS NOT DISTINCT
    -- FROM mirrors UNIQUE's NULL-equality behaviour.
    AND NOT EXISTS (
      SELECT 1
      FROM public.class_assignments ca2
      WHERE ca2.user_id    = ca.user_id
        AND ca2.class_id   = new_c.id
        AND ca2.subject_id IS NOT DISTINCT FROM ca.subject_id
    )
)
UPDATE public.class_assignments ca
SET class_id = am.new_class_id
FROM assignment_moves am
WHERE ca.id = am.assignment_id;

-- -------------------------------------------------------------
-- Diagnostics — log row counts to the migration output so the
-- operator can sanity-check against expected tenant volumes.
-- -------------------------------------------------------------
DO $$
DECLARE
  v_new_groups  INT;
  v_new_classes INT;
  v_students_on_target    INT;
  v_teachers_on_target    INT;
  v_coordinators_on_target INT;
BEGIN
  SELECT COUNT(*) INTO v_new_groups
  FROM public.class_groups
  WHERE academic_year = '2026-27';

  SELECT COUNT(*) INTO v_new_classes
  FROM public.classes
  WHERE academic_year = '2026-27' AND is_active = true;

  SELECT
    COUNT(*) FILTER (WHERE ca.role = 'student'),
    COUNT(*) FILTER (WHERE ca.role = 'teacher'),
    COUNT(*) FILTER (WHERE ca.role = 'coordinator')
  INTO v_students_on_target, v_teachers_on_target, v_coordinators_on_target
  FROM public.class_assignments ca
  JOIN public.classes c ON c.id = ca.class_id
  WHERE c.academic_year = '2026-27';

  RAISE NOTICE 'Rollover 2025-26 → 2026-27 complete:';
  RAISE NOTICE '  class_groups   now in 2026-27: %', v_new_groups;
  RAISE NOTICE '  classes        now in 2026-27: %', v_new_classes;
  RAISE NOTICE '  students       enrolled in 2026-27: %', v_students_on_target;
  RAISE NOTICE '  teachers       assigned in 2026-27: %', v_teachers_on_target;
  RAISE NOTICE '  coordinators   assigned in 2026-27: %', v_coordinators_on_target;
END $$;

COMMIT;
