-- =============================================================
-- FIX: infinite recursion between tt_slots ↔ tt_substitutions RLS
-- -------------------------------------------------------------
-- Phase 1 shipped with cross-referencing EXISTS subqueries in two
-- policies, forming a planner-detected cycle:
--
--   tt_slots_select_teacher_own      → EXISTS (SELECT FROM tt_substitutions …)
--   tt_substitutions_select          → EXISTS (SELECT FROM tt_slots …)
--   tt_substitutions_admin_or_coord  → EXISTS (SELECT FROM tt_slots …)
--
-- Any SELECT on tt_slots aborts with
--   42P17 infinite recursion detected in policy for relation "tt_slots"
-- which breaks the /school/timetable class list for admins (query
-- is `SELECT class_id, period_slot_id, updated_at FROM tt_slots …`).
--
-- Fix follows the same pattern as migration
--   20260426120000_fix_question_bank_rls_recursion.sql :
-- wrap each cross-table EXISTS in a SECURITY DEFINER helper that
-- bypasses RLS, then rewrite the policies to call the helpers.
-- =============================================================

-- -------------------------------------------------------------
-- Helpers (SECURITY DEFINER so they run with table-owner rights
-- and sidestep RLS on the referenced table).
-- -------------------------------------------------------------

-- Does slot p_slot_id have a substitution row where p_user is the
-- substitute? Used by tt_slots SELECT policy.
CREATE OR REPLACE FUNCTION public.tt_slot_has_substitute_for(
  p_slot_id UUID,
  p_user    UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tt_substitutions sub
    WHERE sub.slot_id = p_slot_id
      AND sub.substitute_teacher_id = p_user
  );
$$;

-- Institution id of a given slot. Used by tt_substitutions SELECT
-- policy — lets us resolve tenancy without re-entering tt_slots RLS.
CREATE OR REPLACE FUNCTION public.tt_slot_institution(p_slot_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.institution_id
  FROM public.tt_slots s
  WHERE s.id = p_slot_id
  LIMIT 1;
$$;

-- Can p_user edit the slot's class? Wraps the existing
-- tt_user_can_edit_class_slots helper with a slot-id lookup so
-- tt_substitutions WRITE policies don't need an EXISTS on tt_slots.
CREATE OR REPLACE FUNCTION public.tt_user_can_edit_slot(
  p_user    UUID,
  p_slot_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.tt_user_can_edit_class_slots(p_user, s.class_id)
  FROM public.tt_slots s
  WHERE s.id = p_slot_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.tt_slot_has_substitute_for(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tt_slot_institution(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.tt_user_can_edit_slot(UUID, UUID)      TO authenticated;

-- -------------------------------------------------------------
-- Rewrite policies to call the helpers instead of inlining the
-- EXISTS on the opposite table.
-- -------------------------------------------------------------

-- tt_slots: teacher sees rows they teach OR cover as substitute.
DROP POLICY IF EXISTS tt_slots_select_teacher_own ON public.tt_slots;
CREATE POLICY tt_slots_select_teacher_own
  ON public.tt_slots FOR SELECT
  USING (
    teacher_id = auth.uid()
    OR public.tt_slot_has_substitute_for(id, auth.uid())
  );

-- tt_substitutions SELECT: same-institution scope OR the acting
-- substitute themselves. Institution resolved via helper.
DROP POLICY IF EXISTS tt_substitutions_select ON public.tt_substitutions;
CREATE POLICY tt_substitutions_select
  ON public.tt_substitutions FOR SELECT
  USING (
    public.tt_slot_institution(slot_id) = public.get_user_institution(auth.uid())
    OR substitute_teacher_id = auth.uid()
  );

-- tt_substitutions ALL (write): admin school-wide or coord-of-wing,
-- resolved by helper.
DROP POLICY IF EXISTS tt_substitutions_admin_or_coord_write ON public.tt_substitutions;
CREATE POLICY tt_substitutions_admin_or_coord_write
  ON public.tt_substitutions FOR ALL
  USING (public.tt_user_can_edit_slot(auth.uid(), slot_id))
  WITH CHECK (public.tt_user_can_edit_slot(auth.uid(), slot_id));
