-- =============================================================
-- OPTIONAL SUBJECTS — P5: optional batches (teaching groups)
-- -------------------------------------------------------------
-- A batch = subject + teacher + roster of enrolled students. The
-- roster may span sections (cross-section). The batch teacher
-- teaches the batch roster, not the section. The roster is kept a
-- strict SUBSET of student_optional_enrollments by triggers:
--   * you can't add a student not enrolled in the batch's subject,
--   * un-enrolling removes the student from that subject's batches.
--
-- All subject_id = universal_subjects.id. FK indexes in-migration.
-- RLS through SECURITY DEFINER helpers (no inline cross-table EXISTS).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Tables
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.optional_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year   text NOT NULL,
  subject_id      uuid NOT NULL REFERENCES public.universal_subjects(id) ON DELETE RESTRICT,
  teacher_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  label           text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ob_institution_year ON public.optional_batches(institution_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_ob_subject ON public.optional_batches(subject_id);
CREATE INDEX IF NOT EXISTS idx_ob_teacher ON public.optional_batches(teacher_id) WHERE teacher_id IS NOT NULL;

DROP TRIGGER IF EXISTS ob_set_updated_at ON public.optional_batches;
CREATE TRIGGER ob_set_updated_at
  BEFORE UPDATE ON public.optional_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.optional_batch_students (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES public.optional_batches(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_obs_batch_student UNIQUE (batch_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_obs_batch ON public.optional_batch_students(batch_id);
CREATE INDEX IF NOT EXISTS idx_obs_student ON public.optional_batch_students(student_id);

-- -------------------------------------------------------------
-- 2. Consistency triggers — keep roster ⊆ active enrollments
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.optional_batch_student_requires_enrollment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_subject uuid;
BEGIN
  SELECT subject_id INTO v_subject FROM public.optional_batches WHERE id = NEW.batch_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.student_optional_enrollments soe
    WHERE soe.student_id = NEW.student_id
      AND soe.subject_id = v_subject
      AND soe.is_active = true
  ) THEN
    RAISE EXCEPTION 'Student must be enrolled in this optional subject before joining its batch.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_obs_requires_enrollment ON public.optional_batch_students;
CREATE TRIGGER trg_obs_requires_enrollment
  BEFORE INSERT OR UPDATE ON public.optional_batch_students
  FOR EACH ROW EXECUTE FUNCTION public.optional_batch_student_requires_enrollment();

CREATE OR REPLACE FUNCTION public.optional_enrollment_cascade_batch_removal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'DELETE')
     OR (TG_OP = 'UPDATE' AND OLD.is_active = true AND NEW.is_active = false) THEN
    DELETE FROM public.optional_batch_students obs
    USING public.optional_batches ob
    WHERE obs.batch_id = ob.id
      AND obs.student_id = OLD.student_id
      AND ob.subject_id = OLD.subject_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_soe_cascade_batch_removal ON public.student_optional_enrollments;
CREATE TRIGGER trg_soe_cascade_batch_removal
  AFTER UPDATE OR DELETE ON public.student_optional_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.optional_enrollment_cascade_batch_removal();

-- -------------------------------------------------------------
-- 3. RLS helpers (SECURITY DEFINER)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_optional_batches(_actor uuid, _institution uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.is_super_admin(_actor)
    OR (
      _institution = public.get_user_institution(_actor)
      AND (
        public.has_role(_actor, 'school_admin')
        OR public.has_role(_actor, 'super_school_admin')
        OR public.has_role(_actor, 'coordinator')
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_optional_batch(_actor uuid, _batch uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.optional_batches ob
    WHERE ob.id = _batch
      AND public.can_manage_optional_batches(_actor, ob.institution_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.optional_batch_teacher_can_see(_actor uuid, _batch uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.optional_batches ob
    WHERE ob.id = _batch
      AND (ob.teacher_id = _actor OR public.can_manage_optional_batches(_actor, ob.institution_id))
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_optional_batches(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_optional_batch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.optional_batch_teacher_can_see(uuid, uuid) TO authenticated;

-- -------------------------------------------------------------
-- 4. RLS policies
-- -------------------------------------------------------------
ALTER TABLE public.optional_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ob_select ON public.optional_batches;
DROP POLICY IF EXISTS ob_manage ON public.optional_batches;

CREATE POLICY ob_select ON public.optional_batches
  FOR SELECT TO authenticated
  USING (
    public.can_manage_optional_batches(auth.uid(), institution_id)
    OR teacher_id = auth.uid()
  );

CREATE POLICY ob_manage ON public.optional_batches
  FOR ALL TO authenticated
  USING (public.can_manage_optional_batches(auth.uid(), institution_id))
  WITH CHECK (public.can_manage_optional_batches(auth.uid(), institution_id));

ALTER TABLE public.optional_batch_students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS obs_select ON public.optional_batch_students;
DROP POLICY IF EXISTS obs_manage ON public.optional_batch_students;

CREATE POLICY obs_select ON public.optional_batch_students
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR public.optional_batch_teacher_can_see(auth.uid(), batch_id)
  );

CREATE POLICY obs_manage ON public.optional_batch_students
  FOR ALL TO authenticated
  USING (public.can_manage_optional_batch(auth.uid(), batch_id))
  WITH CHECK (public.can_manage_optional_batch(auth.uid(), batch_id));

-- -------------------------------------------------------------
-- 5. Builder helper — students enrolled in a subject (cross-section),
--    with their class label + whether already in a given batch.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.optional_subject_enrolled_students(_subject uuid, _institution uuid)
RETURNS TABLE(student_id uuid, full_name text, roll_number text, class_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_optional_batches(auth.uid(), _institution) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    soe.student_id,
    p.full_name::text,
    p.roll_number::text,
    (
      SELECT string_agg(DISTINCT c.name || COALESCE('-' || c.section, ''), ', ')
      FROM public.class_assignments ca
      JOIN public.classes c ON c.id = ca.class_id
      WHERE ca.user_id = soe.student_id AND ca.role = 'student'
    )::text AS class_label
  FROM public.student_optional_enrollments soe
  JOIN public.profiles p ON p.id = soe.student_id
  WHERE soe.subject_id = _subject
    AND soe.is_active = true
    AND soe.institution_id = _institution;
END;
$$;
GRANT EXECUTE ON FUNCTION public.optional_subject_enrolled_students(uuid, uuid) TO authenticated;
