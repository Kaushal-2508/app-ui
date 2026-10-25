
-- Drop the old SELECT-only policy for coordinators (will be covered by the ALL policy)
DROP POLICY IF EXISTS "Coordinators can view class assignments" ON public.class_assignments;

-- Add full management policy for coordinators, scoped to their wing classes
CREATE POLICY "Coordinators can manage assignments in their wing classes"
ON public.class_assignments
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'coordinator'::app_role)
  AND is_coordinator_for_class(auth.uid(), class_id)
)
WITH CHECK (
  has_role(auth.uid(), 'coordinator'::app_role)
  AND is_coordinator_for_class(auth.uid(), class_id)
);
