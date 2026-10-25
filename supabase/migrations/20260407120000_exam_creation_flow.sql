-- =============================================
-- EXAM CREATION FLOW — mobile-first redesign support
-- Adds: availability window, proctoring config, result visibility,
--       lock-after-first-attempt versioning, section randomize/partial,
--       exam_templates, offline_section_marks, comprehension + numerical
--       question types.
-- =============================================

-- -----------------------------------------------------------------
-- 1. Extend question_type enum
-- -----------------------------------------------------------------
ALTER TYPE public.question_type ADD VALUE IF NOT EXISTS 'comprehension';
ALTER TYPE public.question_type ADD VALUE IF NOT EXISTS 'numerical';
ALTER TYPE public.question_type ADD VALUE IF NOT EXISTS 'match_column';

-- -----------------------------------------------------------------
-- 2. Extend exams table
-- -----------------------------------------------------------------
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS availability_start TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS availability_end   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS proctoring_config  JSONB NOT NULL DEFAULT
    '{"webcam":false,"tab_switch_lock":false,"fullscreen_lock":false,"copy_paste_disable":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS result_visibility  TEXT NOT NULL DEFAULT 'after_teacher_releases',
  ADD COLUMN IF NOT EXISTS visible_to_students BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_locked_for_edits BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at           TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS current_version     INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS template_id         UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'exams'
      AND constraint_name = 'exams_result_visibility_check'
  ) THEN
    ALTER TABLE public.exams
      ADD CONSTRAINT exams_result_visibility_check
      CHECK (result_visibility IN ('immediate','after_teacher_releases','hidden'));
  END IF;
END $$;

-- Backfill: lock any already-published / non-draft exams (no edits allowed)
UPDATE public.exams
   SET is_locked_for_edits = true,
       locked_at            = COALESCE(locked_at, now())
 WHERE status <> 'draft'
   AND is_locked_for_edits = false;

-- -----------------------------------------------------------------
-- 3. Extend exam_sections table
-- -----------------------------------------------------------------
ALTER TABLE public.exam_sections
  ADD COLUMN IF NOT EXISTS randomize_order          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partial_marks_allowed    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS negative_marking_enabled BOOLEAN NOT NULL DEFAULT false;

-- -----------------------------------------------------------------
-- 4. exam_templates table
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  subject_id      UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  template_data   JSONB NOT NULL,
  created_by      UUID NOT NULL REFERENCES public.profiles(id),
  is_shared       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_templates_institution ON public.exam_templates(institution_id);
CREATE INDEX IF NOT EXISTS idx_exam_templates_creator     ON public.exam_templates(created_by);

DROP TRIGGER IF EXISTS update_exam_templates_updated_at ON public.exam_templates;
CREATE TRIGGER update_exam_templates_updated_at
  BEFORE UPDATE ON public.exam_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- FK from exams.template_id → exam_templates.id (added after table exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'exams'
      AND constraint_name = 'exams_template_id_fkey'
  ) THEN
    ALTER TABLE public.exams
      ADD CONSTRAINT exams_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES public.exam_templates(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.exam_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins view all exam_templates"  ON public.exam_templates;
DROP POLICY IF EXISTS "Institution members view exam_templates" ON public.exam_templates;
DROP POLICY IF EXISTS "Creators manage their exam_templates"   ON public.exam_templates;
DROP POLICY IF EXISTS "School admins manage exam_templates"    ON public.exam_templates;
DROP POLICY IF EXISTS "Teachers insert exam_templates"         ON public.exam_templates;

CREATE POLICY "Super admins view all exam_templates"
  ON public.exam_templates FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Institution members view exam_templates"
  ON public.exam_templates FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (is_shared = true OR created_by = auth.uid())
  );

CREATE POLICY "Creators manage their exam_templates"
  ON public.exam_templates FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "School admins manage exam_templates"
  ON public.exam_templates FOR ALL
  USING (public.has_role_at_institution(auth.uid(), 'school_admin', institution_id))
  WITH CHECK (public.has_role_at_institution(auth.uid(), 'school_admin', institution_id));

CREATE POLICY "Teachers insert exam_templates"
  ON public.exam_templates FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND created_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'coordinator')
    )
  );

-- -----------------------------------------------------------------
-- 5. offline_section_marks table
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offline_section_marks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id      UUID NOT NULL REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE,
  section_id      UUID NOT NULL REFERENCES public.exam_sections(id) ON DELETE CASCADE,
  marks_obtained  NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_absent       BOOLEAN NOT NULL DEFAULT false,
  entered_by      UUID NOT NULL REFERENCES public.profiles(id),
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_offline_section_marks_attempt ON public.offline_section_marks(attempt_id);
CREATE INDEX IF NOT EXISTS idx_offline_section_marks_section ON public.offline_section_marks(section_id);

DROP TRIGGER IF EXISTS update_offline_section_marks_updated_at ON public.offline_section_marks;
CREATE TRIGGER update_offline_section_marks_updated_at
  BEFORE UPDATE ON public.offline_section_marks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.offline_section_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins view all offline_section_marks"     ON public.offline_section_marks;
DROP POLICY IF EXISTS "School admins manage offline_section_marks"      ON public.offline_section_marks;
DROP POLICY IF EXISTS "Teachers manage offline_section_marks for class" ON public.offline_section_marks;
DROP POLICY IF EXISTS "Students view their offline_section_marks"       ON public.offline_section_marks;

CREATE POLICY "Super admins view all offline_section_marks"
  ON public.offline_section_marks FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins manage offline_section_marks"
  ON public.offline_section_marks FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(),
      'school_admin',
      public.get_exam_institution(
        (SELECT exam_id FROM public.student_exam_attempts WHERE id = attempt_id)
      )
    )
  );

CREATE POLICY "Teachers manage offline_section_marks for class"
  ON public.offline_section_marks FOR ALL
  USING (
    (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'coordinator'))
    AND public.is_assigned_to_exam_class(
      auth.uid(),
      (SELECT exam_id FROM public.student_exam_attempts WHERE id = attempt_id)
    )
  )
  WITH CHECK (
    entered_by = auth.uid()
  );

CREATE POLICY "Students view their offline_section_marks"
  ON public.offline_section_marks FOR SELECT
  USING (
    (SELECT student_id FROM public.student_exam_attempts WHERE id = attempt_id) = auth.uid()
  );

-- -----------------------------------------------------------------
-- 6. Lock exam on first student attempt
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_exam_on_first_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.exams
     SET is_locked_for_edits = true,
         locked_at            = now()
   WHERE id = NEW.exam_id
     AND is_locked_for_edits = false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_exam_on_first_attempt ON public.student_exam_attempts;
CREATE TRIGGER trg_lock_exam_on_first_attempt
  AFTER INSERT ON public.student_exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_exam_on_first_attempt();

-- -----------------------------------------------------------------
-- 7. Relax structure-change trigger to use is_locked_for_edits
--    (previously only draft exams could be edited; now any unlocked exam
--    can be — versioning flow handles user confirmation in the UI.)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_exam_structure_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_id UUID;
  v_locked  BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'exam_sections' THEN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  ELSIF TG_TABLE_NAME = 'exam_questions' THEN
    v_exam_id := public.get_section_exam_id(COALESCE(NEW.section_id, OLD.section_id));
  ELSIF TG_TABLE_NAME IN ('exam_classes','exam_subjects') THEN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  END IF;

  SELECT is_locked_for_edits INTO v_locked
    FROM public.exams
   WHERE id = v_exam_id;

  IF COALESCE(v_locked, false) THEN
    RAISE EXCEPTION 'Cannot modify exam structure: exam is locked (attempts already recorded).';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------
-- 8. Helper: bump exam version (used by frontend when confirming edit
--    on a previously-attempted exam)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_exam_version(_exam_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_version INTEGER;
BEGIN
  UPDATE public.exams
     SET current_version      = current_version + 1,
         is_locked_for_edits  = false,
         locked_at            = NULL
   WHERE id = _exam_id
  RETURNING current_version INTO v_new_version;

  RETURN v_new_version;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_exam_version(UUID) TO authenticated;

-- -----------------------------------------------------------------
-- 9. Indexes to support new flow queries
-- -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_exams_status_creator ON public.exams(status, created_by);
CREATE INDEX IF NOT EXISTS idx_exams_template       ON public.exams(template_id);
