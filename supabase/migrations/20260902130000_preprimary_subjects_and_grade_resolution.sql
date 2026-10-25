-- =============================================================
-- PRE-PRIMARY SUBJECTS + CLASS NAME GRADE RESOLUTION
-- -------------------------------------------------------------
-- BUG (super admin, /admin/institutions, "Add Institution", Step 2
-- "Class Structure"): the wizard dead-ends on pre-primary grades.
--
--   * ClassStructureStep.tsx filters the subject picker to
--     universal_subjects rows whose grade_level_id equals the selected
--     grade. Pre Nursery, Nursery and LKG have ZERO global rows, so the
--     picker renders "No subjects configured for this grade level".
--   * InstitutionWizard.tsx canProceed() case 2 requires EVERY selected
--     class to carry at least one subject.
--   * There is no way to create a subject from inside the wizard.
--
-- Net effect: selecting Pre Nursery, Nursery or LKG makes Step 2
-- unresolvable, and the only escape is to uncheck those grades. This
-- migration removes the data gap (Part 1) and fixes the grade resolution
-- that made pre-primary and stream classes land on a NULL or a wrong
-- grade_level_id (Parts 2 to 4).
--
-- VERIFIED STATE BEFORE THIS MIGRATION (live prod, gyymkgohcijeksmrzuyw):
--   Pre Nursery (grade_number -4, 6936a318-7ef0-4ed7-aa38-2a7ed18bd6f4) = 0 global subjects
--   Nursery     (grade_number -3, 3ec09cee-fc99-4b43-8eb9-ffa5569b09dd) = 0 global subjects
--   LKG         (grade_number -2, 0e6e7ea7-36a5-4fc7-88e7-f82c0080da8b) = 0 global subjects
--   UKG         (grade_number -1, 377dd073-7dd7-485a-87de-1dae33305dcf) = 1 (English), CANONICAL
--   UKG         (grade_number  0, d7014306-cfed-476e-a86b-0e719a847879) = 1 (English), STRAY DUPLICATE
-- The grade ids are recorded here for traceability only. Everything below
-- resolves by grade_number, which is stable across environments, and is a
-- no-op where the grade rows are absent.
--
-- TWO TRAPS THIS MIGRATION IS BUILT AROUND:
--   1. universal_subjects uniqueness is enforced by a unique INDEX, not by a
--      table CONSTRAINT:
--        CREATE UNIQUE INDEX universal_subjects_grade_name_unique
--          ON public.universal_subjects (grade_level_id, lower(name));
--      (added by 20260114120252, never dropped, verified live via pg_indexes).
--      It does NOT appear in pg_constraint or
--      information_schema.table_constraints, which is exactly how an earlier
--      pass concluded "there is no unique constraint" and reached for
--      WHERE NOT EXISTS. That guard was wrong twice over: the index is
--      case-INSENSITIVE and institution-AGNOSTIC, so a row differing only in
--      casing, or an institution-scoped row on the same grade, would raise
--      23505 and roll back this whole file. Idempotency therefore uses the
--      real arbiter: ON CONFLICT (grade_level_id, lower(name)) DO NOTHING.
--   2. grade_levels.grade_number is a SEQUENCE number for stream rows, not
--      a grade: "Class 11 Humanities" carries grade_number 13 and
--      "Class 12 Commerce" carries 18. Resolving a stream class by digit
--      regex therefore lands on the WRONG row ("Class 11 Humanities" would
--      resolve to "Class 11 Science - Medical"). Stream rows must be
--      matched by grade_name.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Seed global pre-primary subjects for the three blocked grades
-- -------------------------------------------------------------
-- The seed set is grounded in real usage: pre-primary class_groups across
-- live schools map to English, Hindi, Mathematics, Environmental Studies
-- and General Knowledge / General Awareness. School-specific extras (Music,
-- Dance, Library, Robotics) are institution-scoped and deliberately NOT
-- seeded globally. Categories mirror the existing Class 3 global rows.
-- code stays NULL because every existing global row has a NULL code.
--
-- DISTINCT ON guards against a duplicated grade_levels row for the same
-- grade_number (UKG is duplicated today, so treat it as possible anywhere).
WITH target_grades AS (
  SELECT DISTINCT ON (gl.grade_number)
         gl.id,
         gl.grade_number
  FROM public.grade_levels gl
  WHERE gl.grade_number IN (-4, -3, -2)   -- Pre Nursery, Nursery, LKG
  ORDER BY gl.grade_number, gl.display_order NULLS LAST, gl.id
),
seed AS (
  SELECT * FROM (VALUES
    ('English'::text,          'language'::text, 1::integer),
    ('Hindi',                  'language',       2),
    ('Mathematics',            'core',           3),
    ('Environmental Studies',  'core',           4),
    ('General Knowledge',      'core',           5)
  ) AS s(name, category, display_order)
)
INSERT INTO public.universal_subjects
  (name, code, category, is_active, display_order, grade_level_id, institution_id)
SELECT
  s.name,
  NULL::text,          -- code: NULL for every existing global row
  s.category,
  true,                -- is_active
  s.display_order,
  g.id,
  NULL::uuid           -- institution_id NULL = global row
FROM seed s
CROSS JOIN target_grades g
-- Matches universal_subjects_grade_name_unique exactly: same columns, same
-- lower() expression, same order. Anything already tagged to that grade under
-- that name, in ANY casing and whether global or institution scoped, is left
-- untouched. Never swap this for WHERE NOT EXISTS on (institution_id IS NULL,
-- name): that guard is narrower than the index and re-running the file would
-- raise 23505 and roll back Parts 2 to 4 along with it.
ON CONFLICT (grade_level_id, lower(name)) DO NOTHING;

-- -------------------------------------------------------------
-- 2. Single source of truth for name-to-grade resolution
-- -------------------------------------------------------------
-- Mirrors src/lib/gradeLookup.ts (extractGradeNumberFromClassName). Keep
-- the two in sync: the TS helper drives the frontend, this function drives
-- the DB trigger and the backfill below.
--
-- Canonical pre-primary grade_numbers (migration 20260513000000):
--   Pre Nursery = -4, Nursery = -3, LKG = -2, UKG = -1, legacy Pre-School = 0
--
-- Resolution order, first match wins:
--   1. Pre-primary name map. Runs FIRST on purpose: "UKG" exists twice in
--      grade_levels (grade_number 0 and -1) and the canonical row is -1
--      (3 class_groups, 173 syllabus_topics). Pinning grade_number -1
--      dodges the ambiguity without touching the duplicate row.
--   2. Exact grade_name match. This is what resolves the stream rows,
--      because the institution wizard passes grade_levels.grade_name
--      through verbatim as classes.name and stream grade_numbers are
--      misleading sequence numbers. Tried on the full name first, then on
--      the section-stripped head so "Class 11 Humanities - A" resolves to
--      "Class 11 Humanities" instead of falling through to step 3 and
--      landing on "Class 11 Science - Medical".
--   3. Legacy digit regex on grade_number, for free-form names such as
--      "Class 5 Blue". Unchanged from the original trigger body.
--
-- Every lookup carries a deterministic tie-break (display_order,
-- grade_number, id) so a duplicated grade row can never make the result
-- non-deterministic.
--
-- Section suffix stripping covers hyphen, en dash and em dash, matching the
-- TS split on the same three dashes. The two unicode dashes are folded to an
-- ASCII hyphen with translate(chr(8211), chr(8212)) rather than written into
-- the regex, for two reasons: this repo forbids literal em dashes in source
-- files, and a \u escape inside a regex bracket expression would only fail
-- at runtime if it were ever unsupported. The regex itself stays pure ASCII.
--
-- KNOWN LIMIT, same as gradeLookup.ts: the head is the text before the FIRST
-- dash separator, so a stream name that also carries a section
-- ("Class 12 Science - Medical - A") heads to "Class 12 Science" and misses
-- step 2b. Those names still fall through to the digit fallback, which is
-- the behaviour they have today.
CREATE OR REPLACE FUNCTION public.resolve_grade_level_id_for_class_name(_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH parsed AS (
    SELECT
      btrim(COALESCE(_name, '')) AS full_name,
      btrim(
        regexp_replace(
          -- fold en dash (8211) and em dash (8212) to an ASCII hyphen first
          translate(btrim(COALESCE(_name, '')), chr(8211) || chr(8212), '--'),
          '\s+-\s+.*$',
          ''
        )
      ) AS head
  ),
  keyed AS (
    SELECT
      p.full_name,
      p.head,
      CASE lower(regexp_replace(p.head, '[^a-zA-Z0-9]', '', 'g'))
        WHEN 'prenursery' THEN -4
        WHEN 'nursery'    THEN -3
        WHEN 'lkg'        THEN -2
        WHEN 'ukg'        THEN -1
        ELSE NULL
      END AS pre_primary_grade_number
    FROM parsed p
  )
  SELECT COALESCE(
    -- 1. Pre-primary name map (duplicate-safe, runs before everything else)
    (
      SELECT gl.id
      FROM public.grade_levels gl, keyed k
      WHERE k.pre_primary_grade_number IS NOT NULL
        AND gl.grade_number = k.pre_primary_grade_number
      ORDER BY gl.display_order NULLS LAST, gl.grade_number, gl.id
      LIMIT 1
    ),
    -- 2a. Exact grade_name match on the full name (stream rows land here)
    (
      SELECT gl.id
      FROM public.grade_levels gl, keyed k
      WHERE k.full_name <> ''
        AND gl.grade_name = k.full_name
      ORDER BY gl.display_order NULLS LAST, gl.grade_number, gl.id
      LIMIT 1
    ),
    -- 2b. Exact grade_name match on the section-stripped head
    (
      SELECT gl.id
      FROM public.grade_levels gl, keyed k
      WHERE k.head <> ''
        AND k.head <> k.full_name
        AND gl.grade_name = k.head
      ORDER BY gl.display_order NULLS LAST, gl.grade_number, gl.id
      LIMIT 1
    ),
    -- 3. Legacy digit fallback ("Class 5 Blue")
    (
      SELECT gl.id
      FROM public.grade_levels gl, keyed k
      WHERE gl.grade_number = NULLIF(substring(k.full_name FROM '\d+'), '')::integer
      ORDER BY gl.display_order NULLS LAST, gl.grade_number, gl.id
      LIMIT 1
    )
  );
$$;

COMMENT ON FUNCTION public.resolve_grade_level_id_for_class_name(text) IS
  'Resolves grade_levels.id from a class or class_group name. Order: pre-primary name map (Pre Nursery -4 / Nursery -3 / LKG -2 / UKG -1), exact grade_name match (full name then section-stripped head, this is what resolves stream rows whose grade_number is a sequence number), then the legacy digit regex. Mirror of src/lib/gradeLookup.ts.';

-- Supabase ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new
-- public function, and REVOKE FROM PUBLIC does not strip it. Revoke by name.
REVOKE ALL ON FUNCTION public.resolve_grade_level_id_for_class_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_grade_level_id_for_class_name(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_grade_level_id_for_class_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_grade_level_id_for_class_name(text) TO service_role;

-- -------------------------------------------------------------
-- 3. auto_attach_class_to_group: use the new resolution
-- -------------------------------------------------------------
-- Original body: migration 20260422120000_class_groups_parent.sql lines
-- 96 to 137. Only the grade-resolution SELECT changes. The group lookup,
-- the class_groups INSERT and the NEW.class_group_id assignment are
-- behaviourally identical, and the trigger binding
-- (auto_attach_class_to_group_trg BEFORE INSERT ON public.classes) is left
-- in place, so CREATE OR REPLACE is enough.
--
-- What was broken: the old resolution was
--   WHERE gl.grade_number = NULLIF(substring(NEW.name FROM '\d+'), '')::integer
-- which is digit-only, so Pre Nursery / Nursery / LKG / UKG produced a NULL
-- grade_level_id, and every stream class resolved to the wrong grade level.
CREATE OR REPLACE FUNCTION public.auto_attach_class_to_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id UUID;
  v_grade_id UUID;
BEGIN
  IF NEW.class_group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_group_id
  FROM public.class_groups
  WHERE institution_id = NEW.institution_id
    AND name           = NEW.name
    AND academic_year  = NEW.academic_year
  LIMIT 1;

  IF v_group_id IS NULL THEN
    v_grade_id := public.resolve_grade_level_id_for_class_name(NEW.name);

    INSERT INTO public.class_groups (institution_id, name, grade_level_id, academic_year, is_active)
    VALUES (NEW.institution_id, NEW.name, v_grade_id, NEW.academic_year, COALESCE(NEW.is_active, true))
    RETURNING id INTO v_group_id;
  END IF;

  NEW.class_group_id := v_group_id;
  RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 4. Backfill class_groups rows that never got a grade level
-- -------------------------------------------------------------
-- Intent: rows created through the old digit-only trigger whose names now
-- resolve under the new rules (every pre-primary group, plus any stream
-- group whose name matches a grade_name exactly). Deliberately conservative:
--   * only rows where grade_level_id IS NULL are touched, so a hand-corrected
--     value is never overwritten
--   * rows that still do not resolve are left NULL rather than guessed at
--
-- KNOWN OUTSTANDING, NOT FIXED HERE: class_groups rows that already point at
-- the WRONG stream grade level (created by the digit regex, for example
-- "Class 11 Humanities" pinned to "Class 11 Science - Medical") keep their
-- current value. Repointing them moves syllabus, question-bank and subject
-- scope with them, so that cleanup needs its own migration and its own
-- verification pass.
WITH resolved AS (
  SELECT
    grp.id AS class_group_id,
    public.resolve_grade_level_id_for_class_name(grp.name) AS grade_level_id
  FROM public.class_groups grp
  WHERE grp.grade_level_id IS NULL
)
UPDATE public.class_groups cg
SET grade_level_id = r.grade_level_id
FROM resolved r
WHERE r.class_group_id = cg.id
  AND r.grade_level_id IS NOT NULL
  AND cg.grade_level_id IS NULL;

-- -------------------------------------------------------------
-- 5. Post-migration report (notices only, never fails the migration)
-- -------------------------------------------------------------
-- Non-fatal on purpose: this migration must stay re-runnable and must not
-- blow up on an environment where the pre-primary grade rows are absent.
DO $$
DECLARE
  r                RECORD;
  v_unresolved     INTEGER;
BEGIN
  FOR r IN
    SELECT
      gl.grade_name,
      gl.grade_number,
      (
        SELECT count(*)
        FROM public.universal_subjects us
        WHERE us.institution_id IS NULL
          AND us.grade_level_id = gl.id
      ) AS global_subject_count
    FROM public.grade_levels gl
    WHERE gl.grade_number IN (-4, -3, -2)
    ORDER BY gl.grade_number
  LOOP
    RAISE NOTICE 'pre-primary seed: % (grade_number %) has % global subject row(s)',
      r.grade_name, r.grade_number, r.global_subject_count;

    -- Assert the EXPECTED count, not merely non-zero. The arbiter index is
    -- case-insensitive and institution-agnostic, which is correct, but it also
    -- means a single pre-existing row (an institution-scoped subject on this
    -- grade, or a differently-cased global one) makes DO NOTHING skip that
    -- name. The wizard filters the picker with institution_id IS NULL, so a
    -- skipped global row is exactly the row it needs. A bare "= 0" check would
    -- report "4 global subject row(s)" and stay silent about the missing one.
    IF r.global_subject_count = 0 THEN
      RAISE WARNING 'pre-primary seed: % still has zero global subjects, the institution wizard will still dead-end on it',
        r.grade_name;
    ELSIF r.global_subject_count < 5 THEN
      RAISE WARNING 'pre-primary seed: % has % global subject row(s), expected 5. A same-name row (other casing, or institution scoped) on this grade blocked part of the seed; check universal_subjects for that grade_level_id',
        r.grade_name, r.global_subject_count;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_unresolved
  FROM public.class_groups
  WHERE grade_level_id IS NULL;

  RAISE NOTICE 'class_groups backfill: % row(s) still have a NULL grade_level_id (names that match no grade rule)',
    v_unresolved;
END;
$$;
