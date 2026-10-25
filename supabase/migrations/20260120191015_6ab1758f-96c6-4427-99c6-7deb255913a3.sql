-- Add unique indexes for phone and admission_number to support multi-identifier login
-- These are partial indexes that only apply when the value is not null/empty

-- Unique index on phone (excluding null/empty values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique 
ON public.profiles (phone) 
WHERE phone IS NOT NULL AND phone != '';

-- Unique index on admission_number (excluding null/empty values)  
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_admission_unique 
ON public.profiles (LOWER(admission_number)) 
WHERE admission_number IS NOT NULL AND admission_number != '';

-- Add regular indexes for fast lookups during login
CREATE INDEX IF NOT EXISTS idx_profiles_phone_lookup 
ON public.profiles (phone) 
WHERE phone IS NOT NULL AND phone != '';

CREATE INDEX IF NOT EXISTS idx_profiles_admission_lookup 
ON public.profiles (LOWER(admission_number)) 
WHERE admission_number IS NOT NULL AND admission_number != '';

-- Add index on email for case-insensitive lookup
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower 
ON public.profiles (LOWER(email)) 
WHERE email IS NOT NULL;