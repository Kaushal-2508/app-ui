-- Add mascot_dismissed column to profiles table for "don't show again" feature
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mascot_dismissed BOOLEAN DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.mascot_dismissed IS 'If true, user has permanently dismissed the mascot setup dialog';