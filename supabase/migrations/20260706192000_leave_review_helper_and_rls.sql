-- Per-row authorization helper: may this staff user act on a leave for this class?
CREATE OR REPLACE FUNCTION public.can_review_student_leave(
  _user uuid, _class uuid, _institution uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_teacher_for_class(_user, _class)
      OR public.is_coordinator_for_class(_user, _class)
      OR public.is_institution_admin(_user, _institution)
      OR public.is_super_admin(_user);
$$;

-- Replace the institution-wide staff policies with scoped ones.
DROP POLICY IF EXISTS "Teachers and admins can view leave requests in their institution" ON public.leave_requests;
DROP POLICY IF EXISTS "Admins can view all leave requests in institution" ON public.leave_requests;
DROP POLICY IF EXISTS "Teachers and admins can review leave requests" ON public.leave_requests;

-- Scoped SELECT for reviewers (class teacher / wing coordinator / admin / super).
CREATE POLICY "Staff view scoped student leaves"
  ON public.leave_requests FOR SELECT
  USING (public.can_review_student_leave(auth.uid(), class_id, institution_id));

-- No staff UPDATE policy: all decisions flow through review_student_leave (SECURITY
-- DEFINER, bypasses RLS). Student create/view/update-own-pending/delete-own-pending
-- policies from 20260226074822 are left intact.
