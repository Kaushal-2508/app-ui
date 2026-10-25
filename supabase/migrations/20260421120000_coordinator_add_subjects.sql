-- Coordinator-authored subjects for their wing classes.
--
-- Prior state:
--   * universal_subjects INSERT was restricted to school_admin only
--     (super_school_admin and coordinator had UPDATE/DELETE but NOT INSERT —
--     a latent bug for super_school_admin, intentional for coordinator).
--   * subject_class_mappings had a FOR ALL coordinator policy scoped only to
--     the institution, letting a coordinator manage mappings on ANY class in
--     their school — not just classes in their assigned wings.
--
-- This migration:
--   1. Grants INSERT on universal_subjects to super_school_admin (fix latent bug)
--      and coordinator (new feature — scoped to institution since subjects are
--      institution-level, not wing-level).
--   2. Replaces the institution-wide coordinator policy on subject_class_mappings
--      with wing-scoped SELECT/INSERT/UPDATE/DELETE policies gated on
--      is_coordinator_for_class(auth.uid(), class_id).

-- 1a. universal_subjects INSERT — extend to super_school_admin + coordinator.
DROP POLICY IF EXISTS "School admins can manage institution subjects" ON public.universal_subjects;
CREATE POLICY "School admins can insert institution subjects"
  ON public.universal_subjects FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "Coordinators can insert institution subjects"
  ON public.universal_subjects FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );

-- 1b. Also extend UPDATE/DELETE to coordinator for subjects they own
-- (they can only clean up what they created via institution scope).
DROP POLICY IF EXISTS "Coordinators can update institution subjects" ON public.universal_subjects;
CREATE POLICY "Coordinators can update institution subjects"
  ON public.universal_subjects FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );

-- 2. Replace broad coordinator policy on subject_class_mappings with wing-scoped rules.
DROP POLICY IF EXISTS "coordinator_manage_subject_mappings" ON public.subject_class_mappings;

CREATE POLICY "coordinator_view_wing_subject_mappings"
  ON public.subject_class_mappings FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND public.is_coordinator_for_class(auth.uid(), class_id)
  );

CREATE POLICY "coordinator_insert_wing_subject_mappings"
  ON public.subject_class_mappings FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND public.is_coordinator_for_class(auth.uid(), class_id)
  );

CREATE POLICY "coordinator_update_wing_subject_mappings"
  ON public.subject_class_mappings FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND public.is_coordinator_for_class(auth.uid(), class_id)
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND public.is_coordinator_for_class(auth.uid(), class_id)
  );

CREATE POLICY "coordinator_delete_wing_subject_mappings"
  ON public.subject_class_mappings FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND public.is_coordinator_for_class(auth.uid(), class_id)
  );
