-- Fix user_badges: Drop existing policy first and recreate
DROP POLICY IF EXISTS "Users view own badges" ON public.user_badges;
CREATE POLICY "Users view own badges" ON public.user_badges
FOR SELECT USING (user_id = auth.uid());

-- Add insert policy for system/super admin only
DROP POLICY IF EXISTS "System can insert badges" ON public.user_badges;
CREATE POLICY "System can insert badges" ON public.user_badges
FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'super_admin'));