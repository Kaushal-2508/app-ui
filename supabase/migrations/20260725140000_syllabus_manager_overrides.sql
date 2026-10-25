-- =============================================================
-- syllabus_manager_overrides — per-user full-syllabus management
-- grant (2026-07-25). Third sibling of tt_manager_overrides
-- (20260710120000) and staff_manager_overrides (20260714120000).
--
-- A row gives ONE named user institution-wide management of the
-- syllabus module — WITHOUT changing their role and WITHOUT touching
-- any existing policy's semantics for anybody else.
--
-- SCOPE: every class + subject in the institution (a plain teacher is
-- otherwise limited to their own assigned class-subject pairs) —
--   * subjects: add / rename / recategorize / delete institute subjects
--     and assign-unassign them from class groups
--   * chapters (syllabus_topics) + topics (chapter_topics): full CRUD
--   * topic_class_mappings: attach chapters to any class group
--   * institution_hidden_topics: hide / unhide global chapters
--   * syllabus_segments ("Parts"): manage for any class group + subject
--   * study materials: already permitted institution-wide for teachers
--
-- STYLE NOTE (learned the hard way on 2026-07-25, see
-- 20260725101500_fix_class_assignments_rls_recursion.sql): every
-- predicate below uses BARE SECURITY DEFINER function calls. Do NOT
-- rewrite these as `(SELECT fn(...))` scalar subqueries — that style
-- is what armed the dormant 42P17 recursion trap on class_assignments.
-- Verified before writing this migration: no policy anywhere in the DB
-- currently contains a `FROM <its own table>` subquery.
--
-- Granting is a prod DATA op (INSERT), not part of this migration.
-- Revoke = DELETE the user's row.
-- =============================================================

-- 1. Override table -------------------------------------------
CREATE TABLE IF NOT EXISTS public.syllabus_manager_overrides (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.syllabus_manager_overrides IS
  'Per-user institution-wide syllabus management grants (subjects, chapters, topics, hidden chapters, segments). A row makes is_syllabus_manager() true for that user within their institution. Managed by super admins via SQL only.';

CREATE INDEX IF NOT EXISTS syllabus_manager_overrides_institution_id_idx
  ON public.syllabus_manager_overrides (institution_id);

ALTER TABLE public.syllabus_manager_overrides ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.syllabus_manager_overrides FROM anon, authenticated;

CREATE POLICY syllabus_manager_overrides_select_own
  ON public.syllabus_manager_overrides
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY syllabus_manager_overrides_select_super_admin
  ON public.syllabus_manager_overrides
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- 2. Helper ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_syllabus_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.syllabus_manager_overrides o
    WHERE o.user_id = _user_id
      AND o.institution_id = public.get_user_institution(_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_syllabus_manager(uuid) TO anon, authenticated, service_role;

-- 3. Additive override policies --------------------------------

-- 3a. Institute subjects (add / rename / recategorize / delete).
-- Global subjects (institution_id IS NULL) are deliberately excluded —
-- they are shared across every school and stay super-admin-only.
CREATE POLICY universal_subjects_syllabus_manager
  ON public.universal_subjects
  FOR ALL
  USING (
    public.is_syllabus_manager(auth.uid())
    AND institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
  )
  WITH CHECK (
    public.is_syllabus_manager(auth.uid())
    AND institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
  );

-- 3b. Chapters. NOTE: the RESTRICTIVE "Exclude hidden chapters per
-- institution" policy still ANDs on top of this — hidden chapters stay
-- hidden for the manager exactly as they are for an admin.
CREATE POLICY syllabus_topics_syllabus_manager
  ON public.syllabus_topics
  FOR ALL
  USING (
    public.is_syllabus_manager(auth.uid())
    AND institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
  )
  WITH CHECK (
    public.is_syllabus_manager(auth.uid())
    AND institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
  );

-- 3c. Topics within chapters (teachers already have INSERT/UPDATE
-- institution-wide; DELETE was admin/coordinator-only until now).
CREATE POLICY chapter_topics_syllabus_manager
  ON public.chapter_topics
  FOR ALL
  USING (
    public.is_syllabus_manager(auth.uid())
    AND institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
  )
  WITH CHECK (
    public.is_syllabus_manager(auth.uid())
    AND institution_id IS NOT NULL
    AND institution_id = public.get_user_institution(auth.uid())
  );

-- 3d. Chapter to class-group attachment. Tenancy resolves through
-- class_groups (this table has no institution_id of its own).
CREATE POLICY topic_class_mappings_syllabus_manager
  ON public.topic_class_mappings
  FOR ALL
  USING (
    public.is_syllabus_manager(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.class_groups cg
      WHERE cg.id = topic_class_mappings.class_group_id
        AND cg.institution_id = public.get_user_institution(auth.uid())
    )
  )
  WITH CHECK (
    public.is_syllabus_manager(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.class_groups cg
      WHERE cg.id = topic_class_mappings.class_group_id
        AND cg.institution_id = public.get_user_institution(auth.uid())
    )
  );

-- 3e. Hide / unhide global chapters for this institution.
CREATE POLICY institution_hidden_topics_syllabus_manager
  ON public.institution_hidden_topics
  FOR ALL
  USING (
    public.is_syllabus_manager(auth.uid())
    AND institution_id = public.get_user_institution(auth.uid())
  )
  WITH CHECK (
    public.is_syllabus_manager(auth.uid())
    AND institution_id = public.get_user_institution(auth.uid())
  );

-- 3f. Syllabus segmentation ("Parts") — enabled for Alliance. Rather
-- than add a 5th policy to syllabus_segments, extend the helper its
-- four policies already call. Body is the live prod definition plus a
-- single OR branch; every existing branch is untouched.
CREATE OR REPLACE FUNCTION public.can_manage_syllabus_segment(_user_id uuid, _class_group_id uuid, _subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN public.has_role(_user_id, 'super_admin') THEN true
      ELSE (
        EXISTS (
          SELECT 1 FROM class_groups cg
          WHERE cg.id = _class_group_id
            AND cg.institution_id = public.get_user_institution(_user_id)
        )
        AND (
          public.has_role(_user_id, 'school_admin')  -- includes super_school_admin
          OR public.is_syllabus_manager(_user_id)    -- per-user override grant
          OR EXISTS (
            SELECT 1 FROM classes c
            WHERE c.class_group_id = _class_group_id
              AND public.is_coordinator_for_class(_user_id, c.id)
          )
          OR EXISTS (
            SELECT 1 FROM class_assignments ca
            JOIN classes c ON c.id = ca.class_id
            WHERE ca.user_id = _user_id
              AND ca.role = 'teacher'
              AND ca.subject_id = _subject_id
              AND c.class_group_id = _class_group_id
          )
        )
      )
    END
$function$;

-- 3g. classes SELECT — the syllabus page must list EVERY class, not
-- just the grantee's assigned ones. Rather than add a third permissive
-- policy to `classes` (one of the hottest tables in the product — each
-- extra policy is another per-row predicate for every user), widen the
-- existing staff-manager one to cover both override capabilities.
ALTER POLICY classes_select_staff_manager ON public.classes
  USING (
    (
      public.is_staff_manager(auth.uid())
      OR public.is_syllabus_manager(auth.uid())
    )
    AND institution_id = public.get_user_institution(auth.uid())
  );
