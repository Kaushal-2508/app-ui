-- =============================================================
-- SHARED RESOURCES
-- -------------------------------------------------------------
-- School-wide physical rooms that are NOT scoped to a single wing
-- or class (e.g. Science Lab, Computer Lab, Library). The
-- timetable builder's conflict engine consults these rows to make
-- sure the same shared resource is never double-booked across any
-- two classes in the same period on the same day.
--
-- A school may declare several rooms of the same kind (e.g. 2
-- science labs) via the `count` column. Whether individual rooms
-- are addressable separately (Lab #1 vs Lab #2) is the timetable
-- builder's concern — this table just exposes the pool.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.shared_resources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  count          INTEGER NOT NULL DEFAULT 1,
  description    TEXT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT shared_resources_name_not_blank_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT shared_resources_count_chk CHECK (count >= 1),
  CONSTRAINT shared_resources_type_chk CHECK (
    resource_type IN ('lab', 'library', 'computer_room', 'sports_facility', 'other')
  ),
  CONSTRAINT shared_resources_unique_name_per_institution UNIQUE (institution_id, name)
);

CREATE INDEX IF NOT EXISTS idx_shared_resources_institution
  ON public.shared_resources(institution_id);

DROP TRIGGER IF EXISTS update_shared_resources_updated_at ON public.shared_resources;
CREATE TRIGGER update_shared_resources_updated_at
  BEFORE UPDATE ON public.shared_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
ALTER TABLE public.shared_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage all shared_resources"   ON public.shared_resources;
DROP POLICY IF EXISTS "Institution members read shared_resources"  ON public.shared_resources;
DROP POLICY IF EXISTS "School admins insert shared_resources"      ON public.shared_resources;
DROP POLICY IF EXISTS "School admins update shared_resources"      ON public.shared_resources;
DROP POLICY IF EXISTS "School admins delete shared_resources"      ON public.shared_resources;

CREATE POLICY "Super admins manage all shared_resources"
  ON public.shared_resources FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Institution members read shared_resources"
  ON public.shared_resources FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "School admins insert shared_resources"
  ON public.shared_resources FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "School admins update shared_resources"
  ON public.shared_resources FOR UPDATE
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

CREATE POLICY "School admins delete shared_resources"
  ON public.shared_resources FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );
