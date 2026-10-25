-- =============================================================
-- THIN GRADES: GIVE THEM A REAL GLOBAL SUBJECT SET
-- -------------------------------------------------------------
-- Companion to 20260902130000 (pre-primary dead end). That migration fixed the
-- three grades with ZERO global subjects. This one fixes the grades with
-- essentially one, which is not a hard dead end (the wizard's >= 1 subject gate
-- passes) but means a school created through the Add Institution wizard opens
-- with a near-empty catalog and no obvious signal anything is missing.
--
-- VERIFIED STATE BEFORE THIS MIGRATION (live prod, gyymkgohcijeksmrzuyw):
--   Class 1                    = 1 global subject  (English)
--   Class 2                    = 1 global subject  (English)
--   Class 12 Science - Medical = 1 global subject  (Biology)
-- while their neighbours carry curated sets:
--   Class 3                     = 8  (Computer Science, English, English Grammar,
--                                     Environmental Studies, General Knowledge,
--                                     Hindi, Hindi Grammar, Mathematics)
--   Class 11 Science - Medical  = 11 (Biology, Biotechnology, Chemistry, Computer
--                                     Science, English Core, Environmental Science,
--                                     Informatics Practices, Mathematics, Physical
--                                     Education, Physics, Psychology)
--
-- APPROACH: copy the curated set from the directly analogous grade rather than
-- hand-typing a curriculum. Nothing is invented, categories and display_order
-- come across unchanged, and the source sets are the ones the platform already
-- treats as correct for that stage. Cross-checked against real usage: live
-- Class 1 and Class 2 class_groups do teach English, Hindi, Mathematics, EVS, GK
-- and Computer Science, and live Class 12 Science - Medical groups teach Physics,
-- Chemistry, Biology, English and Mathematics.
--
-- IDEMPOTENCY: universal_subjects uniqueness is enforced by a unique INDEX, not a
-- constraint, so it is invisible to pg_constraint:
--   CREATE UNIQUE INDEX universal_subjects_grade_name_unique
--     ON public.universal_subjects (grade_level_id, lower(name));
-- The conflict target below mirrors it exactly. It is case-insensitive and
-- institution-agnostic, so a name already present on the target grade in ANY
-- casing or scope is left untouched (this is what skips the existing English /
-- Biology rows). Do not swap this for WHERE NOT EXISTS on (institution_id IS
-- NULL, name): that guard is narrower than the index and would raise 23505.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Primary grades: Class 1 and Class 2 inherit the Class 3 set
-- -------------------------------------------------------------
WITH source AS (
  SELECT us.name, us.category, us.display_order
  FROM public.universal_subjects us
  JOIN public.grade_levels gl ON gl.id = us.grade_level_id
  WHERE us.institution_id IS NULL
    AND gl.grade_name = 'Class 3'
),
targets AS (
  SELECT DISTINCT ON (gl.grade_name) gl.id
  FROM public.grade_levels gl
  WHERE gl.grade_name IN ('Class 1', 'Class 2')
  ORDER BY gl.grade_name, gl.display_order NULLS LAST, gl.id
)
INSERT INTO public.universal_subjects
  (name, code, category, is_active, display_order, grade_level_id, institution_id)
SELECT s.name, NULL::text, s.category, true, s.display_order, t.id, NULL::uuid
FROM source s CROSS JOIN targets t
ON CONFLICT (grade_level_id, lower(name)) DO NOTHING;

-- -------------------------------------------------------------
-- 2. Class 12 Science - Medical inherits the Class 11 Science - Medical set
-- -------------------------------------------------------------
WITH source AS (
  SELECT us.name, us.category, us.display_order
  FROM public.universal_subjects us
  JOIN public.grade_levels gl ON gl.id = us.grade_level_id
  WHERE us.institution_id IS NULL
    AND gl.grade_name = 'Class 11 Science - Medical'
),
targets AS (
  SELECT DISTINCT ON (gl.grade_name) gl.id
  FROM public.grade_levels gl
  WHERE gl.grade_name = 'Class 12 Science - Medical'
  ORDER BY gl.grade_name, gl.display_order NULLS LAST, gl.id
)
INSERT INTO public.universal_subjects
  (name, code, category, is_active, display_order, grade_level_id, institution_id)
SELECT s.name, NULL::text, s.category, true, s.display_order, t.id, NULL::uuid
FROM source s CROSS JOIN targets t
ON CONFLICT (grade_level_id, lower(name)) DO NOTHING;

-- -------------------------------------------------------------
-- 2b. UKG gets the same pre-primary set as Pre Nursery / Nursery / LKG
-- -------------------------------------------------------------
-- UKG was left with a single global subject by 20260902130000, which seeded only
-- the three grades that had ZERO. It is the same stage as its neighbours and
-- belongs on the same set.
--
-- Targeted by grade_number = -1, NOT by name. "UKG" exists TWICE in grade_levels
-- (grade_number -1 canonical, with 3 class_groups and 173 syllabus_topics, and
-- grade_number 0 stray with neither). -1 is the documented canonical value
-- (migration 20260513000000, mirrored in src/lib/gradeLookup.ts) and is what
-- resolve_grade_level_id_for_class_name returns, so seeding it puts the subjects
-- where every write path will actually look. The stray row is deliberately left
-- alone: its own lone "English" is referenced by 26 subject_class_mappings across
-- 4 live institutions, and universal_subjects.grade_level_id is ON DELETE
-- CASCADE, so removing that grade row would destroy real school data. The wizard
-- side is handled in the frontend instead, where subjectsByGradeName already
-- unions same-named grade rows and dedupes by subject name.
WITH seed AS (
  SELECT * FROM (VALUES
    ('English'::text,          'language'::text, 1::integer),
    ('Hindi',                  'language',       2),
    ('Mathematics',            'core',           3),
    ('Environmental Studies',  'core',           4),
    ('General Knowledge',      'core',           5)
  ) AS s(name, category, display_order)
),
target AS (
  SELECT DISTINCT ON (gl.grade_number) gl.id
  FROM public.grade_levels gl
  WHERE gl.grade_number = -1
  ORDER BY gl.grade_number, gl.display_order NULLS LAST, gl.id
)
INSERT INTO public.universal_subjects
  (name, code, category, is_active, display_order, grade_level_id, institution_id)
SELECT s.name, NULL::text, s.category, true, s.display_order, t.id, NULL::uuid
FROM seed s CROSS JOIN target t
ON CONFLICT (grade_level_id, lower(name)) DO NOTHING;

-- -------------------------------------------------------------
-- 3. Report (notices only, never fails the migration)
-- -------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT gl.grade_name,
           (SELECT count(*) FROM public.universal_subjects us
             WHERE us.institution_id IS NULL AND us.grade_level_id = gl.id) AS global_subject_count
    FROM public.grade_levels gl
    WHERE gl.grade_name IN ('Class 1', 'Class 2', 'Class 12 Science - Medical')
    ORDER BY gl.grade_name
  LOOP
    RAISE NOTICE 'thin grade seed: % now has % global subject row(s)', r.grade_name, r.global_subject_count;
    IF r.global_subject_count <= 1 THEN
      RAISE WARNING 'thin grade seed: % still has only % global subject row(s), the source grade may be missing',
        r.grade_name, r.global_subject_count;
    END IF;
  END LOOP;
END;
$$;
