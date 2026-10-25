-- =============================================================
-- PERIOD STRUCTURES
-- -------------------------------------------------------------
-- Per-institution named period templates (e.g. "Primary Schedule",
-- "Senior Wing Schedule"). Each structure defines working days and
-- an ordered list of time slots (periods + breaks). Classes map
-- 1:1 to a structure via class_period_structure. This data is the
-- grid backbone for the timetable builder — only non-break slots
-- on working days become assignable timetable slots.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.period_structures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  working_days   TEXT[] NOT NULL DEFAULT ARRAY['monday','tuesday','wednesday','thursday','friday','saturday'],
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT period_structures_working_days_chk CHECK (
    working_days <@ ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
    AND array_length(working_days, 1) >= 1
  ),
  CONSTRAINT period_structures_name_not_blank_chk CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_period_structures_institution
  ON public.period_structures(institution_id);

DROP TRIGGER IF EXISTS update_period_structures_updated_at ON public.period_structures;
CREATE TRIGGER update_period_structures_updated_at
  BEFORE UPDATE ON public.period_structures
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- Period slots: ordered rows per structure. is_break=true rows
-- render on the timetable grid but are never assignable.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.period_slots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id   UUID NOT NULL REFERENCES public.period_structures(id) ON DELETE CASCADE,
  period_number  INTEGER NOT NULL,
  label          TEXT NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  is_break       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT period_slots_time_chk   CHECK (end_time > start_time),
  CONSTRAINT period_slots_number_chk CHECK (period_number >= 1),
  CONSTRAINT period_slots_label_chk  CHECK (length(btrim(label)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_period_slots_structure
  ON public.period_slots(structure_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_period_slots_structure_number
  ON public.period_slots(structure_id, period_number);

-- Reject overlapping slots inside the same structure.
CREATE OR REPLACE FUNCTION public.prevent_overlapping_period_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.period_slots ps
    WHERE ps.structure_id = NEW.structure_id
      AND ps.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tsrange(
            ('2000-01-01 ' || ps.start_time)::timestamp,
            ('2000-01-01 ' || ps.end_time)::timestamp,
            '()'
          ) && tsrange(
            ('2000-01-01 ' || NEW.start_time)::timestamp,
            ('2000-01-01 ' || NEW.end_time)::timestamp,
            '()'
          )
  ) THEN
    RAISE EXCEPTION 'Period slot times overlap an existing slot in this structure';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_overlapping_period_slots_trg ON public.period_slots;
CREATE TRIGGER prevent_overlapping_period_slots_trg
  BEFORE INSERT OR UPDATE ON public.period_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_overlapping_period_slots();

-- -------------------------------------------------------------
-- Class ⇒ Structure assignment (1:1). Unique on class_id enforces
-- "one class has exactly one structure".
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_period_structure (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id       UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  structure_id   UUID NOT NULL REFERENCES public.period_structures(id) ON DELETE RESTRICT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT uq_class_period_structure_class UNIQUE (class_id)
);

CREATE INDEX IF NOT EXISTS idx_cps_institution
  ON public.class_period_structure(institution_id);

CREATE INDEX IF NOT EXISTS idx_cps_structure
  ON public.class_period_structure(structure_id);

DROP TRIGGER IF EXISTS update_class_period_structure_updated_at ON public.class_period_structure;
CREATE TRIGGER update_class_period_structure_updated_at
  BEFORE UPDATE ON public.class_period_structure
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
ALTER TABLE public.period_structures       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_slots            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_period_structure  ENABLE ROW LEVEL SECURITY;

-- period_structures --------------------------------------------------
DROP POLICY IF EXISTS "Super admins manage all period_structures"     ON public.period_structures;
DROP POLICY IF EXISTS "Institution members read period_structures"    ON public.period_structures;
DROP POLICY IF EXISTS "School admins insert period_structures"        ON public.period_structures;
DROP POLICY IF EXISTS "School admins update period_structures"        ON public.period_structures;
DROP POLICY IF EXISTS "School admins delete period_structures"        ON public.period_structures;

CREATE POLICY "Super admins manage all period_structures"
  ON public.period_structures FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Institution members read period_structures"
  ON public.period_structures FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "School admins insert period_structures"
  ON public.period_structures FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "School admins update period_structures"
  ON public.period_structures FOR UPDATE
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

CREATE POLICY "School admins delete period_structures"
  ON public.period_structures FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

-- period_slots -------------------------------------------------------
-- Tenant scoping is enforced via the parent structure's institution.
DROP POLICY IF EXISTS "Super admins manage all period_slots"   ON public.period_slots;
DROP POLICY IF EXISTS "Institution members read period_slots"  ON public.period_slots;
DROP POLICY IF EXISTS "School admins insert period_slots"      ON public.period_slots;
DROP POLICY IF EXISTS "School admins update period_slots"      ON public.period_slots;
DROP POLICY IF EXISTS "School admins delete period_slots"      ON public.period_slots;

CREATE POLICY "Super admins manage all period_slots"
  ON public.period_slots FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Institution members read period_slots"
  ON public.period_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.period_structures ps
      WHERE ps.id = period_slots.structure_id
        AND ps.institution_id = public.get_user_institution(auth.uid())
    )
  );

CREATE POLICY "School admins insert period_slots"
  ON public.period_slots FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.period_structures ps
      WHERE ps.id = period_slots.structure_id
        AND ps.institution_id = public.get_user_institution(auth.uid())
    )
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "School admins update period_slots"
  ON public.period_slots FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.period_structures ps
      WHERE ps.id = period_slots.structure_id
        AND ps.institution_id = public.get_user_institution(auth.uid())
    )
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.period_structures ps
      WHERE ps.id = period_slots.structure_id
        AND ps.institution_id = public.get_user_institution(auth.uid())
    )
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "School admins delete period_slots"
  ON public.period_slots FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.period_structures ps
      WHERE ps.id = period_slots.structure_id
        AND ps.institution_id = public.get_user_institution(auth.uid())
    )
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

-- class_period_structure --------------------------------------------
DROP POLICY IF EXISTS "Super admins manage all class_period_structure"   ON public.class_period_structure;
DROP POLICY IF EXISTS "Institution members read class_period_structure"  ON public.class_period_structure;
DROP POLICY IF EXISTS "School admins insert class_period_structure"      ON public.class_period_structure;
DROP POLICY IF EXISTS "School admins update class_period_structure"      ON public.class_period_structure;
DROP POLICY IF EXISTS "School admins delete class_period_structure"      ON public.class_period_structure;

CREATE POLICY "Super admins manage all class_period_structure"
  ON public.class_period_structure FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Institution members read class_period_structure"
  ON public.class_period_structure FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "School admins insert class_period_structure"
  ON public.class_period_structure FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "School admins update class_period_structure"
  ON public.class_period_structure FOR UPDATE
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

CREATE POLICY "School admins delete class_period_structure"
  ON public.class_period_structure FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );
