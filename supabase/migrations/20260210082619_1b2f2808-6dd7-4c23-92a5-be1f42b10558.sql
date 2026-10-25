-- Drop the old restrictive INSERT policy on user_badges
DROP POLICY IF EXISTS "System can insert badges" ON public.user_badges;

-- Create a new INSERT policy that allows any authenticated user to receive badges
-- The check ensures users can only have badges inserted for themselves OR by super_admins for anyone
CREATE POLICY "Authenticated users can receive badges"
ON public.user_badges
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  OR has_role(auth.uid(), 'super_admin'::app_role)
);