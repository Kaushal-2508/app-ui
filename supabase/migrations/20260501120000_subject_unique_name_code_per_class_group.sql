-- =============================================================================
-- Enforce unique subject NAME and CODE per class_group
-- =============================================================================
--
-- Problem: useAddInstituteSubject creates a new universal_subjects row per
-- click, so the same class_group can end up with two "Economics (ECON)"
-- rows — each a distinct subject_id, so the existing
-- UNIQUE(institution_id, class_group_id, subject_id) never trips.
--
-- Fix: BEFORE INSERT/UPDATE trigger on the mapping tables that joins to
-- universal_subjects and blocks any row whose normalized name or normalized
-- code collides with an already-mapped active subject in the same
-- class_group / class.
--
-- Normalization:
--   name → TRIM(LOWER(name))           (case/whitespace insensitive)
--   code → NULLIF(TRIM(UPPER(code)),'') (case/whitespace insensitive, empty→NULL)
--
-- Scope:
--   * Only checks ACTIVE subjects (is_active = true). Archived duplicates
--     are ignored so re-creating an archived name works.
--   * Existing duplicate rows are grandfathered — the trigger only fires on
--     NEW inserts/updates. The ops cleanup step happens separately.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Group-level mapping trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_subject_unique_per_class_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_name_norm  TEXT;
  new_code_norm  TEXT;
  conflict_kind  TEXT;
BEGIN
  -- Fetch the normalized name/code of the subject being mapped.
  SELECT TRIM(LOWER(us.name)),
         NULLIF(TRIM(UPPER(COALESCE(us.code, ''))), '')
    INTO new_name_norm, new_code_norm
    FROM public.universal_subjects us
   WHERE us.id = NEW.subject_id;

  IF new_name_norm IS NULL THEN
    -- Subject row missing — let the FK constraint handle it.
    RETURN NEW;
  END IF;

  -- Look for any conflicting ACTIVE subject already mapped to this class_group.
  SELECT CASE
           WHEN TRIM(LOWER(us.name)) = new_name_norm THEN 'name'
           ELSE 'code'
         END
    INTO conflict_kind
    FROM public.subject_class_group_mappings scgm
    JOIN public.universal_subjects us ON us.id = scgm.subject_id
   WHERE scgm.class_group_id = NEW.class_group_id
     AND scgm.subject_id    <> NEW.subject_id
     AND us.is_active        = true
     AND (
           TRIM(LOWER(us.name)) = new_name_norm
           OR (
             new_code_norm IS NOT NULL
             AND NULLIF(TRIM(UPPER(COALESCE(us.code, ''))), '') = new_code_norm
           )
         )
   LIMIT 1;

  IF conflict_kind = 'name' THEN
    RAISE EXCEPTION 'A subject with this name already exists in this class. Use a different name.'
      USING ERRCODE = '23505';
  ELSIF conflict_kind = 'code' THEN
    RAISE EXCEPTION 'A subject with this code already exists in this class. Use a different code.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subject_unique_per_class_group
  ON public.subject_class_group_mappings;

CREATE TRIGGER trg_subject_unique_per_class_group
BEFORE INSERT OR UPDATE OF subject_id, class_group_id
ON public.subject_class_group_mappings
FOR EACH ROW
EXECUTE FUNCTION public.check_subject_unique_per_class_group();


-- -----------------------------------------------------------------------------
-- 2. Section-level mapping trigger
-- -----------------------------------------------------------------------------
-- Covers two paths:
--   (a) Legacy fallback in useAddInstituteSubject for classes whose
--       class_group_id is NULL — writes directly into subject_class_mappings.
--   (b) Any future direct writer. The Phase 2 trigger that fans group
--       mappings out to sections would normally have been blocked already
--       by the group-level trigger above, so this mostly guards direct writes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_subject_unique_per_class()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_name_norm  TEXT;
  new_code_norm  TEXT;
  conflict_kind  TEXT;
BEGIN
  SELECT TRIM(LOWER(us.name)),
         NULLIF(TRIM(UPPER(COALESCE(us.code, ''))), '')
    INTO new_name_norm, new_code_norm
    FROM public.universal_subjects us
   WHERE us.id = NEW.subject_id;

  IF new_name_norm IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT CASE
           WHEN TRIM(LOWER(us.name)) = new_name_norm THEN 'name'
           ELSE 'code'
         END
    INTO conflict_kind
    FROM public.subject_class_mappings scm
    JOIN public.universal_subjects us ON us.id = scm.subject_id
   WHERE scm.class_id     = NEW.class_id
     AND scm.subject_id  <> NEW.subject_id
     AND us.is_active     = true
     AND (
           TRIM(LOWER(us.name)) = new_name_norm
           OR (
             new_code_norm IS NOT NULL
             AND NULLIF(TRIM(UPPER(COALESCE(us.code, ''))), '') = new_code_norm
           )
         )
   LIMIT 1;

  IF conflict_kind = 'name' THEN
    RAISE EXCEPTION 'A subject with this name already exists in this class. Use a different name.'
      USING ERRCODE = '23505';
  ELSIF conflict_kind = 'code' THEN
    RAISE EXCEPTION 'A subject with this code already exists in this class. Use a different code.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subject_unique_per_class
  ON public.subject_class_mappings;

CREATE TRIGGER trg_subject_unique_per_class
BEFORE INSERT OR UPDATE OF subject_id, class_id
ON public.subject_class_mappings
FOR EACH ROW
EXECUTE FUNCTION public.check_subject_unique_per_class();


-- -----------------------------------------------------------------------------
-- 3. Helpful index for the trigger lookup (existing on subject_id is enough,
--    but add a name-normalized index on universal_subjects to keep the
--    per-class scan cheap on large institutions).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_universal_subjects_institution_name_lower
  ON public.universal_subjects (institution_id, LOWER(name))
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_universal_subjects_institution_code_upper
  ON public.universal_subjects (institution_id, UPPER(code))
  WHERE is_active = true AND code IS NOT NULL;
