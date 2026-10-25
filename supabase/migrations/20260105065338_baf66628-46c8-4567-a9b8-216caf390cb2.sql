-- Add unique constraint on institution code
ALTER TABLE public.institutions 
ADD CONSTRAINT institutions_code_unique UNIQUE (code);

-- Add index on institution code for fast lookups
CREATE INDEX IF NOT EXISTS idx_institutions_code ON public.institutions(code);

-- Add composite unique constraint on user_roles to enforce single role per user per institution
ALTER TABLE public.user_roles 
ADD CONSTRAINT user_roles_single_role_per_institution UNIQUE (user_id, institution_id);

-- Add index on profiles.institution_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_institution_id ON public.profiles(institution_id);

-- Add index on user_roles.user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);