-- =============================================================
-- tt_manager_overrides — per-user Timetable + Academic Calendar
-- management grants (2026-07-10).
--
-- One-off mechanism: a row in this table gives ONE named user full
-- management rights over the timetable module (period structures,
-- shared resources, class grids, publish, substitutions, lesson
-- plans) and the academic calendar (cal_academic_years, cal_events)
-- WITHIN their own institution — without changing their role.
--
-- Everything in this migration is strictly ADDITIVE:
--   * no existing policy or function branch is modified/removed
--     (tt_user_can_edit_class_slots only gains a new OR branch);
--   * every new policy / helper branch evaluates to FALSE for users
--     not present in tt_manager_overrides, so no other user's access
--     changes in any way.
--
-- Granting is a prod DATA operation (INSERT), deliberately NOT part
-- of this migration. To revoke a grant: DELETE the user's row.
-- First grantee: Sanjeev Kumar Aulakh (teacher, Alliance
-- International School) — full Timetable + Academic Calendar rights.
-- =============================================================

-- 1. Override table -------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_manager_overrides (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tt_manager_overrides IS
  'Per-user full-management grants for the Timetable + Academic Calendar modules. A row here makes tt_is_timetable_manager() true for that user within their institution. Managed by super admins via SQL only.';

-- FK index in the same migration (user_id is covered by the PK).
CREATE INDEX IF NOT EXISTS tt_manager_overrides_institution_id_idx
  ON public.tt_manager_overrides (institution_id);

ALTER TABLE public.tt_manager_overrides ENABLE ROW LEVEL SECURITY;

-- No client-side writes ever: grants are managed via SQL (service
-- role). Belt-and-braces on top of "no INSERT/UPDATE/DELETE policy".
REVOKE INSERT, UPDATE, DELETE ON public.tt_manager_overrides FROM anon, authenticated;

-- A user may read ONLY their own override row (frontend capability check).
CREATE POLICY tt_manager_overrides_select_own
  ON public.tt_manager_overrides
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Super admins can list every grant (admin tooling / audit).
CREATE POLICY tt_manager_overrides_select_super_admin
  ON public.tt_manager_overrides
  FOR SELECT
  USING (public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role));

-- 2. Helper ----------------------------------------------------
-- The institution check guards against a stale grant continuing to
-- apply after a user is moved to a different institution.
CREATE OR REPLACE FUNCTION public.tt_is_timetable_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tt_manager_overrides o
    WHERE o.user_id = _user_id
      AND o.institution_id = public.get_user_institution(_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.tt_is_timetable_manager(uuid) TO anon, authenticated, service_role;

-- 3. Core helper gains the override branch ---------------------
-- Body identical to the live prod definition plus the final OR.
-- This single change fans out to every consumer of the helper:
-- tt_slots writes, tt_lesson_plans admin read/write, tt_substitutions
-- (via tt_user_can_edit_slot), tt_set_publish_status,
-- tt_assign_substitute, tt_lesson_plan_export(_filters),
-- record/delete_syllabus_progress, can_manage_band_slot.
CREATE OR REPLACE FUNCTION public.tt_user_can_edit_class_slots(p_user uuid, p_class uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role(p_user, 'super_admin')
    OR (
      (
        public.has_role(p_user, 'school_admin')
        OR public.has_role(p_user, 'super_school_admin')
      )
      AND EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = p_class
          AND c.institution_id = public.get_user_institution(p_user)
      )
    )
    OR (
      public.has_role(p_user, 'coordinator')
      AND EXISTS (
        SELECT 1
        FROM public.wing_class_mappings wcm
        JOIN public.wing_assignments  wa ON wa.wing_id = wcm.wing_id
        WHERE wcm.class_id = p_class
          AND wa.user_id = p_user
      )
    )
    OR (
      public.tt_is_timetable_manager(p_user)
      AND EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = p_class
          AND c.institution_id = public.get_user_institution(p_user)
      )
    );
$function$;

-- 4. Additive override policies --------------------------------
-- OR-combined (permissive) with the existing admin-only policies,
-- which stay untouched. Helper calls are wrapped in scalar
-- subqueries so they evaluate once per statement, not per row.

-- 4a. Period structures (weekly grid definitions)
CREATE POLICY tt_period_structures_manager_override
  ON public.tt_period_structures
  FOR ALL
  USING (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 4b. Period slots (rows of a structure; tenancy via parent)
CREATE POLICY tt_period_slots_manager_override
  ON public.tt_period_slots
  FOR ALL
  USING (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.tt_period_structures s
      WHERE s.id = tt_period_slots.structure_id
        AND s.institution_id = (SELECT public.get_user_institution(auth.uid()))
    )
  )
  WITH CHECK (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.tt_period_structures s
      WHERE s.id = tt_period_slots.structure_id
        AND s.institution_id = (SELECT public.get_user_institution(auth.uid()))
    )
  );

-- 4c. Class ⇄ structure assignment + publish state
CREATE POLICY tt_class_structure_manager_override
  ON public.tt_class_structure
  FOR ALL
  USING (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 4d. Shared resources (rooms/labs pool)
CREATE POLICY tt_resources_manager_override
  ON public.tt_resources
  FOR ALL
  USING (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 4e. Academic years (calendar first-step setup, AY rollover)
CREATE POLICY cal_academic_years_manager_override
  ON public.cal_academic_years
  FOR ALL
  USING (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 4f. Calendar events (holidays / exam blocks / events)
CREATE POLICY cal_events_manager_override
  ON public.cal_events
  FOR ALL
  USING (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  )
  WITH CHECK (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 4g. tt_slots SELECT — the workspace must show DRAFT grids of every
-- class. Writes need no new policy: tt_slots_admin_or_coord_write
-- already routes through tt_user_can_edit_class_slots (updated above).
CREATE POLICY tt_slots_select_manager_override
  ON public.tt_slots
  FOR SELECT
  USING (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );

-- 4h. classes SELECT — teachers can normally only read their ASSIGNED
-- classes; the timetable class-list home must show every class in the
-- institution. Read-only widening, scoped to the override holder.
CREATE POLICY classes_select_manager_override
  ON public.classes
  FOR SELECT
  USING (
    (SELECT public.tt_is_timetable_manager(auth.uid()))
    AND institution_id = (SELECT public.get_user_institution(auth.uid()))
  );
