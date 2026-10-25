-- Add "Pre Nursery" to the global grade_levels table so it appears in
-- the institution-edit "Add New Class" grade dropdown above "Nursery".
--
-- Pattern matches the existing pre-K rows seeded by
-- 20260510100000_seed_salci_national_school_test_data.sql:
--   Nursery: grade_number = -3, display_order = 1
--   LKG:     grade_number = -2, display_order = 2
--   UKG:     grade_number = -1, display_order = 3
-- Pre Nursery sits one slot lower:
--   grade_number = -4 (one less than Nursery; respects UNIQUE(grade_number))
--   display_order = 0 (renders BEFORE Nursery's 1 in the
--                     `.order('display_order')` query the EditInstitutionDialog
--                     uses on `grade_levels`)
--
-- ON CONFLICT (grade_number) DO UPDATE so re-running this migration in any
-- environment (including the dev DB) is safe and self-healing — if a row
-- already exists for grade_number = -4 it gets normalised to the canonical
-- name + display_order + active state.

INSERT INTO public.grade_levels (grade_number, grade_name, display_order, is_active)
VALUES (-4, 'Pre Nursery', 0, true)
ON CONFLICT (grade_number) DO UPDATE
  SET grade_name    = EXCLUDED.grade_name,
      display_order = EXCLUDED.display_order,
      is_active     = true;
