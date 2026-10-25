-- =============================================================
-- COORDINATOR WRITE ACCESS TO class_period_structure
-- -------------------------------------------------------------
-- Before this migration, only school_admin / super_school_admin
-- could attach a period structure to a class. Coordinators hit
-- a dead-end on the Build tab: their wing's classes all read
-- "No period structure assigned" and the only remediation was
-- "ask an admin". For large schools this made the coordinator
-- role effectively non-functional.
--
-- This migration adds wing-scoped INSERT / UPDATE / DELETE
-- policies for coordinators on class_period_structure, mirroring
-- the existing policy pattern on public.timetable_slots
-- (wing_class_mappings × wing_assignments).
--
-- Period structure CREATION (period_structures / period_slots)
-- remains admin-only by design.
-- =============================================================

DROP POLICY IF EXISTS "Coordinators insert class_period_structure"
  ON public.class_period_structure;
DROP POLICY IF EXISTS "Coordinators update class_period_structure"
  ON public.class_period_structure;
DROP POLICY IF EXISTS "Coordinators delete class_period_structure"
  ON public.class_period_structure;

CREATE POLICY "Coordinators insert class_period_structure"
  ON public.class_period_structure FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = class_period_structure.class_id
        AND wa.user_id  = auth.uid()
    )
  );

CREATE POLICY "Coordinators update class_period_structure"
  ON public.class_period_structure FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = class_period_structure.class_id
        AND wa.user_id  = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = class_period_structure.class_id
        AND wa.user_id  = auth.uid()
    )
  );

CREATE POLICY "Coordinators delete class_period_structure"
  ON public.class_period_structure FOR DELETE
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = class_period_structure.class_id
        AND wa.user_id  = auth.uid()
    )
  );
