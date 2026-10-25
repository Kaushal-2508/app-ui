-- Relax hybrid upload-window bounds. Phase 1 lets teachers pick 3–15 min
-- (default 5), but the original hybrid_exam_settings CHECK was BETWEEN 5 AND 120,
-- which would reject 3–4 min on save. Lower the floor to 3; keep the ceiling at
-- 120 so existing rows (e.g. the old default of 30) stay valid.
ALTER TABLE public.hybrid_exam_settings
  DROP CONSTRAINT IF EXISTS hybrid_exam_settings_grace_window_minutes_check;
ALTER TABLE public.hybrid_exam_settings
  ADD CONSTRAINT hybrid_exam_settings_grace_window_minutes_check
  CHECK (grace_window_minutes BETWEEN 3 AND 120);