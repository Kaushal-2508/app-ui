-- Students may no longer edit their own profile.
--
-- DEPLOYMENT ORDER IS LOAD-BEARING. Do NOT apply this until the frontend from
-- 20260831120100's companion commit ("route self-writes through RPCs") is LIVE
-- in production. Applying it against the older deployed bundle, which still
-- writes must_reset_password directly, turns that write into a silent RLS
-- no-op and traps every student on a forced password reset in a loop.
--
-- "Users can update own profile" (20260112130740) is ROLE-BLIND:
-- USING (id = auth.uid()) with no role predicate. DROPPING it to block students
-- would also strip self-edit from TEACHERS and EMPLOYEES, who are covered by no
-- other profiles UPDATE policy. School admins, coordinators, super admins and
-- override-grant holders survive via their own policies. So this REPLACES it.
--
-- The two legitimate self-writes that this policy used to carry now go through
-- clear_password_reset_flag() and mark_onboarding_complete() (20260831120100).
--
-- Also note: MascotSetupDialog.tsx and SalciBuddy.tsx write the caller's own
-- profiles row but are mounted NOWHERE today. They will not break now; they
-- will the day someone remounts them.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (
  id = (SELECT auth.uid())
  AND NOT public.has_role((SELECT auth.uid()), 'student')
)
WITH CHECK (
  id = (SELECT auth.uid())
  AND NOT public.has_role((SELECT auth.uid()), 'student')
);