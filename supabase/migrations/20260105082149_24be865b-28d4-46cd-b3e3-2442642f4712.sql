-- Add RLS policy to allow users to view roles in their institution
CREATE POLICY "Users can view roles in same institution"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  institution_id = get_user_institution(auth.uid())
);