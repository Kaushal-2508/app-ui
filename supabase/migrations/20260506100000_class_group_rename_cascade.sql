-- Class group rename cascade + widen classes UPDATE for super_school_admin + coordinator
-- ----------------------------------------------------------------------------
-- 1. AFTER UPDATE OF name trigger mirrors class_groups.name into every child
--    classes row in the same transaction. Without this, the denormalized
--    classes.name column drifts the moment anyone renames the parent group.
-- 2. Backfill heals any drift from prior super-admin renames.
-- 3. RLS widening: today only super_admin (FOR ALL) and school_admin
--    (FOR UPDATE) can UPDATE classes. super_school_admin and coordinator
--    cannot, which blocks them from renaming a section on the school page.
--    This migration adds super_school_admin to the existing school admin
--    policy and adds a new wing-scoped coordinator UPDATE policy.

BEGIN;

-- 1. Trigger function
CREATE OR REPLACE FUNCTION public.sync_classes_name_from_class_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes
       SET name = NEW.name,
           updated_at = NOW()
     WHERE class_group_id = NEW.id
       AND name <> NEW.name;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Trigger
DROP TRIGGER IF EXISTS trg_sync_classes_name ON public.class_groups;
CREATE TRIGGER trg_sync_classes_name
AFTER UPDATE OF name ON public.class_groups
FOR EACH ROW
EXECUTE FUNCTION public.sync_classes_name_from_class_group();

-- 3. One-time backfill
UPDATE public.classes c
   SET name = g.name,
       updated_at = NOW()
  FROM public.class_groups g
 WHERE c.class_group_id = g.id
   AND c.name <> g.name;

-- 4. Widen UPDATE on classes: include super_school_admin + wing-scoped coordinator.
--    Replace the school-admin-only policy.
DROP POLICY IF EXISTS "School admins can update institution classes" ON public.classes;
CREATE POLICY "School admins can update institution classes"
  ON public.classes FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

-- 5. New: coordinators may UPDATE classes inside their wing only.
--    Mirrors the wing-scoping used by the existing class_groups policy.
DROP POLICY IF EXISTS "Coordinators can update wing classes" ON public.classes;
CREATE POLICY "Coordinators can update wing classes"
  ON public.classes FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_assignments wa
      JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
      WHERE wa.user_id = auth.uid()
        AND wcm.class_id = classes.id
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_assignments wa
      JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
      WHERE wa.user_id = auth.uid()
        AND wcm.class_id = classes.id
    )
  );

COMMIT;
