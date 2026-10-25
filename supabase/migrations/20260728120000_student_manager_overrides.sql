-- =============================================================
-- student_manager_overrides — per-user "manage students" grant
-- (2026-07-28). Fourth sibling of tt_manager_overrides,
-- staff_manager_overrides and syllabus_manager_overrides.
--
-- A row gives ONE named user institution-wide student management —
-- roster, enrolment, personal details, optional-subject choices, and
-- (via the edge fn) student account create/delete — WITHOUT changing
-- their role and WITHOUT altering anyone else's access.
--
-- DESIGN NOTES
-- * Where a SECURITY DEFINER helper already gates a surface, this
--   migration appends ONE `OR is_student_manager(...)` branch to that
--   helper rather than adding another permissive policy. Every existing
--   branch is copied verbatim from the live prod definition.
-- * Where an override policy from a sibling grant already exists on a
--   hot table (classes, profiles, class_assignments), the existing
--   policy is WIDENED instead of adding a 3rd/4th permissive policy —
--   each extra policy is another per-row predicate for every user on
--   the busiest tables in the product.
-- * STYLE: bare SECURITY DEFINER calls only, never `(SELECT fn())` —
--   that style armed the 2026-07-25 42P17 recursion trap on
--   class_assignments (see 20260725101500).
--
-- Granting is a prod DATA op (INSERT). Revoke = DELETE the row.
-- =============================================================

-- 1. Override table -------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_manager_overrides (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.student_manager_overrides IS
  'Per-user institution-wide student management grants (roster, enrolment, personal details, optional-subject choices, student account create/delete). A row makes is_student_manager() true for that user within their institution. Managed by super admins via SQL only.';

CREATE INDEX IF NOT EXISTS student_manager_overrides_institution_id_idx
  ON public.student_manager_overrides (institution_id);

ALTER TABLE public.student_manager_overrides ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.student_manager_overrides FROM anon, authenticated;

CREATE POLICY student_manager_overrides_select_own
  ON public.student_manager_overrides
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY student_manager_overrides_select_super_admin
  ON public.student_manager_overrides
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- 2. Helper ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_student_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_manager_overrides o
    WHERE o.user_id = _user_id
      AND o.institution_id = public.get_user_institution(_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_student_manager(uuid) TO anon, authenticated, service_role;

-- 3. Extend the existing student-management helpers -------------

-- 3a. student_personal_details INSERT/UPDATE (school-managed contact,
-- guardian and address data). Teachers can already VIEW via
-- can_view_student_details — only the WRITE side needs the branch.
CREATE OR REPLACE FUNCTION public.can_write_student_details(_profile_id uuid, _writer uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin(_writer)
    or (
      exists (
        select 1 from public.profiles stu
         where stu.id = _profile_id
           and stu.institution_id = public.get_user_institution(_writer)
      )
      and (
        public.has_role(_writer, 'school_admin')
        or public.has_role(_writer, 'super_school_admin')
        or public.has_role(_writer, 'coordinator')
        or public.is_student_manager(_writer)   -- per-user override grant
      )
    );
$function$;

-- 3b. student_optional_enrollments (Optional Groups / elective choices).
CREATE OR REPLACE FUNCTION public.can_manage_student_subjects(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_actor)
    OR (
      EXISTS (
        SELECT 1 FROM public.profiles stu
        WHERE stu.id = _student
          AND stu.institution_id = public.get_user_institution(_actor)
      )
      AND (
        public.has_role(_actor, 'school_admin')
        OR public.has_role(_actor, 'super_school_admin')
        OR public.is_student_manager(_actor)     -- per-user override grant
        OR (
          public.has_role(_actor, 'coordinator')
          AND EXISTS (
            SELECT 1 FROM public.class_assignments ca
            WHERE ca.user_id = _student
              AND ca.role = 'student'
              AND public.is_coordinator_for_class(_actor, ca.class_id)
          )
        )
      )
    );
$function$;

-- 4. Widen the existing sibling-grant policies ------------------
-- (rather than adding new permissive policies to hot tables)

-- 4a. classes SELECT — the roster's class filter + assignment dialogs
-- must see every class in the institution.
ALTER POLICY classes_select_staff_manager ON public.classes
  USING (
    (
      public.is_staff_manager(auth.uid())
      OR public.is_syllabus_manager(auth.uid())
      OR public.is_student_manager(auth.uid())
    )
    AND institution_id = public.get_user_institution(auth.uid())
  );

-- 4b. profiles UPDATE — edit a student's name / active status. The app
-- only ever sends full_name + is_active from these surfaces; the
-- institution pin stops a manager moving a profile out of the school.
ALTER POLICY profiles_staff_manager_update ON public.profiles
  USING (
    (
      public.is_staff_manager(auth.uid())
      OR public.is_student_manager(auth.uid())
    )
    AND institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
  )
  WITH CHECK (
    (
      public.is_staff_manager(auth.uid())
      OR public.is_student_manager(auth.uid())
    )
    AND institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
  );

-- 4c. class_assignments — enrol / unenrol students from classes.
-- BARE function calls are mandatory here (42P17 history on this table).
ALTER POLICY class_assignments_staff_manager_write ON public.class_assignments
  USING (
    (
      public.is_staff_manager(auth.uid())
      OR public.is_student_manager(auth.uid())
    )
    AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  )
  WITH CHECK (
    (
      public.is_staff_manager(auth.uid())
      OR public.is_student_manager(auth.uid())
    )
    AND public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  );
