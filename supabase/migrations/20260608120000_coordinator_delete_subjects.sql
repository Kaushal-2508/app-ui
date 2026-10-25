-- Grant coordinators DELETE on their own institution's subjects.
--
-- Migration 20260421120000 documented the intent to "extend UPDATE/DELETE to
-- coordinator" but only created the UPDATE policy. This completes it so that a
-- coordinator can permanently delete a school-owned subject from the syllabus
-- page (admins already can via 20260223113730). Institution-scoped, matching the
-- coordinator INSERT/UPDATE policies. Global subjects (institution_id IS NULL)
-- are never matched, so they remain undeletable by schools.
DROP POLICY IF EXISTS "Coordinators can delete institution subjects" ON public.universal_subjects;
CREATE POLICY "Coordinators can delete institution subjects"
  ON public.universal_subjects FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );
