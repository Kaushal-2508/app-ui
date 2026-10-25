
-- COMPREHENSIVE FIX: Create SECURITY DEFINER functions for RLS policy sub-queries
-- These functions bypass RLS to prevent recursive policy evaluation issues

-- Function to get user's institution (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.get_user_institution_secure(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.profiles WHERE id = _user_id
$$;

-- Function to check if user has any of the task-allowed roles (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.can_create_tasks(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
    AND role IN ('school_admin'::public.app_role, 'coordinator'::public.app_role, 'teacher'::public.app_role)
  )
$$;

-- Drop and recreate the INSERT policy with SECURITY DEFINER functions
DROP POLICY IF EXISTS "Authorized users can create tasks in their institution" ON public.tasks;

CREATE POLICY "Authorized users can create tasks in their institution"
ON public.tasks
FOR INSERT
TO authenticated
WITH CHECK (
  -- Institution must match the user's profile institution
  institution_id = public.get_user_institution_secure(auth.uid())
  AND
  -- User must have one of the allowed roles
  public.can_create_tasks(auth.uid())
);

-- GRANT execute permissions on the new functions
GRANT EXECUTE ON FUNCTION public.get_user_institution_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_tasks(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_institution_secure(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_create_tasks(uuid) TO anon;

-- Fix the user_roles SELECT policy to use SECURITY DEFINER function
-- Drop and recreate the problematic policy
DROP POLICY IF EXISTS "Users can view institution roles" ON public.user_roles;

CREATE POLICY "Users can view institution roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  institution_id = public.get_user_institution_secure(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- Fix the profiles SELECT policy to use SECURITY DEFINER function  
DROP POLICY IF EXISTS "Users can view profiles in same institution" ON public.profiles;

CREATE POLICY "Users can view profiles in same institution"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  institution_id IS NOT NULL 
  AND (
    institution_id = public.get_user_institution_secure(auth.uid())
    OR public.has_super_admin_access(auth.uid())
  )
);

-- Also ensure school admins can view tasks in their institution
DROP POLICY IF EXISTS "School admins can view all tasks in their institution" ON public.tasks;

CREATE POLICY "School admins can view all tasks in their institution"
ON public.tasks
FOR SELECT
TO authenticated
USING (
  public.has_role_at_institution(auth.uid(), 'school_admin'::public.app_role, institution_id)
);

-- Ensure coordinators can also view tasks in their institution
DROP POLICY IF EXISTS "Coordinators can view all tasks in their institution" ON public.tasks;

CREATE POLICY "Coordinators can view all tasks in their institution"
ON public.tasks
FOR SELECT
TO authenticated
USING (
  public.has_role_at_institution(auth.uid(), 'coordinator'::public.app_role, institution_id)
);
