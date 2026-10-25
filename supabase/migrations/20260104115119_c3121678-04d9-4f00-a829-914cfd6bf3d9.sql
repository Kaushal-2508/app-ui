-- =============================================
-- EXAM ENGINE SCHEMA
-- =============================================

-- Enum for exam modes
CREATE TYPE public.exam_mode AS ENUM ('online', 'offline', 'hybrid');

-- Enum for exam status
CREATE TYPE public.exam_status AS ENUM ('draft', 'ready', 'published', 'active', 'completed', 'archived');

-- Enum for question types
CREATE TYPE public.question_type AS ENUM ('mcq', 'short_answer', 'long_answer', 'true_false', 'fill_blank', 'matching');

-- =============================================
-- CORE TABLES
-- =============================================

-- Main exams table
CREATE TABLE public.exams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  exam_mode public.exam_mode NOT NULL DEFAULT 'offline',
  status public.exam_status NOT NULL DEFAULT 'draft',
  total_marks NUMERIC(10,2),
  pass_marks NUMERIC(10,2),
  duration_minutes INTEGER,
  scheduled_date TIMESTAMP WITH TIME ZONE,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  instructions TEXT,
  is_blueprint_ready BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMP WITH TIME ZONE,
  published_by UUID REFERENCES public.profiles(id),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Constraint: pass_marks <= total_marks
  CONSTRAINT valid_pass_marks CHECK (pass_marks IS NULL OR total_marks IS NULL OR pass_marks <= total_marks),
  -- Constraint: end_time > start_time
  CONSTRAINT valid_time_range CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

-- Link exams to classes (many-to-many)
CREATE TABLE public.exam_classes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(exam_id, class_id)
);

-- Link exams to subjects (many-to-many)
CREATE TABLE public.exam_subjects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  weightage NUMERIC(5,2), -- percentage weightage for this subject
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(exam_id, subject_id)
);

-- Exam sections (structure)
CREATE TABLE public.exam_sections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  section_order INTEGER NOT NULL DEFAULT 1,
  total_marks NUMERIC(10,2),
  instructions TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(exam_id, section_order)
);

-- Exam questions
CREATE TABLE public.exam_questions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES public.exam_sections(id) ON DELETE CASCADE,
  question_type public.question_type NOT NULL DEFAULT 'mcq',
  question_text TEXT NOT NULL,
  question_order INTEGER NOT NULL DEFAULT 1,
  marks NUMERIC(10,2) NOT NULL DEFAULT 1,
  negative_marks NUMERIC(10,2) DEFAULT 0,
  options JSONB, -- for MCQ: [{id, text, is_correct}]
  correct_answer TEXT, -- for non-MCQ questions
  explanation TEXT,
  difficulty_level INTEGER DEFAULT 2 CHECK (difficulty_level >= 1 AND difficulty_level <= 5),
  tags TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(section_id, question_order)
);

-- Publication audit log
CREATE TABLE public.exam_publication_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'published', 'unpublished', 'republished'
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  previous_status public.exam_status,
  new_status public.exam_status NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_exams_institution ON public.exams(institution_id);
CREATE INDEX idx_exams_status ON public.exams(status);
CREATE INDEX idx_exams_created_by ON public.exams(created_by);
CREATE INDEX idx_exams_scheduled_date ON public.exams(scheduled_date);
CREATE INDEX idx_exam_classes_exam ON public.exam_classes(exam_id);
CREATE INDEX idx_exam_classes_class ON public.exam_classes(class_id);
CREATE INDEX idx_exam_subjects_exam ON public.exam_subjects(exam_id);
CREATE INDEX idx_exam_sections_exam ON public.exam_sections(exam_id);
CREATE INDEX idx_exam_questions_section ON public.exam_questions(section_id);
CREATE INDEX idx_exam_publication_logs_exam ON public.exam_publication_logs(exam_id);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Check if user created the exam
CREATE OR REPLACE FUNCTION public.is_exam_creator(_exam_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams
    WHERE id = _exam_id AND created_by = _user_id
  )
$$;

-- Get exam institution
CREATE OR REPLACE FUNCTION public.get_exam_institution(_exam_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.exams WHERE id = _exam_id
$$;

-- Check if user is assigned to any class linked to this exam
CREATE OR REPLACE FUNCTION public.is_assigned_to_exam_class(_user_id UUID, _exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.exam_classes ec
    JOIN public.class_assignments ca ON ca.class_id = ec.class_id
    WHERE ec.exam_id = _exam_id AND ca.user_id = _user_id
  )
$$;

-- Check if exam is in draft status (can be modified)
CREATE OR REPLACE FUNCTION public.is_exam_modifiable(_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams
    WHERE id = _exam_id AND status = 'draft'
  )
$$;

-- Check if exam has blueprint ready
CREATE OR REPLACE FUNCTION public.exam_has_blueprint(_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_blueprint_ready FROM public.exams WHERE id = _exam_id),
    false
  )
$$;

-- Get section's exam ID
CREATE OR REPLACE FUNCTION public.get_section_exam_id(_section_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT exam_id FROM public.exam_sections WHERE id = _section_id
$$;

-- =============================================
-- TRIGGERS
-- =============================================

-- Auto-update updated_at for exams
CREATE TRIGGER update_exams_updated_at
  BEFORE UPDATE ON public.exams
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-update updated_at for exam_sections
CREATE TRIGGER update_exam_sections_updated_at
  BEFORE UPDATE ON public.exam_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-update updated_at for exam_questions
CREATE TRIGGER update_exam_questions_updated_at
  BEFORE UPDATE ON public.exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Validate exam status transitions
CREATE OR REPLACE FUNCTION public.validate_exam_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Can't publish without blueprint
  IF NEW.status = 'published' AND NOT NEW.is_blueprint_ready THEN
    RAISE EXCEPTION 'Cannot publish exam without evaluation blueprint';
  END IF;
  
  -- Can't modify structure after publish (handled separately)
  IF OLD.status IN ('published', 'active', 'completed') AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot revert published exam to draft';
  END IF;
  
  -- Set published_at and published_by when publishing
  IF OLD.status != 'published' AND NEW.status = 'published' THEN
    NEW.published_at := now();
    NEW.published_by := auth.uid();
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_exam_status
  BEFORE UPDATE ON public.exams
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.validate_exam_status_transition();

-- Log exam publication
CREATE OR REPLACE FUNCTION public.log_exam_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND 
     NEW.status IN ('published', 'active', 'completed') THEN
    INSERT INTO public.exam_publication_logs (
      exam_id,
      action,
      actor_id,
      previous_status,
      new_status
    ) VALUES (
      NEW.id,
      CASE NEW.status
        WHEN 'published' THEN 'published'
        WHEN 'active' THEN 'activated'
        WHEN 'completed' THEN 'completed'
        ELSE 'status_changed'
      END,
      auth.uid(),
      OLD.status,
      NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_exam_publication_trigger
  AFTER UPDATE ON public.exams
  FOR EACH ROW
  EXECUTE FUNCTION public.log_exam_publication();

-- Prevent structure changes after publish
CREATE OR REPLACE FUNCTION public.prevent_exam_structure_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_id UUID;
  v_exam_status public.exam_status;
BEGIN
  -- Get the exam_id based on the table
  IF TG_TABLE_NAME = 'exam_sections' THEN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  ELSIF TG_TABLE_NAME = 'exam_questions' THEN
    v_exam_id := public.get_section_exam_id(COALESCE(NEW.section_id, OLD.section_id));
  ELSIF TG_TABLE_NAME = 'exam_classes' OR TG_TABLE_NAME = 'exam_subjects' THEN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  END IF;
  
  -- Get exam status
  SELECT status INTO v_exam_status FROM public.exams WHERE id = v_exam_id;
  
  -- Block changes if exam is not in draft
  IF v_exam_status IS NOT NULL AND v_exam_status != 'draft' THEN
    RAISE EXCEPTION 'Cannot modify exam structure after publishing. Exam status: %', v_exam_status;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Apply structure lock triggers
CREATE TRIGGER prevent_section_change_after_publish
  BEFORE INSERT OR UPDATE OR DELETE ON public.exam_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_exam_structure_change();

CREATE TRIGGER prevent_question_change_after_publish
  BEFORE INSERT OR UPDATE OR DELETE ON public.exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_exam_structure_change();

CREATE TRIGGER prevent_class_link_change_after_publish
  BEFORE INSERT OR UPDATE OR DELETE ON public.exam_classes
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_exam_structure_change();

CREATE TRIGGER prevent_subject_link_change_after_publish
  BEFORE INSERT OR UPDATE OR DELETE ON public.exam_subjects
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_exam_structure_change();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_publication_logs ENABLE ROW LEVEL SECURITY;

-- =============================================
-- EXAMS POLICIES
-- =============================================

-- Super admins can view all exams
CREATE POLICY "Super admins can view all exams"
  ON public.exams FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- School admins can manage exams in their institution
CREATE POLICY "School admins can manage exams in their institution"
  ON public.exams FOR ALL
  USING (public.has_role_at_institution(auth.uid(), 'school_admin', institution_id));

-- Users can view exams in their institution
CREATE POLICY "Users can view exams in their institution"
  ON public.exams FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

-- Teachers can create exams for their assigned classes
CREATE POLICY "Teachers can create exams"
  ON public.exams FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid()) AND
    created_by = auth.uid() AND
    (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'coordinator'))
  );

-- Exam creators can update their exams (if in draft)
CREATE POLICY "Creators can update draft exams"
  ON public.exams FOR UPDATE
  USING (
    created_by = auth.uid() AND status = 'draft'
  );

-- Coordinators can update exams for their assigned classes
CREATE POLICY "Coordinators can update exams for assigned classes"
  ON public.exams FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'coordinator') AND
    public.is_assigned_to_exam_class(auth.uid(), id)
  );

-- =============================================
-- EXAM_CLASSES POLICIES
-- =============================================

-- Super admins can view all exam-class links
CREATE POLICY "Super admins can view all exam_classes"
  ON public.exam_classes FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- School admins can manage exam-class links in their institution
CREATE POLICY "School admins can manage exam_classes"
  ON public.exam_classes FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(exam_id)
    )
  );

-- Users assigned to the class can view exam-class links
CREATE POLICY "Class members can view exam_classes"
  ON public.exam_classes FOR SELECT
  USING (public.is_assigned_to_class(auth.uid(), class_id));

-- Exam creators can add class links (only for assigned classes)
CREATE POLICY "Exam creators can add class links"
  ON public.exam_classes FOR INSERT
  WITH CHECK (
    public.is_exam_creator(exam_id, auth.uid()) AND
    public.is_assigned_to_class(auth.uid(), class_id)
  );

-- =============================================
-- EXAM_SUBJECTS POLICIES
-- =============================================

-- Super admins can view all exam-subject links
CREATE POLICY "Super admins can view all exam_subjects"
  ON public.exam_subjects FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- School admins can manage exam-subject links
CREATE POLICY "School admins can manage exam_subjects"
  ON public.exam_subjects FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(exam_id)
    )
  );

-- Users can view exam-subject links for their institution's exams
CREATE POLICY "Users can view exam_subjects"
  ON public.exam_subjects FOR SELECT
  USING (
    public.get_exam_institution(exam_id) = public.get_user_institution(auth.uid())
  );

-- Exam creators can add subject links
CREATE POLICY "Exam creators can add subject links"
  ON public.exam_subjects FOR INSERT
  WITH CHECK (public.is_exam_creator(exam_id, auth.uid()));

-- =============================================
-- EXAM_SECTIONS POLICIES
-- =============================================

-- Super admins can view all sections
CREATE POLICY "Super admins can view all exam_sections"
  ON public.exam_sections FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- School admins can manage sections
CREATE POLICY "School admins can manage exam_sections"
  ON public.exam_sections FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(exam_id)
    )
  );

-- Users can view sections for their institution's exams
CREATE POLICY "Users can view exam_sections"
  ON public.exam_sections FOR SELECT
  USING (
    public.get_exam_institution(exam_id) = public.get_user_institution(auth.uid())
  );

-- Exam creators can manage sections
CREATE POLICY "Exam creators can manage sections"
  ON public.exam_sections FOR ALL
  USING (public.is_exam_creator(exam_id, auth.uid()));

-- =============================================
-- EXAM_QUESTIONS POLICIES
-- =============================================

-- Super admins can view all questions
CREATE POLICY "Super admins can view all exam_questions"
  ON public.exam_questions FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- School admins can manage questions
CREATE POLICY "School admins can manage exam_questions"
  ON public.exam_questions FOR ALL
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(public.get_section_exam_id(section_id))
    )
  );

-- Users can view questions for their institution's exams
CREATE POLICY "Users can view exam_questions"
  ON public.exam_questions FOR SELECT
  USING (
    public.get_exam_institution(public.get_section_exam_id(section_id)) = public.get_user_institution(auth.uid())
  );

-- Exam creators can manage questions
CREATE POLICY "Exam creators can manage questions"
  ON public.exam_questions FOR ALL
  USING (
    public.is_exam_creator(public.get_section_exam_id(section_id), auth.uid())
  );

-- =============================================
-- EXAM_PUBLICATION_LOGS POLICIES
-- =============================================

-- Super admins can view all logs
CREATE POLICY "Super admins can view all publication_logs"
  ON public.exam_publication_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- School admins can view logs in their institution
CREATE POLICY "School admins can view publication_logs"
  ON public.exam_publication_logs FOR SELECT
  USING (
    public.has_role_at_institution(
      auth.uid(), 
      'school_admin', 
      public.get_exam_institution(exam_id)
    )
  );

-- Coordinators can view logs for their exams
CREATE POLICY "Coordinators can view exam publication_logs"
  ON public.exam_publication_logs FOR SELECT
  USING (
    public.has_role(auth.uid(), 'coordinator') AND
    public.is_assigned_to_exam_class(auth.uid(), exam_id)
  );

-- Exam creators can view their logs
CREATE POLICY "Exam creators can view their publication_logs"
  ON public.exam_publication_logs FOR SELECT
  USING (public.is_exam_creator(exam_id, auth.uid()));