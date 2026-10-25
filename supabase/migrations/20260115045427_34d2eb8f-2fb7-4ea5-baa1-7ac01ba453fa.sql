-- Add DELETE policy for super admins on institutions table
CREATE POLICY "Super admins can delete institutions"
ON public.institutions
FOR DELETE
USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Also add INSERT and UPDATE policies for super admins for completeness
CREATE POLICY "Super admins can insert institutions"
ON public.institutions
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Super admins can update institutions"
ON public.institutions
FOR UPDATE
USING (has_role(auth.uid(), 'super_admin'::app_role));