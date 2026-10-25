-- =============================================================
-- OPTIONAL SUBJECTS — P0: compulsory/optional classification
-- -------------------------------------------------------------
-- Adds a per-class `is_optional` flag to the subject↔class mapping
-- so a subject can be COMPULSORY (default, every section student
-- takes it) or OPTIONAL (students enroll individually — Phase 1+).
--
-- Canonical flag lives on the GROUP authoring table
-- (`subject_class_group_mappings`); the existing SECURITY DEFINER
-- fanout trigger materialises it down to the SECTION runtime table
-- (`subject_class_mappings`), preserving the §22 dual-table
-- invariant. Both columns DEFAULT false → ZERO behavioural change
-- until a subject is explicitly marked optional.
--
-- All subject_id columns are universal_subjects.id (id-space was
-- unified Jan–May 2026). Additive + reversible.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Classification columns (default compulsory)
-- -------------------------------------------------------------
ALTER TABLE public.subject_class_group_mappings
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;

ALTER TABLE public.subject_class_mappings
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subject_class_group_mappings.is_optional IS
  'Compulsory (false, default) vs optional (true) for THIS class group. Fanned out to subject_class_mappings.is_optional by trigger.';
COMMENT ON COLUMN public.subject_class_mappings.is_optional IS
  'Mirror of subject_class_group_mappings.is_optional — written ONLY by the fanout / inherit triggers. Do not write directly from admin surfaces.';

-- -------------------------------------------------------------
-- 2. Fanout trigger — propagate is_optional to section rows.
--    Preserves every existing branch verbatim; adds:
--      * is_optional carried on INSERT + key-change reinsert,
--      * a NEW pure-flip branch (is_optional changed, key same)
--        that UPDATEs child rows in place — no delete/reinsert,
--        so rows referenced by tt_slots etc. are preserved.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fanout_subject_class_group_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.subject_class_mappings (institution_id, class_id, subject_id, is_optional)
    SELECT NEW.institution_id, c.id, NEW.subject_id, NEW.is_optional
    FROM public.classes c
    WHERE c.class_group_id = NEW.class_group_id
      AND NOT EXISTS (
        SELECT 1 FROM public.subject_class_mappings scm
        WHERE scm.class_id = c.id
          AND scm.subject_id = NEW.subject_id
      );
    -- Sync the flag onto any pre-existing (legacy) section rows.
    UPDATE public.subject_class_mappings scm
      SET is_optional = NEW.is_optional
    FROM public.classes c
    WHERE c.id = scm.class_id
      AND c.class_group_id = NEW.class_group_id
      AND scm.subject_id = NEW.subject_id
      AND scm.is_optional IS DISTINCT FROM NEW.is_optional;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.subject_class_mappings scm
    USING public.classes c
    WHERE c.id = scm.class_id
      AND c.class_group_id = OLD.class_group_id
      AND scm.subject_id = OLD.subject_id;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Subject / group / institution changed: tear down old rows, rebuild new.
    IF NEW.subject_id     IS DISTINCT FROM OLD.subject_id
       OR NEW.class_group_id IS DISTINCT FROM OLD.class_group_id
       OR NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN

      DELETE FROM public.subject_class_mappings scm
      USING public.classes c
      WHERE c.id = scm.class_id
        AND c.class_group_id = OLD.class_group_id
        AND scm.subject_id = OLD.subject_id;

      INSERT INTO public.subject_class_mappings (institution_id, class_id, subject_id, is_optional)
      SELECT NEW.institution_id, c.id, NEW.subject_id, NEW.is_optional
      FROM public.classes c
      WHERE c.class_group_id = NEW.class_group_id
        AND NOT EXISTS (
          SELECT 1 FROM public.subject_class_mappings scm
          WHERE scm.class_id = c.id
            AND scm.subject_id = NEW.subject_id
        );

    -- Pure is_optional flip (no key change): update child rows in place.
    ELSIF NEW.is_optional IS DISTINCT FROM OLD.is_optional THEN
      UPDATE public.subject_class_mappings scm
        SET is_optional = NEW.is_optional
      FROM public.classes c
      WHERE c.id = scm.class_id
        AND c.class_group_id = NEW.class_group_id
        AND scm.subject_id = NEW.subject_id
        AND scm.is_optional IS DISTINCT FROM NEW.is_optional;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- -------------------------------------------------------------
-- 3. Inherit-on-new-section trigger — a new section under an
--    existing class group inherits the optional classification.
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

  INSERT INTO public.subject_class_mappings (institution_id, class_id, subject_id, is_optional)
  SELECT scgm.institution_id, NEW.id, scgm.subject_id, scgm.is_optional
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

-- (Triggers themselves are unchanged — they already reference these
--  functions by name; CREATE OR REPLACE above is sufficient.)

-- -------------------------------------------------------------
-- 4. Post-migration sanity: every group row's is_optional must
--    match its fanned-out section rows. Warns loudly on drift.
-- -------------------------------------------------------------
DO $$
DECLARE
  drift_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO drift_count
  FROM public.subject_class_group_mappings scgm
  JOIN public.classes c ON c.class_group_id = scgm.class_group_id
  JOIN public.subject_class_mappings scm
    ON scm.class_id   = c.id
   AND scm.subject_id = scgm.subject_id
  WHERE scm.is_optional IS DISTINCT FROM scgm.is_optional;

  IF drift_count > 0 THEN
    RAISE WARNING 'is_optional drift: % section rows disagree with their group row (expected 0 right after this additive migration)', drift_count;
  END IF;
END;
$$;
