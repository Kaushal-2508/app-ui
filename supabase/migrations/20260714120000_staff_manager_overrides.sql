-- =============================================================
-- staff_manager_overrides — per-user Teacher-management grant
-- (2026-07-14).
--
-- Sibling of tt_manager_overrides (20260710120000). A row here gives
-- ONE named user the "manage teaching staff" rights of the Teachers
-- tab — WITHOUT changing their role and WITHOUT touching any existing
-- policy or any other user.
--
-- SCOPE (deliberately the non-destructive, non-role subset — chosen by
-- the product owner over full admin parity):
--   * view all teachers            (already allowed by existing RLS)
--   * assign / bulk-assign classes & subjects
--   * edit basic details (name, active status)
--   * export teacher data, assign tasks
-- EXPLICITLY NOT granted (no RLS here → stays admin/coordinator-only):
--   * create accounts (Add Teacher / Bulk Upload) — edge fn untouched
--   * delete accounts (Delete Teacher / bulk delete) — edge fn untouched
--   * Make Coordinator (role grant) — writes user_roles/wing_assignments,
--     no override added, so it remains admin-only
--
-- Everything here is strictly ADDITIVE: every new policy evaluates to
-- FALSE for users without a staff_manager_overrides row, so no other
-- user's access changes in any way. Granting is a prod DATA op (INSERT),
-- not part of this migration. Revoke = DELETE the user's row.
-- First grantee: Sanjeev Kumar Aulakh (teacher, Alliance International
-- School) — same user who already holds the timetable-manager grant.
-- =============================================================

-- 1. Override table -------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_manager_overrides (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.staff_manager_overrides IS
  'Per-user "manage teaching staff" grants for the Teachers tab (assign/bulk-assign classes & subjects, edit basic details). A row makes is_staff_manager() true for that user within their institution. Does NOT grant account create/delete or Make Coordinator. Managed by super admins via SQL only.';

-- FK index in the same migration (user_id is covered by the PK).
CREATE INDEX IF NOT EXISTS staff_manager_overrides_institution_id_idx
  ON public.staff_manager_overrides (institution_id);

ALTER TABLE public.staff_manager_overrides ENABLE ROW LEVEL SECURITY;

-- No client-side writes: grants are managed via SQL (service role).
REVOKE INSERT, UPDATE, DELETE ON public.staff_manager_overrides FROM anon, authenticated;

-- A user may read ONLY their own override row (frontend capability check).
CREATE POLICY staff_manager_overrides_select_own
  ON public.staff_manager_overrides
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Super admins can list every grant (admin tooling / audit).
CREATE POLICY staff_manager_overrides_select_super_admin
  ON public.staff_manager_overrides
  FOR SELECT
  USING (public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role));

-- 2. Helper ----------------------------------------------------
-- The institution check guards against a stale grant continuing to
-- apply after a user is moved to a different institution.
CREATE OR REPLACE FUNCTION public.is_staff_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_manager_overrides o
    WHERE o.user_id = _user_id
      AND o.institution_id = public.get_user_institution(_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_staff_manager(uuid) TO anon, authenticated, service_role;

-- 3. Additive override policies --------------------------------
-- OR-combined (permissive) with the existing admin/coordinator
-- policies, which stay untouched. auth.uid() wrapped in a scalar
-- subquery so it evaluates once per statement (initplan), not per row.

-- 3a. class_assignments — assign / bulk-assign / reassign teachers.
-- Institution scoped via get_class_institution() to mirror the
-- coordinator/admin write policies already on this table.
CREATE POLICY class_assignments_staff_manager_write
  ON public.class_assignments
  FOR ALL
  USING (
    (SELECT public.is_staff_manager(auth.uid()))
    AND public.get_class_institution(class_id) = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.is_staff_manager(auth.uid()))
    AND public.get_class_institution(class_id) = (SELECT public.get_user_institution(auth.uid()))
  );

-- 3b. subject_class_group_mappings — the canonical subject-catalog
-- write path (its SECURITY DEFINER trigger fans out to the per-section
-- subject_class_mappings, so that fanout needs no policy). Assigning a
-- teacher to a (class, subject) upserts the mapping here.
CREATE POLICY scgm_staff_manager_write
  ON public.subject_class_group_mappings
  FOR ALL
  USING (
    (SELECT public.is_staff_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.is_staff_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 3c. subject_class_mappings — legacy per-section fallback the assign
-- dialog upserts directly when a class has no class_group (e.g. LKG/UKG
-- where the grade regex didn't resolve). Mirror coordinator ALL rights.
CREATE POLICY scm_staff_manager_write
  ON public.subject_class_mappings
  FOR ALL
  USING (
    (SELECT public.is_staff_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.is_staff_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 3d. profiles UPDATE — "Edit basic details" (full_name, active status).
-- The app only ever sends full_name + is_active from this surface; the
-- WITH CHECK pins the row to the same institution so a manager can never
-- move a profile out of the school. Email/password changes route through
-- the admin-operations edge fn (NOT overridden) and stay admin-only.
CREATE POLICY profiles_staff_manager_update
  ON public.profiles
  FOR UPDATE
  USING (
    (SELECT public.is_staff_manager(auth.uid()))
    AND institution_id IS NOT NULL
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.is_staff_manager(auth.uid()))
    AND institution_id IS NOT NULL
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 3e. classes SELECT — the teacher list's class filter + the assign
-- dialog must see EVERY class in the institution (a plain teacher
-- otherwise only reads assigned classes). Read-only widening, scoped to
-- the grant holder. (Sanjeev also gets this via the timetable grant, but
-- keeping it here makes the staff-manager feature self-contained.)
CREATE POLICY classes_select_staff_manager
  ON public.classes
  FOR SELECT
  USING (
    (SELECT public.is_staff_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );
