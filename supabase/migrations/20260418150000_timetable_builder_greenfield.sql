-- =============================================================
-- TIMETABLE BUILDER — GREENFIELD
-- -------------------------------------------------------------
-- Replaces the earlier version/template/lesson-plan timetable
-- module. The new model is simpler and direct-write:
--
--   timetable_slots(
--     institution_id, academic_year, class_id, day,
--     period_slot_id, slot_type, subject_id?, teacher_id?,
--     resource_id?, created_by
--   )
--
-- One row per (class, academic_year, day, period_slot_id).
-- Non-academic slot types (library/sports/arts/assembly/free)
-- leave subject_id NULL; teacher/resource optional for those.
--
-- Conflict detection is handled in the frontend (pure functions
-- in src/lib/timetableConflicts.ts) — no DB RPC.
--
-- Coordinator write access is scoped to classes inside wings
-- they are assigned to (wing_assignments × wing_class_mappings).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Drop every object that belonged to the previous timetable
--    implementation. CASCADE to sweep policies + dependents.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.replace_timetable_slot(UUID, JSONB, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.get_session_state(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_pacing_summary(UUID, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.rollover_session(TEXT, TEXT, UUID) CASCADE;

DROP TABLE IF EXISTS public.timetable_acknowledgements CASCADE;
DROP TABLE IF EXISTS public.admin_conflict_flags       CASCADE;
DROP TABLE IF EXISTS public.lesson_plan_entries        CASCADE;
DROP TABLE IF EXISTS public.topic_pacing_targets       CASCADE;
DROP TABLE IF EXISTS public.timetable_slots            CASCADE;
DROP TABLE IF EXISTS public.timetable_versions         CASCADE;
DROP TABLE IF EXISTS public.teacher_workload_settings  CASCADE;
DROP TABLE IF EXISTS public.calendar_exceptions        CASCADE;
DROP TABLE IF EXISTS public.day_of_week_template_map   CASCADE;
DROP TABLE IF EXISTS public.day_template_slots         CASCADE;
DROP TABLE IF EXISTS public.day_templates              CASCADE;

-- -------------------------------------------------------------
-- 2. Extend class_assignments with teaching_type so the slot
--    assignment panel can filter teachers to theory vs practical
--    for a given class+subject. Nullable: legacy rows default to
--    "theory" via a backfill so existing teachers stay visible
--    on theory slots without manual cleanup.
-- -------------------------------------------------------------
ALTER TABLE public.class_assignments
  ADD COLUMN IF NOT EXISTS teaching_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'class_assignments_teaching_type_chk'
  ) THEN
    ALTER TABLE public.class_assignments
      ADD CONSTRAINT class_assignments_teaching_type_chk
      CHECK (teaching_type IS NULL OR teaching_type IN ('theory','practical'));
  END IF;
END$$;

UPDATE public.class_assignments
   SET teaching_type = 'theory'
 WHERE teaching_type IS NULL
   AND role = 'teacher'
   AND subject_id IS NOT NULL;

-- -------------------------------------------------------------
-- 3. Fresh timetable_slots.
-- -------------------------------------------------------------
CREATE TABLE public.timetable_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id)     ON DELETE CASCADE,
  academic_year   TEXT NOT NULL,
  class_id        UUID NOT NULL REFERENCES public.classes(id)          ON DELETE CASCADE,
  day             TEXT NOT NULL,
  period_slot_id  UUID NOT NULL REFERENCES public.period_slots(id)     ON DELETE CASCADE,
  slot_type       TEXT NOT NULL,
  subject_id      UUID          REFERENCES public.universal_subjects(id) ON DELETE SET NULL,
  teacher_id      UUID          REFERENCES public.profiles(id)         ON DELETE SET NULL,
  resource_id     UUID          REFERENCES public.shared_resources(id) ON DELETE SET NULL,
  created_by      UUID          REFERENCES public.profiles(id)         ON DELETE SET NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  CONSTRAINT timetable_slots_day_chk CHECK (
    day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
  ),
  CONSTRAINT timetable_slots_slot_type_chk CHECK (
    slot_type IN ('theory','practical','library','sports','arts','assembly','free')
  ),
  CONSTRAINT timetable_slots_academic_slot_subject_chk CHECK (
    -- Academic slots must carry a subject; non-academic must NOT.
    (slot_type IN ('theory','practical') AND subject_id IS NOT NULL)
    OR
    (slot_type NOT IN ('theory','practical') AND subject_id IS NULL)
  ),
  CONSTRAINT timetable_slots_unique_class_period UNIQUE (
    class_id, academic_year, day, period_slot_id
  )
);

CREATE INDEX idx_timetable_slots_institution_year
  ON public.timetable_slots(institution_id, academic_year);
CREATE INDEX idx_timetable_slots_teacher_lookup
  ON public.timetable_slots(teacher_id, academic_year, day, period_slot_id)
  WHERE teacher_id IS NOT NULL;
CREATE INDEX idx_timetable_slots_resource_lookup
  ON public.timetable_slots(resource_id, academic_year, day, period_slot_id)
  WHERE resource_id IS NOT NULL;
CREATE INDEX idx_timetable_slots_class_lookup
  ON public.timetable_slots(class_id, academic_year);

DROP TRIGGER IF EXISTS update_timetable_slots_updated_at ON public.timetable_slots;
CREATE TRIGGER update_timetable_slots_updated_at
  BEFORE UPDATE ON public.timetable_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- 4. RLS.
--    - All institution members: SELECT
--    - super_admin, school_admin, super_school_admin: FULL within
--      their institution
--    - coordinator: INSERT / UPDATE / DELETE only for classes
--      inside a wing they are assigned to
-- -------------------------------------------------------------
ALTER TABLE public.timetable_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage all timetable_slots"      ON public.timetable_slots;
DROP POLICY IF EXISTS "Institution members read timetable_slots"     ON public.timetable_slots;
DROP POLICY IF EXISTS "School admins insert timetable_slots"         ON public.timetable_slots;
DROP POLICY IF EXISTS "School admins update timetable_slots"         ON public.timetable_slots;
DROP POLICY IF EXISTS "School admins delete timetable_slots"         ON public.timetable_slots;
DROP POLICY IF EXISTS "Coordinators insert timetable_slots"          ON public.timetable_slots;
DROP POLICY IF EXISTS "Coordinators update timetable_slots"          ON public.timetable_slots;
DROP POLICY IF EXISTS "Coordinators delete timetable_slots"          ON public.timetable_slots;

CREATE POLICY "Super admins manage all timetable_slots"
  ON public.timetable_slots FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Institution members read timetable_slots"
  ON public.timetable_slots FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "School admins insert timetable_slots"
  ON public.timetable_slots FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY "School admins update timetable_slots"
  ON public.timetable_slots FOR UPDATE
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

CREATE POLICY "School admins delete timetable_slots"
  ON public.timetable_slots FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

-- Coordinator writes: class must live in a wing the coordinator is
-- assigned to. Using EXISTS on the wing-class junction keeps this
-- lean and re-uses the existing helpers (no new SECURITY DEFINER).
CREATE POLICY "Coordinators insert timetable_slots"
  ON public.timetable_slots FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = timetable_slots.class_id
        AND wa.user_id  = auth.uid()
    )
  );

CREATE POLICY "Coordinators update timetable_slots"
  ON public.timetable_slots FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = timetable_slots.class_id
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
      WHERE wcm.class_id = timetable_slots.class_id
        AND wa.user_id  = auth.uid()
    )
  );

CREATE POLICY "Coordinators delete timetable_slots"
  ON public.timetable_slots FOR DELETE
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = timetable_slots.class_id
        AND wa.user_id  = auth.uid()
    )
  );
