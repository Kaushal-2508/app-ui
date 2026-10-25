-- Drop the existing policy
DROP POLICY IF EXISTS "Authorized users can create tasks in their institution" ON public.tasks;

-- Recreate with explicit schema qualification
CREATE POLICY "Authorized users can create tasks in their institution"
ON public.tasks
FOR INSERT
TO authenticated
WITH CHECK (
  (institution_id = public.get_user_institution(auth.uid())) 
  AND (
    public.has_role(auth.uid(), 'school_admin'::public.app_role) 
    OR public.has_role(auth.uid(), 'coordinator'::public.app_role) 
    OR public.has_role(auth.uid(), 'teacher'::public.app_role)
  )
);