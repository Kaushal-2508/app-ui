-- 1. Fix super_admin access to user_roles (update existing policy)
DROP POLICY IF EXISTS "Users can view roles in same institution" ON public.user_roles;

CREATE POLICY "Users can view roles in same institution"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  institution_id = get_user_institution(auth.uid())
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR has_super_admin_access(auth.uid())
);

-- 2. Add INSERT policy for user_question_limits (for school admins and super admins)
CREATE POLICY "Admins can insert user limits"
ON public.user_question_limits
FOR INSERT
TO authenticated
WITH CHECK (
  (
    institution_id = get_user_institution(auth.uid())
    AND has_role(auth.uid(), 'school_admin'::app_role)
  )
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR has_super_admin_access(auth.uid())
);

-- 3. Add UPDATE policy for user_question_limits (for school admins and super admins)
CREATE POLICY "Admins can update user limits"
ON public.user_question_limits
FOR UPDATE
TO authenticated
USING (
  (
    institution_id = get_user_institution(auth.uid())
    AND has_role(auth.uid(), 'school_admin'::app_role)
  )
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR has_super_admin_access(auth.uid())
)
WITH CHECK (
  (
    institution_id = get_user_institution(auth.uid())
    AND has_role(auth.uid(), 'school_admin'::app_role)
  )
  OR has_role(auth.uid(), 'super_admin'::app_role)
  OR has_super_admin_access(auth.uid())
);