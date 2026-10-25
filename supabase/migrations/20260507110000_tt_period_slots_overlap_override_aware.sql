-- =============================================================
-- tt_period_slots — overlap trigger with override-beats-defaults
--
-- The previous trigger in 20260507100000 flagged any two rows whose
-- raw day-sets intersected as conflicting. That misses the app
-- semantic: "if a day has any override row, default rows (days=NULL)
-- DON'T apply on that day." Result: saving a Saturday override that
-- shared a time with a default ("Assembly 08:00-08:30") raised
-- 23P01 even though the default was supposed to be skipped on Sat.
--
-- The fix is to compute each slot's *effective* days before checking
-- overlap. Default rows: working_days MINUS days that have at least
-- one override in this structure (NEW included). Override rows:
-- their explicit `days` array. Two rows conflict only when their
-- effective day-sets share a day and their time ranges overlap.
-- =============================================================

CREATE OR REPLACE FUNCTION public.tt_prevent_overlapping_period_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_id              UUID := COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_working_days        TEXT[];
  v_overridden_days     TEXT[];
  v_new_eff_days        TEXT[];
  v_other_eff_days      TEXT[];
  v_other               RECORD;
BEGIN
  SELECT working_days INTO v_working_days
  FROM public.tt_period_structures
  WHERE id = NEW.structure_id;

  -- Days that have at least one override in this structure. Includes
  -- NEW.days if NEW is itself an override row, so a freshly-inserted
  -- Saturday override correctly displaces existing defaults on Saturday.
  SELECT COALESCE(array_agg(DISTINCT d), ARRAY[]::TEXT[])
    INTO v_overridden_days
  FROM (
    SELECT unnest(s.days) AS d
    FROM public.tt_period_slots s
    WHERE s.structure_id = NEW.structure_id
      AND s.days IS NOT NULL
      AND s.id <> v_new_id
    UNION
    SELECT unnest(NEW.days) AS d WHERE NEW.days IS NOT NULL
  ) sub;

  -- Effective days for NEW.
  IF NEW.days IS NOT NULL THEN
    v_new_eff_days := NEW.days;
  ELSE
    SELECT COALESCE(array_agg(d), ARRAY[]::TEXT[]) INTO v_new_eff_days
    FROM unnest(v_working_days) AS d
    WHERE d <> ALL(v_overridden_days);
  END IF;

  -- Walk every other row in the same structure and check effective-day
  -- intersection × time overlap.
  FOR v_other IN
    SELECT s.id, s.days, s.start_time, s.end_time
    FROM public.tt_period_slots s
    WHERE s.structure_id = NEW.structure_id
      AND s.id <> v_new_id
  LOOP
    IF v_other.days IS NOT NULL THEN
      v_other_eff_days := v_other.days;
    ELSE
      SELECT COALESCE(array_agg(d), ARRAY[]::TEXT[]) INTO v_other_eff_days
      FROM unnest(v_working_days) AS d
      WHERE d <> ALL(v_overridden_days);
    END IF;

    IF (v_new_eff_days && v_other_eff_days)
       AND tsrange(
             ('2000-01-01 ' || v_other.start_time)::timestamp,
             ('2000-01-01 ' || v_other.end_time)::timestamp,
             '()'
           )
        && tsrange(
             ('2000-01-01 ' || NEW.start_time)::timestamp,
             ('2000-01-01 ' || NEW.end_time)::timestamp,
             '()'
           )
    THEN
      RAISE EXCEPTION 'Period slot times overlap with another slot on the same day(s)'
        USING ERRCODE = '23P01';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
