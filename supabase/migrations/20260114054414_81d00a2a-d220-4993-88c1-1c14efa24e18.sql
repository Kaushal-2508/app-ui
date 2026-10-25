-- Fix Student Visibility for School Admins, Coordinators, and Teachers

-- 1. Add Super Admin SELECT policy for class_assignments
CREATE POLICY "Super admins can view all class assignments"
ON public.class_assignments
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role));

-- 2. Add Teachers SELECT policy for class_assignments (institution-scoped)
CREATE POLICY "Teachers can view assignments in their institution"
ON public.class_assignments
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'teacher'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = class_assignments.class_id
    AND c.institution_id = public.get_user_institution(auth.uid())
  )
);

-- 3. Drop existing coordinator policy and replace with institution-wide access
DROP POLICY IF EXISTS "Coordinators can view assignments in their classes" ON public.class_assignments;

CREATE POLICY "Coordinators can view assignments in their institution"
ON public.class_assignments
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'coordinator'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = class_assignments.class_id
    AND c.institution_id = public.get_user_institution(auth.uid())
  )
);