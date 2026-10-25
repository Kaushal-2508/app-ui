-- =============================================================
-- SUBJECT ↔ CLASS-GROUP MAPPINGS — group-level subject catalog
-- -------------------------------------------------------------
-- Phase 2 of the Class/Section refactor (plan file:
-- C:/Users/tusha/.claude/plans/1st-thing-we-uses-lexical-rain.md).
--
-- Introduces `subject_class_group_mappings` — one row per
-- (institution, class_group, subject). Replaces the per-section
-- authoring UI: admins now toggle "Maths for Class 10" once, and
-- a trigger materialises one `subject_class_mappings` row per
-- section (10A, 10B, 10C) so every RLS policy, hook, and JOIN
-- that already targets `subject_class_mappings` continues to work
-- unchanged (§7 dual-table invariant preserved).
--
-- This is an ADDITIVE, REVERSIBLE migration:
--   * `subject_class_mappings` is kept as-is.
--   * No live row is dropped.
--   * Rollback = remove triggers, drop the view, drop the table.
-- =============================================================

-- -------------------------------------------------------------
-- 1. subject_class_group_mappings
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subject_class_group_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_group_id  UUID NOT NULL REFERENCES public.class_groups(id) ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT uq_scgm_institution_group_subject UNIQUE (institution_id, class_group_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_scgm_institution
  ON public.subject_class_group_mappings(institution_id);

CREATE INDEX IF NOT EXISTS idx_scgm_class_group
  ON public.subject_class_group_mappings(class_group_id);

CREATE INDEX IF NOT EXISTS idx_scgm_subject
  ON public.subject_class_group_mappings(subject_id);

-- -------------------------------------------------------------
-- 2. Backfill from existing per-section mappings
-- -------------------------------------------------------------
INSERT INTO public.subject_class_group_mappings (institution_id, class_group_id, subject_id)
SELECT DISTINCT c.institution_id, c.class_group_id, scm.subject_id
FROM public.subject_class_mappings scm
JOIN public.classes c ON c.id = scm.class_id
WHERE c.class_group_id IS NOT NULL
ON CONFLICT (institution_id, class_group_id, subject_id) DO NOTHING;

-- -------------------------------------------------------------
-- 3. Fanout trigger — group-level writes materialise per-section
--    rows in subject_class_mappings so RLS JOINs in
--    useTeacherAssignedSubjects / useClassSubjects keep working.
--
--    SECURITY DEFINER so writes bypass subject_class_mappings RLS
--    (coordinator with wing access may legitimately trigger this
--    via a group-level INSERT even if they couldn't directly
--    INSERT the child rows themselves).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fanout_subject_class_group_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.subject_class_mappings (institution_id, class_id, subject_id)
    SELECT NEW.institution_id, c.id, NEW.subject_id
    FROM public.classes c
    WHERE c.class_group_id = NEW.class_group_id
      AND NOT EXISTS (
        SELECT 1 FROM public.subject_class_mappings scm
        WHERE scm.class_id = c.id
          AND scm.subject_id = NEW.subject_id
      );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.subject_class_mappings scm
    USING public.classes c
    WHERE c.id = scm.class_id
      AND c.class_group_id = OLD.class_group_id
      AND scm.subject_id = OLD.subject_id;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Subject or group changed: tear down old per-section rows, rebuild new.
    IF NEW.subject_id     IS DISTINCT FROM OLD.subject_id
       OR NEW.class_group_id IS DISTINCT FROM OLD.class_group_id
       OR NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN

      DELETE FROM public.subject_class_mappings scm
      USING public.classes c
      WHERE c.id = scm.class_id
        AND c.class_group_id = OLD.class_group_id
        AND scm.subject_id = OLD.subject_id;

      INSERT INTO public.subject_class_mappings (institution_id, class_id, subject_id)
      SELECT NEW.institution_id, c.id, NEW.subject_id
      FROM public.classes c
      WHERE c.class_group_id = NEW.class_group_id
        AND NOT EXISTS (
          SELECT 1 FROM public.subject_class_mappings scm
          WHERE scm.class_id = c.id
            AND scm.subject_id = NEW.subject_id
        );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS fanout_subject_class_group_mapping_trg
  ON public.subject_class_group_mappings;
CREATE TRIGGER fanout_subject_class_group_mapping_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.subject_class_group_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.fanout_subject_class_group_mapping();

-- -------------------------------------------------------------
-- 4. Inherit-on-new-section trigger — adding section D to an
--    existing Class 10 group must copy down Class 10's subject
--    catalog so the new section doesn't show up empty in the
--    teacher-subject dropdown.
--
--    Runs AFTER INSERT so NEW.class_group_id is already set
--    (either by the caller or by the Phase 1 auto-attach BEFORE
--    INSERT trigger).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inherit_subjects_for_new_section()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.class_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.subject_class_mappings (institution_id, class_id, subject_id)
  SELECT scgm.institution_id, NEW.id, scgm.subject_id
  FROM public.subject_class_group_mappings scgm
  WHERE scgm.class_group_id = NEW.class_group_id
    AND NOT EXISTS (
      SELECT 1 FROM public.subject_class_mappings scm
      WHERE scm.class_id = NEW.id
        AND scm.subject_id = scgm.subject_id
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inherit_subjects_for_new_section_trg ON public.classes;
CREATE TRIGGER inherit_subjects_for_new_section_trg
  AFTER INSERT ON public.classes
  FOR EACH ROW
  EXECUTE FUNCTION public.inherit_subjects_for_new_section();

-- -------------------------------------------------------------
-- 5. RLS — mirrors subject_class_mappings with coordinator gate
--    resolved at the group level (coordinator may manage a group
--    iff they coordinate at least one section in it).
-- -------------------------------------------------------------
ALTER TABLE public.subject_class_group_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage all scgm"                   ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Institution members read scgm"                  ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "School admins manage scgm"                      ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Coordinators view wing-scoped scgm"             ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Coordinators insert wing-scoped scgm"           ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Coordinators update wing-scoped scgm"           ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Coordinators delete wing-scoped scgm"           ON public.subject_class_group_mappings;

CREATE POLICY "Super admins manage all scgm"
  ON public.subject_class_group_mappings FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Institution members read scgm"
  ON public.subject_class_group_mappings FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "School admins manage scgm"
  ON public.subject_class_group_mappings FOR ALL
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

-- Coordinator wing-scoping: they may SELECT/INSERT/UPDATE/DELETE a
-- group row when at least one section of the group sits in one of
-- their assigned wings. Matches the per-section coordinator policy
-- on subject_class_mappings (migration 20260421120000).
CREATE POLICY "Coordinators view wing-scoped scgm"
  ON public.subject_class_group_mappings FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.class_group_id = subject_class_group_mappings.class_group_id
        AND public.is_coordinator_for_class(auth.uid(), c.id)
    )
  );

CREATE POLICY "Coordinators insert wing-scoped scgm"
  ON public.subject_class_group_mappings FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.class_group_id = subject_class_group_mappings.class_group_id
        AND public.is_coordinator_for_class(auth.uid(), c.id)
    )
  );

CREATE POLICY "Coordinators update wing-scoped scgm"
  ON public.subject_class_group_mappings FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.class_group_id = subject_class_group_mappings.class_group_id
        AND public.is_coordinator_for_class(auth.uid(), c.id)
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.class_group_id = subject_class_group_mappings.class_group_id
        AND public.is_coordinator_for_class(auth.uid(), c.id)
    )
  );

CREATE POLICY "Coordinators delete wing-scoped scgm"
  ON public.subject_class_group_mappings FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.class_group_id = subject_class_group_mappings.class_group_id
        AND public.is_coordinator_for_class(auth.uid(), c.id)
    )
  );

-- -------------------------------------------------------------
-- 6. Unified read view — lets callers in the transition period
--    treat group-level and legacy per-section mappings as one
--    surface. Columns:
--      * origin              — 'group' | 'section'
--      * class_group_id      — always populated for group rows,
--                              resolved via classes.class_group_id
--                              for section rows
--      * class_id            — NULL for pure group rows, section
--                              id for fanned-out rows
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_subject_class_mappings_unified AS
SELECT
  'group'::text              AS origin,
  scgm.id                    AS source_id,
  scgm.institution_id,
  scgm.class_group_id,
  NULL::uuid                 AS class_id,
  scgm.subject_id,
  scgm.created_at
FROM public.subject_class_group_mappings scgm
UNION ALL
SELECT
  'section'::text            AS origin,
  scm.id                     AS source_id,
  scm.institution_id,
  c.class_group_id,
  scm.class_id,
  scm.subject_id,
  scm.created_at
FROM public.subject_class_mappings scm
JOIN public.classes c ON c.id = scm.class_id;

GRANT SELECT ON public.v_subject_class_mappings_unified TO authenticated;

-- -------------------------------------------------------------
-- 7. Post-migration sanity: every group-level row has matching
--    per-section rows (one per live section). Warns loudly on a
--    fanout gap so Phase 2 doesn't ship with silent data holes.
-- -------------------------------------------------------------
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO missing_count
  FROM public.subject_class_group_mappings scgm
  JOIN public.classes c ON c.class_group_id = scgm.class_group_id
  LEFT JOIN public.subject_class_mappings scm
    ON scm.class_id    = c.id
   AND scm.subject_id  = scgm.subject_id
  WHERE scm.id IS NULL;

  IF missing_count > 0 THEN
    RAISE WARNING 'Fanout gap: % (section, subject) pairs missing in subject_class_mappings', missing_count;
  END IF;
END;
$$;

COMMENT ON TABLE  public.subject_class_group_mappings IS 'Group-level subject catalog. Writes fan out to subject_class_mappings via trigger. See CLAUDE.md §22.';
COMMENT ON COLUMN public.subject_class_group_mappings.class_group_id IS 'Parent class (Class 10), NOT a section. Fanout materialises one subject_class_mappings row per child section.';
