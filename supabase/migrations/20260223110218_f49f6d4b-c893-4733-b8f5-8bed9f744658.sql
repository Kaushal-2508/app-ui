-- Drop the old restrictive policy that blocks school_admin/super_school_admin rows
DROP POLICY IF EXISTS "School admins can manage roles in their institution" ON public.user_roles;

-- Allow institution admins to manage all roles in their institution EXCEPT super_admin
CREATE POLICY "Institution admins can manage roles in their institution"
ON public.user_roles FOR ALL TO authenticated
USING (
  public.is_institution_admin(auth.uid(), institution_id)
  AND role <> 'super_admin'
)
WITH CHECK (
  public.is_institution_admin(auth.uid(), institution_id)
  AND role <> 'super_admin'
);