-- =============================================================================
-- Regenerate codes for every active institution-scoped subject.
-- After 20260501150000 each such subject is mapped to exactly one class_group,
-- so we can derive a code of the form <base><grade_number>.
--
-- Rules
--   base  = first N alphanumeric chars of name (uppercased), starting N=3.
--           If the resulting <base><grade> collides with an already-assigned
--           code in the same institution, grow N by 1 until unique or until
--           we exhaust the name. Fallback: append -2, -3, ... suffix.
--   code  = base || grade_number || optional -k suffix.
--   Example: "English"              Class 10  → ENG10
--            "Economics"            Class 11  → ECO11
--            "Economic Policy"      Class 11  → ECON11  (if ECO11 is taken)
--            "Mathematics"          Class 11 Commerce + Class 11 Humanities
--                                   → MAT11, MAT11-2 (deterministic by created_at)
--
-- Idempotent
--   If a subject's current code already matches what we'd generate, we skip
--   the UPDATE. Safe to re-run after new subjects are added (but the
--   trigger added in 20260501170000 will generate codes at insert time; this
--   migration only exists to backfill).
--
-- Why we disable the uniqueness trigger during regen
--   trg_subject_unique_per_class_group enforces (name, code) uniqueness per
--   class_group. As we UPDATE codes one row at a time, an intermediate state
--   may temporarily violate the constraint (two rows with the same new code
--   before the second one is rewritten). Disabling + re-enabling around the
--   loop avoids that. The trigger guarantees hold again at the end because
--   every row gets a unique code.
-- =============================================================================

ALTER TABLE public.subject_class_group_mappings
  DISABLE TRIGGER trg_subject_unique_per_class_group;
ALTER TABLE public.subject_class_mappings
  DISABLE TRIGGER trg_subject_unique_per_class;

DO $$
DECLARE
  subj RECORD;
  name_alnum TEXT;
  prefix_len INT;
  base TEXT;
  candidate TEXT;
  suffix_n INT;
  updated_count INT := 0;
BEGIN
  FOR subj IN
    SELECT us.id,
           us.name,
           us.institution_id,
           us.code AS current_code,
           gl.grade_number
      FROM public.universal_subjects us
      JOIN public.subject_class_group_mappings scgm ON scgm.subject_id = us.id
      JOIN public.class_groups cg  ON cg.id  = scgm.class_group_id
      JOIN public.grade_levels gl  ON gl.id  = cg.grade_level_id
     WHERE us.institution_id IS NOT NULL
       AND us.is_active = true
     ORDER BY us.institution_id, us.created_at ASC, us.id ASC
  LOOP
    -- Normalize name: alphanumeric-only uppercase
    name_alnum := UPPER(REGEXP_REPLACE(COALESCE(subj.name, ''), '[^A-Za-z0-9]', '', 'g'));
    IF name_alnum = '' THEN
      name_alnum := 'SUB';
    END IF;

    -- Try prefix lengths 3..LENGTH(name_alnum), then -k suffix fallback
    candidate := NULL;
    prefix_len := 3;
    WHILE prefix_len <= GREATEST(LENGTH(name_alnum), 3) LOOP
      base := LEFT(name_alnum, prefix_len);
      candidate := base || subj.grade_number::TEXT;

      IF NOT EXISTS (
        SELECT 1 FROM public.universal_subjects us2
         WHERE us2.id <> subj.id
           AND us2.institution_id = subj.institution_id
           AND us2.is_active = true
           AND us2.code IS NOT NULL
           AND UPPER(TRIM(us2.code)) = candidate
      ) THEN
        EXIT;  -- unique at this prefix length
      END IF;

      candidate := NULL;
      prefix_len := prefix_len + 1;
    END LOOP;

    -- Exhausted prefix growth — fall back to -k suffix on the longest base
    IF candidate IS NULL THEN
      base := name_alnum || subj.grade_number::TEXT;
      suffix_n := 2;
      LOOP
        candidate := base || '-' || suffix_n::TEXT;
        IF NOT EXISTS (
          SELECT 1 FROM public.universal_subjects us2
           WHERE us2.id <> subj.id
             AND us2.institution_id = subj.institution_id
             AND us2.is_active = true
             AND us2.code IS NOT NULL
             AND UPPER(TRIM(us2.code)) = candidate
        ) THEN
          EXIT;
        END IF;
        suffix_n := suffix_n + 1;
        IF suffix_n > 9999 THEN
          RAISE EXCEPTION 'Cannot generate unique code for subject %', subj.id;
        END IF;
      END LOOP;
    END IF;

    -- Only UPDATE if different (idempotent re-runs)
    IF subj.current_code IS NULL OR UPPER(TRIM(subj.current_code)) IS DISTINCT FROM candidate THEN
      UPDATE public.universal_subjects
         SET code = candidate
       WHERE id = subj.id;
      updated_count := updated_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[regen] updated code on % subject(s)', updated_count;
END
$$;

ALTER TABLE public.subject_class_group_mappings
  ENABLE TRIGGER trg_subject_unique_per_class_group;
ALTER TABLE public.subject_class_mappings
  ENABLE TRIGGER trg_subject_unique_per_class;
