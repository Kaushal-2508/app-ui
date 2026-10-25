-- =============================================================
-- tt_period_slots — per-day overrides
--
-- Allow a single period structure to carry day-specific schedules
-- (e.g. Saturday runs 8–12 while Mon–Fri run 8–2). Each row gains
-- an optional `days TEXT[]` column:
--   * NULL  → applies to every day in the parent structure's
--             working_days (the existing, default behavior — every
--             pre-existing row is implicitly NULL).
--   * non-NULL → applies ONLY to those weekdays. Read paths must
--             prefer override rows over defaults: a day with any
--             override row uses ONLY override rows for that day.
--
-- Side effects:
--   * Drop UNIQUE(structure_id, period_number) — period_number is
--     now an ordering hint only; per-day override rows can reuse
--     numbers across day-sets without colliding with defaults.
--   * Replace the overlap-check trigger so two rows that don't
--     share any day are never flagged as conflicting.
-- =============================================================

ALTER TABLE public.tt_period_slots
  ADD COLUMN IF NOT EXISTS days TEXT[] NULL;

-- Each entry must be a valid weekday. Empty arrays are forbidden;
-- NULL is the canonical "applies to all days" marker.
ALTER TABLE public.tt_period_slots
  DROP CONSTRAINT IF EXISTS tt_period_slots_days_chk;
ALTER TABLE public.tt_period_slots
  ADD CONSTRAINT tt_period_slots_days_chk CHECK (
    days IS NULL OR (
      array_length(days, 1) >= 1
      AND days <@ ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
    )
  );

-- Per-day overrides reuse period_number across day-sets. The old
-- UNIQUE(structure_id, period_number) blocks that. Drop it; ordering
-- is driven by start_time client-side.
ALTER TABLE public.tt_period_slots
  DROP CONSTRAINT IF EXISTS tt_period_slots_unique_number;

-- -------------------------------------------------------------
-- Overlap guard, day-aware.
--
-- Two slots in the same structure conflict only when their time
-- ranges overlap AND their effective day-sets share at least one
-- weekday. Effective day-set is `slot.days` if non-NULL, otherwise
-- the parent structure's `working_days`.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_prevent_overlapping_period_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_days TEXT[];
BEGIN
  IF NEW.days IS NOT NULL THEN
    new_days := NEW.days;
  ELSE
    SELECT working_days INTO new_days
    FROM public.tt_period_structures
    WHERE id = NEW.structure_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tt_period_slots s
    LEFT JOIN public.tt_period_structures st ON st.id = s.structure_id
    WHERE s.structure_id = NEW.structure_id
      AND s.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tsrange(
            ('2000-01-01 ' || s.start_time)::timestamp,
            ('2000-01-01 ' || s.end_time)::timestamp,
            '()'
          )
       && tsrange(
            ('2000-01-01 ' || NEW.start_time)::timestamp,
            ('2000-01-01 ' || NEW.end_time)::timestamp,
            '()'
          )
      AND (COALESCE(s.days, st.working_days) && new_days)
  ) THEN
    RAISE EXCEPTION 'Period slot times overlap with another slot on the same day(s)'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger binding is unchanged; recreate to ensure it's wired.
DROP TRIGGER IF EXISTS tt_prevent_overlapping_period_slots_tr ON public.tt_period_slots;
CREATE TRIGGER tt_prevent_overlapping_period_slots_tr
  BEFORE INSERT OR UPDATE ON public.tt_period_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.tt_prevent_overlapping_period_slots();
