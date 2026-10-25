-- Add admission_number and roll_number columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS admission_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS roll_number VARCHAR(20);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_profiles_admission_number 
ON public.profiles(admission_number);

CREATE INDEX IF NOT EXISTS idx_profiles_roll_number 
ON public.profiles(roll_number);