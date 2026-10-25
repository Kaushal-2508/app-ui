-- =============================================================
-- CLASS GROUPS — Parent container above sections
-- -------------------------------------------------------------
-- Historically `classes` is a flat table: "Class 10 A", "Class 10 B",
-- "Class 10 C" are three independent rows. This migration introduces
-- `class_groups` as the parent container (e.g. "Class 10") while
-- keeping `classes` as the per-section physical row.
--
-- This is an ADDITIVE, REVERSIBLE migration:
--   * No existing column is dropped.
--   * No live row is rewritten destructively.
--   * Rollback = DROP TABLE class_groups; ALTER TABLE classes DROP
--     COLUMN class_group_id (after removing the trigger/policy refs).
--
-- Phase 1 of the Class/Section refactor (see plan file in
-- C:/Users/tusha/.claude/plans/1st-thing-we-uses-lexical-rain.md).
-- Zero frontend changes ship in this release; the new table is
-- unreferenced by the app and exists only to be populated.
-- =============================================================

-- -------------------------------------------------------------
-- 1. class_groups
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  grade_level_id  UUID REFERENCES public.grade_levels(id) ON DELETE SET NULL,
  academic_year   TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT class_groups_name_not_blank_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT class_groups_year_not_blank_chk CHECK (length(btrim(academic_year)) > 0),
  CONSTRAINT uq_class_groups_institution_name_year UNIQUE (institution_id, name, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_class_groups_institution
  ON public.class_groups(institution_id);

CREATE INDEX IF NOT EXISTS idx_class_groups_grade_level
  ON public.class_groups(grade_level_id);

DROP TRIGGER IF EXISTS update_class_groups_updated_at ON public.class_groups;
CREATE TRIGGER update_class_groups_updated_at
  BEFORE UPDATE ON public.class_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- 2. classes.class_group_id — nullable during transition
-- -------------------------------------------------------------
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS class_group_id UUID REFERENCES public.class_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_classes_class_group
  ON public.classes(class_group_id);

-- -------------------------------------------------------------
-- 3. Backfill: one class_groups row per distinct (institution, name, year)
--    grade_level_id resolved by the same regex pattern used in the
--    syllabus path (AddSchoolTopicDialog.tsx → /\d+/ on class name).
-- -------------------------------------------------------------
INSERT INTO public.class_groups (institution_id, name, grade_level_id, academic_year, is_active)
SELECT
  c.institution_id,
  c.name,
  (
    SELECT gl.id
    FROM public.grade_levels gl
    WHERE gl.grade_number = NULLIF(substring(c.name FROM '\d+'), '')::integer
    LIMIT 1
  ) AS grade_level_id,
  c.academic_year,
  BOOL_OR(COALESCE(c.is_active, true)) AS is_active
FROM public.classes c
GROUP BY c.institution_id, c.name, c.academic_year
ON CONFLICT (institution_id, name, academic_year) DO NOTHING;

-- -------------------------------------------------------------
-- 4. Link every existing class row to its new group
-- -------------------------------------------------------------
UPDATE public.classes c
SET class_group_id = cg.id
FROM public.class_groups cg
WHERE cg.institution_id = c.institution_id
  AND cg.name = c.name
  AND cg.academic_year = c.academic_year
  AND c.class_group_id IS NULL;

-- -------------------------------------------------------------
-- 5. Auto-attach trigger — any new class row created through the
--    existing admin flow (before Phase 2 UI ships) still ends up
--    attached to the right group. Closes the between-phase gap.
-- -------------------------------------------------------------
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
    SELECT gl.id INTO v_grade_id
    FROM public.grade_levels gl
    WHERE gl.grade_number = NULLIF(substring(NEW.name FROM '\d+'), '')::integer
    LIMIT 1;

    INSERT INTO public.class_groups (institution_id, name, grade_level_id, academic_year, is_active)
    VALUES (NEW.institution_id, NEW.name, v_grade_id, NEW.academic_year, COALESCE(NEW.is_active, true))
    RETURNING id INTO v_group_id;
  END IF;

  NEW.class_group_id := v_group_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_attach_class_to_group_trg ON public.classes;
CREATE TRIGGER auto_attach_class_to_group_trg
  BEFORE INSERT ON public.classes
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_attach_class_to_group();

-- -------------------------------------------------------------
-- 6. RLS — mirrors period_structures pattern, with added coordinator
--    write access gated on wing assignment containing at least one
--    section in the group.
-- -------------------------------------------------------------
ALTER TABLE public.class_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage all class_groups"    ON public.class_groups;
DROP POLICY IF EXISTS "Institution members read class_groups"   ON public.class_groups;
DROP POLICY IF EXISTS "School admins insert class_groups"       ON public.class_groups;
DROP POLICY IF EXISTS "School admins update class_groups"       ON public.class_groups;
DROP POLICY IF EXISTS "School admins delete class_groups"       ON public.class_groups;
DROP POLICY IF EXISTS "Coordinators update own-wing class_groups" ON public.class_groups;

CREATE POLICY "Super admins manage all class_groups"
  ON public.class_groups FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Institution members read class_groups"
  ON public.class_groups FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "School admins insert class_groups"
  ON public.class_groups FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "School admins update class_groups"
  ON public.class_groups FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "School admins delete class_groups"
  ON public.class_groups FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

-- Coordinators may update (e.g., rename, toggle is_active) a class_group
-- only when they manage a wing containing at least one of its sections.
-- Insert/delete stay with school admins — coordinators cannot create or
-- destroy class groups.
CREATE POLICY "Coordinators update own-wing class_groups"
  ON public.class_groups FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1
      FROM public.wing_assignments wa
      JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
      JOIN public.classes c               ON c.id = wcm.class_id
      WHERE wa.user_id = auth.uid()
        AND c.class_group_id = class_groups.id
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1
      FROM public.wing_assignments wa
      JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
      JOIN public.classes c               ON c.id = wcm.class_id
      WHERE wa.user_id = auth.uid()
        AND c.class_group_id = class_groups.id
    )
  );

-- -------------------------------------------------------------
-- 7. Convenience view for nested reads
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_class_groups_with_sections AS
SELECT
  cg.id                   AS class_group_id,
  cg.institution_id,
  cg.name,
  cg.grade_level_id,
  cg.academic_year,
  cg.is_active            AS group_is_active,
  cg.created_at,
  cg.updated_at,
  COALESCE(
    array_agg(c.id ORDER BY c.section NULLS LAST)
      FILTER (WHERE c.id IS NOT NULL),
    ARRAY[]::uuid[]
  ) AS section_ids,
  COALESCE(
    array_agg(c.section ORDER BY c.section NULLS LAST)
      FILTER (WHERE c.id IS NOT NULL),
    ARRAY[]::text[]
  ) AS section_labels,
  COUNT(c.id) AS section_count
FROM public.class_groups cg
LEFT JOIN public.classes c ON c.class_group_id = cg.id
GROUP BY cg.id;

GRANT SELECT ON public.v_class_groups_with_sections TO authenticated;

-- -------------------------------------------------------------
-- 8. Post-migration sanity: ensure every classes row now has a
--    class_group_id. If ANY row is still NULL the migration failed
--    (likely a non-UTF-8 name or a zero-length institution_id) and
--    we want to surface it loudly rather than ship a silent gap.
-- -------------------------------------------------------------
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM public.classes
  WHERE class_group_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % classes rows still have NULL class_group_id', orphan_count;
  END IF;
END;
$$;

COMMENT ON TABLE  public.class_groups         IS 'Parent container above per-section `classes` rows. See CLAUDE.md §22 (to be added in Phase 2).';
COMMENT ON COLUMN public.classes.class_group_id IS 'FK to class_groups. Auto-populated by auto_attach_class_to_group trigger; nullable during Phase 1–3, NOT NULL after Phase 4.';
