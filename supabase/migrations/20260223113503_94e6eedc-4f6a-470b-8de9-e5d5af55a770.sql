
-- Update has_role to treat super_school_admin as also having school_admin powers
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id 
      AND (
        role = _role
        OR (_role = 'school_admin' AND role = 'super_school_admin')
      )
  )
$$;

-- Update has_role_at_institution similarly
CREATE OR REPLACE FUNCTION public.has_role_at_institution(_user_id uuid, _role app_role, _institution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id 
      AND (
        role = _role
        OR (_role = 'school_admin' AND role = 'super_school_admin')
      )
      AND (institution_id = _institution_id OR institution_id IS NULL)
  )
$$;
