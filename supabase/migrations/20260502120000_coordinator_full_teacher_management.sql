-- Coordinator = full teacher-management authority (institution-wide).
--
-- Product decision (2026-05-02): a coordinator manages the entire teaching
-- staff of their institution — add/edit/delete teachers, assign any class &
-- subject, bulk operations. This replaces the previous wing-scoped behaviour
-- where coordinators could only touch teachers of their assigned wings.
--
-- This migration widens three RLS surfaces from wing-scoped to
-- institution-scoped for coordinators:
--   1. class_assignments — previously SELECT-only for coordinators.
--      Now full CRUD within their institution.
--   2. subject_class_mappings — replace the wing-scoped policies added in
--      20260421120000 with institution-scoped FOR ALL.
--   3. subject_class_group_mappings — replace the wing-scoped policies from
--      20260423120000 with institution-scoped FOR ALL.
--
-- User account deletion / credential updates still go through the
-- admin-operations edge function (service role), which is being updated in
-- the same change-set to accept coordinator callers.

-- ----------------------------------------------------------
-- 1. class_assignments — grant coordinator institution-wide CRUD
-- ----------------------------------------------------------
DROP POLICY IF EXISTS "Coordinators can manage assignments in their institution" ON public.class_assignments;

CREATE POLICY "Coordinators can manage assignments in their institution"
  ON public.class_assignments FOR ALL
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'coordinator')
    AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  );

-- ----------------------------------------------------------
-- 2. subject_class_mappings — replace wing-scoped with institution-scoped
-- ----------------------------------------------------------
DROP POLICY IF EXISTS "coordinator_view_wing_subject_mappings"   ON public.subject_class_mappings;
DROP POLICY IF EXISTS "coordinator_insert_wing_subject_mappings" ON public.subject_class_mappings;
DROP POLICY IF EXISTS "coordinator_update_wing_subject_mappings" ON public.subject_class_mappings;
DROP POLICY IF EXISTS "coordinator_delete_wing_subject_mappings" ON public.subject_class_mappings;
DROP POLICY IF EXISTS "coordinator_manage_subject_mappings"      ON public.subject_class_mappings;

CREATE POLICY "coordinator_manage_subject_mappings"
  ON public.subject_class_mappings FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );

-- ----------------------------------------------------------
-- 3. subject_class_group_mappings — replace wing-scoped with institution-scoped
-- ----------------------------------------------------------
DROP POLICY IF EXISTS "Coordinators view wing-scoped scgm"   ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Coordinators insert wing-scoped scgm" ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Coordinators update wing-scoped scgm" ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Coordinators delete wing-scoped scgm" ON public.subject_class_group_mappings;
DROP POLICY IF EXISTS "Coordinators manage scgm"             ON public.subject_class_group_mappings;

CREATE POLICY "Coordinators manage scgm"
  ON public.subject_class_group_mappings FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );

-- ----------------------------------------------------------
-- 4. profiles — school admins and coordinators can update teacher/student
--    profiles in their institution (full_name, is_active, phone, etc.).
--
--    Before this migration the only UPDATE policies on profiles were
--    "Users can update own profile" and "Super admins can manage all
--    profiles", so EditTeacherDialog's direct profile update silently
--    no-op'd for school admins — and therefore also for coordinators.
--    Making this surface work end-to-end is a prerequisite for the
--    coordinator "full authority over teachers" change.
-- ----------------------------------------------------------
DROP POLICY IF EXISTS "School admins can update institution profiles" ON public.profiles;
CREATE POLICY "School admins can update institution profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

DROP POLICY IF EXISTS "Coordinators can update institution profiles" ON public.profiles;
CREATE POLICY "Coordinators can update institution profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  )
  WITH CHECK (
    institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );
