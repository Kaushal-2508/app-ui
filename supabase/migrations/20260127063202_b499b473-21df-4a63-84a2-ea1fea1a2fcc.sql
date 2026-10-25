-- Drop existing super admin policy first (it already exists)
DROP POLICY IF EXISTS "Super admins can manage all classes" ON public.classes;

-- Recreate super admin policy with full access
CREATE POLICY "Super admins can manage all classes"
  ON public.classes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));