-- =============================================================
-- OPTIONAL SUBJECTS — P1: per-student enrollment + core helpers
-- -------------------------------------------------------------
-- `student_optional_enrollments` is the SOURCE OF TRUTH for all
-- optional-subject filtering. A row (is_active=true) means the
-- student takes that optional subject. Default empty — a student
-- has ZERO optionals until explicitly enrolled (pure opt-in).
--
-- Plus the centralising helper `student_visible_subject_ids` and
-- the Subjects-tab read RPC `get_student_subject_assignment`.
--
-- All subject_id columns are universal_subjects.id. RLS goes
-- through SECURITY DEFINER helpers (no inline cross-table EXISTS
-- in policy bodies — avoids 42P17 recursion).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Enrollment table (Layer A)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_optional_enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id      uuid NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  class_id        uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year   text,
  is_active       boolean NOT NULL DEFAULT true,
  assigned_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_soe_student_subject UNIQUE (student_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_soe_student        ON public.student_optional_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_soe_subject        ON public.student_optional_enrollments(subject_id);
CREATE INDEX IF NOT EXISTS idx_soe_class          ON public.student_optional_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_soe_institution    ON public.student_optional_enrollments(institution_id);
CREATE INDEX IF NOT EXISTS idx_soe_active_student ON public.student_optional_enrollments(student_id) WHERE is_active;

DROP TRIGGER IF EXISTS soe_set_updated_at ON public.student_optional_enrollments;
CREATE TRIGGER soe_set_updated_at
  BEFORE UPDATE ON public.student_optional_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.student_optional_enrollments IS
  'Per-student optional-subject enrollment (source of truth for optional filtering). Row + is_active=true => student takes this optional. subject_id is universal_subjects.id.';

-- -------------------------------------------------------------
-- 2. Authorization helpers (SECURITY DEFINER)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_student_subjects(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.is_super_admin(_actor)
    OR (
      EXISTS (
        SELECT 1 FROM public.profiles stu
        WHERE stu.id = _student
          AND stu.institution_id = public.get_user_institution(_actor)
      )
      AND (
        public.has_role(_actor, 'school_admin')
        OR public.has_role(_actor, 'super_school_admin')
        OR (
          public.has_role(_actor, 'coordinator')
          AND EXISTS (
            SELECT 1 FROM public.class_assignments ca
            WHERE ca.user_id = _student
              AND ca.role = 'student'
              AND public.is_coordinator_for_class(_actor, ca.class_id)
          )
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_student_subjects(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _actor = _student OR public.can_manage_student_subjects(_actor, _student);
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_student_subjects(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_student_subjects(uuid, uuid)   TO authenticated;

-- -------------------------------------------------------------
-- 3. RLS
-- -------------------------------------------------------------
ALTER TABLE public.student_optional_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS soe_super_admin   ON public.student_optional_enrollments;
DROP POLICY IF EXISTS soe_select_own    ON public.student_optional_enrollments;
DROP POLICY IF EXISTS soe_select_manage ON public.student_optional_enrollments;
DROP POLICY IF EXISTS soe_insert_manage ON public.student_optional_enrollments;
DROP POLICY IF EXISTS soe_update_manage ON public.student_optional_enrollments;
DROP POLICY IF EXISTS soe_delete_manage ON public.student_optional_enrollments;

CREATE POLICY soe_super_admin ON public.student_optional_enrollments
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY soe_select_own ON public.student_optional_enrollments
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY soe_select_manage ON public.student_optional_enrollments
  FOR SELECT TO authenticated
  USING (public.can_manage_student_subjects(auth.uid(), student_id));

CREATE POLICY soe_insert_manage ON public.student_optional_enrollments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_student_subjects(auth.uid(), student_id));

CREATE POLICY soe_update_manage ON public.student_optional_enrollments
  FOR UPDATE TO authenticated
  USING (public.can_manage_student_subjects(auth.uid(), student_id))
  WITH CHECK (public.can_manage_student_subjects(auth.uid(), student_id));

CREATE POLICY soe_delete_manage ON public.student_optional_enrollments
  FOR DELETE TO authenticated
  USING (public.can_manage_student_subjects(auth.uid(), student_id));

-- -------------------------------------------------------------
-- 4. Centralising helper — the subjects a student actually sees.
--    = compulsory subjects of their section(s)  ∪  enrolled optionals
--      (still mapped to one of their sections).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_visible_subject_ids(_student uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT sid), ARRAY[]::uuid[]) FROM (
    -- Compulsory: every non-optional subject mapped to the student's section(s).
    SELECT scm.subject_id AS sid
    FROM public.class_assignments ca
    JOIN public.subject_class_mappings scm ON scm.class_id = ca.class_id
    WHERE ca.user_id = _student AND ca.role = 'student' AND scm.is_optional = false
    UNION
    -- Optional: enrolled subjects still mapped to one of the student's sections.
    SELECT scm.subject_id AS sid
    FROM public.student_optional_enrollments soe
    JOIN public.class_assignments ca
      ON ca.user_id = soe.student_id AND ca.role = 'student'
    JOIN public.subject_class_mappings scm
      ON scm.class_id = ca.class_id AND scm.subject_id = soe.subject_id
    WHERE soe.student_id = _student AND soe.is_active = true
  ) u;
$$;
GRANT EXECUTE ON FUNCTION public.student_visible_subject_ids(uuid) TO authenticated;

-- -------------------------------------------------------------
-- 5. Subjects-tab read RPC — compulsory (locked) + optional offered
--    with each student's enrolled state. Gated by view permission.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_subject_assignment(_student uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_view_student_subjects(auth.uid(), _student) THEN
    RAISE EXCEPTION 'Not authorized to view this student''s subjects' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'can_manage', public.can_manage_student_subjects(auth.uid(), _student),
    'compulsory', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object('subject_id', us.id, 'name', us.name))
      FROM public.class_assignments ca
      JOIN public.subject_class_mappings scm
        ON scm.class_id = ca.class_id AND scm.is_optional = false
      JOIN public.universal_subjects us ON us.id = scm.subject_id
      WHERE ca.user_id = _student AND ca.role = 'student'
    ), '[]'::jsonb),
    'optional_offered', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'subject_id',    us.id,
        'name',          us.name,
        'enrolled',      (soe.id IS NOT NULL AND soe.is_active),
        'enrollment_id', soe.id
      ))
      FROM public.class_assignments ca
      JOIN public.subject_class_mappings scm
        ON scm.class_id = ca.class_id AND scm.is_optional = true
      JOIN public.universal_subjects us ON us.id = scm.subject_id
      LEFT JOIN public.student_optional_enrollments soe
        ON soe.student_id = _student AND soe.subject_id = scm.subject_id
      WHERE ca.user_id = _student AND ca.role = 'student'
        -- "core wins": don't offer a subject that is compulsory in any of the student's sections
        AND NOT EXISTS (
          SELECT 1 FROM public.class_assignments ca2
          JOIN public.subject_class_mappings scm2
            ON scm2.class_id = ca2.class_id
           AND scm2.subject_id = scm.subject_id
           AND scm2.is_optional = false
          WHERE ca2.user_id = _student AND ca2.role = 'student'
        )
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_subject_assignment(uuid) TO authenticated;
