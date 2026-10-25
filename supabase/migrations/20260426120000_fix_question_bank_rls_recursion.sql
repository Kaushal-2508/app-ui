-- =============================================================
-- FIX — Infinite recursion in question_bank RLS
-- -------------------------------------------------------------
-- Phase 3 (20260424120000_question_bank_class_group_scope) wired
-- a circular RLS reference between two tables:
--
--   * question_bank SELECT policy inlines
--       EXISTS (SELECT 1 FROM question_bank_section_scope
--               WHERE question_id = question_bank.id)
--     (student branch — "no section scope" check,
--      teacher branch — "class-wide OR in my section" check)
--
--   * question_bank_section_scope SELECT and ALL policies inline
--       EXISTS (SELECT 1 FROM question_bank q
--               WHERE q.id = question_bank_section_scope.question_id
--                 AND q.institution_id = get_user_institution(auth.uid()))
--
-- On `INSERT INTO question_bank ... RETURNING *` (which every
-- Supabase `.insert(...).select()` call emits), Postgres must
-- evaluate the SELECT USING predicate on the new row. Expanding
-- the predicate pulls in question_bank_section_scope RLS, whose
-- predicate pulls in question_bank RLS again → the planner
-- detects the cycle and aborts with 42P17:
--
--   ERROR: infinite recursion detected in policy for relation
--          "question_bank"
--
-- Users see the "Failed to add question" toast with the raw
-- Postgres string surfaced in the Question Bank dialog.
--
-- Fix: replace the cross-table EXISTS subqueries with
-- SECURITY DEFINER helper functions. SD functions run as the
-- function owner (superuser in Supabase migrations), so RLS on
-- the tables they read is skipped and the planner no longer
-- expands the foreign policy. Semantics are preserved 1:1.
--
-- This migration is purely a policy rewrite — no data changes,
-- no schema changes. Safe to run on a live database.
-- =============================================================

-- -------------------------------------------------------------
-- 1. SECURITY DEFINER helpers — callable from RLS predicates,
--    bypass RLS on the tables they read.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.question_has_section_scope(_question_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.question_bank_section_scope
    WHERE question_id = _question_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_in_question_scope(_question_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.question_bank_section_scope s
    JOIN public.class_assignments ca ON ca.class_id = s.class_id
    WHERE s.question_id = _question_id
      AND ca.user_id = _user_id
      AND ca.role = 'teacher'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_question_institution_id(_question_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT institution_id FROM public.question_bank WHERE id = _question_id;
$$;

GRANT EXECUTE ON FUNCTION public.question_has_section_scope(UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_in_question_scope(UUID, UUID)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_question_institution_id(UUID)               TO authenticated;

-- -------------------------------------------------------------
-- 2. question_bank_section_scope — rewrite both recursive
--    policies to use get_question_institution_id() instead of
--    an inline subquery on question_bank.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "Institution members read scope rows"       ON public.question_bank_section_scope;
DROP POLICY IF EXISTS "Staff manage scope rows for own institution" ON public.question_bank_section_scope;

CREATE POLICY "Institution members read scope rows"
  ON public.question_bank_section_scope FOR SELECT
  USING (
    public.get_question_institution_id(question_bank_section_scope.question_id)
      = public.get_user_institution(auth.uid())
  );

CREATE POLICY "Staff manage scope rows for own institution"
  ON public.question_bank_section_scope FOR ALL
  USING (
    public.get_question_institution_id(question_bank_section_scope.question_id)
      = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'coordinator')
      OR public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    public.get_question_institution_id(question_bank_section_scope.question_id)
      = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'coordinator')
      OR public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

-- -------------------------------------------------------------
-- 3. question_bank SELECT policy — rewrite the two recursive
--    EXISTS subqueries to use the helper functions. Everything
--    else (admin/coordinator bypass, student class_assignments
--    check, teacher legacy + scoped branches) is byte-identical.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "Staff view approved questions scoped to their assignments"
  ON public.question_bank;

CREATE POLICY "Staff view approved questions scoped to their assignments"
  ON public.question_bank FOR SELECT
  USING (
    is_approved = TRUE
    AND institution_id = public.get_user_institution(auth.uid())
    AND (
      -- Admins/coordinators see the full institution pool.
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
      OR public.has_role(auth.uid(), 'coordinator')

      -- Students: class-wide rows (no scope) for their class_group only.
      OR (
        public.has_role(auth.uid(), 'student')
        AND class_group_id IS NOT NULL
        AND NOT public.question_has_section_scope(question_bank.id)
        AND EXISTS (
          SELECT 1 FROM public.class_assignments ca
          JOIN public.classes c ON c.id = ca.class_id
          WHERE ca.user_id = auth.uid()
            AND ca.role = 'student'
            AND c.class_group_id = question_bank.class_group_id
        )
      )

      -- Teachers: legacy rows (no class_group_id) stay institution-wide.
      OR (
        public.has_role(auth.uid(), 'teacher')
        AND class_group_id IS NULL
      )

      -- Teachers: scoped rows — teacher must be assigned to the class_group
      -- AND the question is either class-wide or scoped to one of their sections.
      OR (
        public.has_role(auth.uid(), 'teacher')
        AND class_group_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.class_assignments ca
          JOIN public.classes c ON c.id = ca.class_id
          WHERE ca.user_id = auth.uid()
            AND ca.role = 'teacher'
            AND c.class_group_id = question_bank.class_group_id
        )
        AND (
          NOT public.question_has_section_scope(question_bank.id)
          OR public.user_is_in_question_scope(question_bank.id, auth.uid())
        )
      )
    )
  );

COMMENT ON FUNCTION public.question_has_section_scope(UUID) IS
  'RLS helper — true iff question has one or more question_bank_section_scope rows. SECURITY DEFINER to break the question_bank ↔ question_bank_section_scope policy cycle.';

COMMENT ON FUNCTION public.user_is_in_question_scope(UUID, UUID) IS
  'RLS helper — true iff the user (as a teacher) is assigned to at least one of the question_bank_section_scope rows for the given question.';

COMMENT ON FUNCTION public.get_question_institution_id(UUID) IS
  'RLS helper — returns the institution_id of a question without triggering question_bank RLS. Used by question_bank_section_scope policies to gate tenancy without cycling through question_bank policies.';
