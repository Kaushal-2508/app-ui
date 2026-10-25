-- =============================================================================
-- Lock in the new subject model:
--   * One class_group per institution-scoped subject (no more multi-class).
--   * Institution-wide unique code (normalized UPPER+TRIM).
--   * No more blank codes on institution-scoped subjects.
--
-- Safety
--   All three constraints are additive. Running this migration after the
--   150000 split + 160000 regen is safe because the data is now clean. If
--   any constraint complains, the migration aborts (transaction rollback)
--   and nothing changes — surface the offending row and fix by hand, then
--   re-run.
-- =============================================================================

-- 1. Institution-wide unique code (partial — excludes global subjects and inactive ones)
DROP INDEX IF EXISTS public.ux_universal_subjects_institution_code;
CREATE UNIQUE INDEX ux_universal_subjects_institution_code
  ON public.universal_subjects (institution_id, UPPER(TRIM(code)))
  WHERE institution_id IS NOT NULL
    AND is_active       = true
    AND code IS NOT NULL
    AND TRIM(code) <> '';


-- 2. Trigger: institution-scoped subject can only be mapped to ONE class_group.
--    Fires on subject_class_group_mappings INSERT. Blocks a second mapping
--    for the same (institution-scoped) subject.
CREATE OR REPLACE FUNCTION public.check_subject_single_class_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inst_id        UUID;
  existing_count INT;
BEGIN
  SELECT institution_id
    INTO inst_id
    FROM public.universal_subjects
   WHERE id = NEW.subject_id;

  -- Global subjects (institution_id IS NULL) may be mapped to many class_groups.
  IF inst_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
    INTO existing_count
    FROM public.subject_class_group_mappings
   WHERE subject_id = NEW.subject_id
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF existing_count > 0 THEN
    RAISE EXCEPTION 'A subject can only be attached to one class. Create a separate subject for the other class.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subject_single_class_group
  ON public.subject_class_group_mappings;

CREATE TRIGGER trg_subject_single_class_group
BEFORE INSERT OR UPDATE OF subject_id
ON public.subject_class_group_mappings
FOR EACH ROW
EXECUTE FUNCTION public.check_subject_single_class_group();


-- 3. Trigger: require a non-blank code on every institution-scoped subject.
--    Institution-scoped subjects without a code break the UI and the
--    upcoming auto-code flow. Global subjects may still have NULL code.
CREATE OR REPLACE FUNCTION public.check_subject_code_required()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.institution_id IS NOT NULL
     AND NEW.is_active   = true
     AND (NEW.code IS NULL OR TRIM(NEW.code) = '') THEN
    RAISE EXCEPTION 'Subject code is required. The system generates it from the subject name — do not leave it blank.'
      USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subject_code_required
  ON public.universal_subjects;

CREATE TRIGGER trg_subject_code_required
BEFORE INSERT OR UPDATE OF code, institution_id, is_active
ON public.universal_subjects
FOR EACH ROW
EXECUTE FUNCTION public.check_subject_code_required();
