// Severity weights + band cutoffs for the school-admin dashboard's
// "students needing attention" scoring. Mirrors the SQL defaults in
// `dash_score_students` and is passed to `dash_students_attention` as
// `p_weights`, so tuning the dial needs no migration.
export const SEVERITY_WEIGHTS = {
  attendance_gap: 30,
  bottom_quartile: 30,
  dropped_half: 25,
  flag_count: 15,
  min_score: 20,
  band_red: 55,
  band_amber: 35,
} as const;
