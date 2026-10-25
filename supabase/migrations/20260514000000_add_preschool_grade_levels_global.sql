-- Backfill the global grade_levels table with Nursery / LKG / UKG so every
-- institution can use them, not just the Salci National School test seed.
--
-- Background: the original 20260104144332 seed only created Class 3..12 rows.
-- 20260105153748 added Grade 0 (Pre-School) for legacy compatibility.
-- 20260513000000 added Pre Nursery (-4). Nursery (-3), LKG (-2), and UKG (-1)
-- existed only as a side effect of the per-institution test-data seed
-- 20260510100000_seed_salci_national_school_test_data.sql, so any institution
-- that didn't run that seed had no rows for them.
--
-- Symptom this fixes: addSchoolTopic / addStudyMaterial / useCreateClassGroup
-- resolve a class's grade_number from its name (now via
-- extractGradeNumberFromClassName), then SELECT id FROM grade_levels WHERE
-- grade_number = ?. Without the row, the lookup returns null and the user
-- sees "Grade -3 isn't set up yet." for a Nursery class.
--
-- ON CONFLICT (grade_number) DO UPDATE so re-running in any environment is
-- safe and self-healing.

INSERT INTO public.grade_levels (grade_number, grade_name, display_order, is_active)
VALUES
  (-3, 'Nursery', 1, true),
  (-2, 'LKG',     2, true),
  (-1, 'UKG',     3, true)
ON CONFLICT (grade_number) DO UPDATE
  SET grade_name    = EXCLUDED.grade_name,
      display_order = EXCLUDED.display_order,
      is_active     = true;
