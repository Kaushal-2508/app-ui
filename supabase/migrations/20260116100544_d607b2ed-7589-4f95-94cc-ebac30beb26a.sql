-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Authorized users can create tasks in their institution" ON public.tasks;

-- Recreate with INLINE logic to avoid function resolution issues
-- This directly queries the tables instead of relying on helper functions
CREATE POLICY "Authorized users can create tasks in their institution"
ON public.tasks
FOR INSERT
TO authenticated
WITH CHECK (
  -- Institution must match the user's profile institution
  institution_id = (SELECT institution_id FROM public.profiles WHERE id = auth.uid())
  AND
  -- User must have one of the allowed roles
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('school_admin'::public.app_role, 'coordinator'::public.app_role, 'teacher'::public.app_role)
  )
);