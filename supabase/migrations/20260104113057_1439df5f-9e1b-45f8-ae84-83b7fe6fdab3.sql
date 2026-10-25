-- =====================================================
-- SALCI ECOSYSTEM DATABASE SCHEMA
-- Phase 1: Role Foundations + Teacher Management System
-- =====================================================

-- =====================================================
-- SECTION 1: ENUMS
-- =====================================================

-- Role enum (strict hierarchy)
CREATE TYPE public.app_role AS ENUM (
  'super_admin',
  'school_admin', 
  'coordinator',
  'teacher',
  'student'
);

-- Task status enum (lifecycle states)
CREATE TYPE public.task_status AS ENUM (
  'open',
  'in_progress',
  'done_pending_approval',
  'completed',
  'rejected'
);

-- Task type enum
CREATE TYPE public.task_type AS ENUM (
  'exam_related',
  'academic_content',
  'student_support',
  'administrative'
);

-- =====================================================
-- SECTION 2: FOUNDATION TABLES
-- =====================================================

-- Institutions (top-level scope)
CREATE TABLE public.institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  address TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Subjects
CREATE TABLE public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(institution_id, code)
);

-- Classes
CREATE TABLE public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  section TEXT,
  academic_year TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Student Groups (within a class)
CREATE TABLE public.student_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- User Profiles (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- User Roles (SEPARATE table - security requirement)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, role, institution_id)
);

-- Class Assignments (links users to classes)
CREATE TABLE public.class_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  role app_role NOT NULL CHECK (role IN ('coordinator', 'teacher', 'student')),
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, class_id, subject_id)
);

-- =====================================================
-- SECTION 3: TEACHER MANAGEMENT SYSTEM TABLES
-- =====================================================

-- Tasks (core entity)
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  task_type task_type NOT NULL,
  status task_status DEFAULT 'open' NOT NULL,
  priority INTEGER DEFAULT 2 CHECK (priority BETWEEN 1 AND 5),
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Task Assignments (who assigned to whom)
CREATE TABLE public.task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL UNIQUE,
  assigner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- CRITICAL: Prevent self-assignment that could lead to self-approval
  CONSTRAINT no_self_assignment CHECK (assigner_id != assignee_id)
);

-- Task Links (academic linkage - at least one required)
CREATE TABLE public.task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL UNIQUE,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  student_group_id UUID REFERENCES public.student_groups(id) ON DELETE SET NULL,
  exam_id UUID, -- Will reference exams table when created
  -- At least one link required
  CONSTRAINT at_least_one_link CHECK (
    class_id IS NOT NULL OR 
    subject_id IS NOT NULL OR 
    student_group_id IS NOT NULL OR 
    exam_id IS NOT NULL
  )
);

-- Task Evidence (required for completion request)
CREATE TABLE public.task_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('file', 'exam_reference', 'text_note')),
  file_url TEXT,
  file_name TEXT,
  exam_reference_id UUID,
  notes TEXT,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- Ensure proper evidence based on type
  CONSTRAINT valid_evidence CHECK (
    (evidence_type = 'file' AND file_url IS NOT NULL) OR
    (evidence_type = 'exam_reference' AND exam_reference_id IS NOT NULL) OR
    (evidence_type = 'text_note' AND notes IS NOT NULL)
  )
);

-- Task Audit Logs (immutable history)
CREATE TABLE public.task_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  from_status task_status,
  to_status task_status NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- =====================================================
-- SECTION 4: INDEXES
-- =====================================================

CREATE INDEX idx_profiles_institution ON public.profiles(institution_id);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_institution ON public.user_roles(institution_id);
CREATE INDEX idx_classes_institution ON public.classes(institution_id);
CREATE INDEX idx_class_assignments_user ON public.class_assignments(user_id);
CREATE INDEX idx_class_assignments_class ON public.class_assignments(class_id);
CREATE INDEX idx_tasks_institution ON public.tasks(institution_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_task_assignments_assigner ON public.task_assignments(assigner_id);
CREATE INDEX idx_task_assignments_assignee ON public.task_assignments(assignee_id);
CREATE INDEX idx_task_audit_logs_task ON public.task_audit_logs(task_id);

-- =====================================================
-- SECTION 5: HELPER FUNCTIONS (Security Definer)
-- =====================================================

-- Check if user has a specific role (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Check if user has role at specific institution
CREATE OR REPLACE FUNCTION public.has_role_at_institution(_user_id UUID, _role app_role, _institution_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id 
      AND role = _role 
      AND (institution_id = _institution_id OR institution_id IS NULL)
  )
$$;

-- Get user's institution ID
CREATE OR REPLACE FUNCTION public.get_user_institution(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.profiles WHERE id = _user_id
$$;

-- Check if user is assigned to a class
CREATE OR REPLACE FUNCTION public.is_assigned_to_class(_user_id UUID, _class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_assignments
    WHERE user_id = _user_id AND class_id = _class_id
  )
$$;

-- Get task assigner ID
CREATE OR REPLACE FUNCTION public.get_task_assigner(_task_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT assigner_id FROM public.task_assignments WHERE task_id = _task_id
$$;

-- Get task assignee ID
CREATE OR REPLACE FUNCTION public.get_task_assignee(_task_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT assignee_id FROM public.task_assignments WHERE task_id = _task_id
$$;

-- Check if task has evidence
CREATE OR REPLACE FUNCTION public.task_has_evidence(_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_evidence WHERE task_id = _task_id
  )
$$;

-- =====================================================
-- SECTION 6: TRIGGERS FOR BUSINESS RULES
-- =====================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_institutions_updated_at
  BEFORE UPDATE ON public.institutions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_classes_updated_at
  BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Task state transition validation
CREATE OR REPLACE FUNCTION public.validate_task_state_transition()
RETURNS TRIGGER AS $$
DECLARE
  v_assigner_id UUID;
  v_assignee_id UUID;
  v_actor_id UUID;
BEGIN
  -- Get actor (current user)
  v_actor_id := auth.uid();
  
  -- Get assignment info
  SELECT assigner_id, assignee_id INTO v_assigner_id, v_assignee_id
  FROM public.task_assignments WHERE task_id = NEW.id;
  
  -- Rule 1: Only assignee can move to in_progress
  IF OLD.status = 'open' AND NEW.status = 'in_progress' THEN
    IF v_actor_id != v_assignee_id THEN
      RAISE EXCEPTION 'Only the assignee can start a task';
    END IF;
  END IF;
  
  -- Rule 2: Only assignee can submit for approval, and evidence required
  IF OLD.status = 'in_progress' AND NEW.status = 'done_pending_approval' THEN
    IF v_actor_id != v_assignee_id THEN
      RAISE EXCEPTION 'Only the assignee can submit task for approval';
    END IF;
    IF NOT public.task_has_evidence(NEW.id) THEN
      RAISE EXCEPTION 'Evidence is required before submitting for approval';
    END IF;
  END IF;
  
  -- Rule 3: Only assigner can approve (no self-approval)
  IF OLD.status = 'done_pending_approval' AND NEW.status = 'completed' THEN
    IF v_actor_id != v_assigner_id THEN
      RAISE EXCEPTION 'Only the task assigner can approve completion';
    END IF;
    IF v_actor_id = v_assignee_id THEN
      RAISE EXCEPTION 'Self-approval is not allowed';
    END IF;
  END IF;
  
  -- Rule 4: Only assigner can reject
  IF OLD.status = 'done_pending_approval' AND NEW.status = 'rejected' THEN
    IF v_actor_id != v_assigner_id THEN
      RAISE EXCEPTION 'Only the task assigner can reject';
    END IF;
  END IF;
  
  -- Rule 5: Rejected tasks can only go to in_progress (by assignee)
  IF OLD.status = 'rejected' AND NEW.status = 'in_progress' THEN
    IF v_actor_id != v_assignee_id THEN
      RAISE EXCEPTION 'Only the assignee can rework a rejected task';
    END IF;
  END IF;
  
  -- Prevent invalid transitions
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Completed tasks cannot be modified';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER validate_task_state_change
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.validate_task_state_transition();

-- Audit log trigger for task state changes
CREATE OR REPLACE FUNCTION public.log_task_state_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.task_audit_logs (
    task_id,
    actor_id,
    from_status,
    to_status,
    action,
    metadata
  ) VALUES (
    NEW.id,
    auth.uid(),
    OLD.status,
    NEW.status,
    CASE 
      WHEN NEW.status = 'in_progress' THEN 'started'
      WHEN NEW.status = 'done_pending_approval' THEN 'submitted_for_approval'
      WHEN NEW.status = 'completed' THEN 'approved'
      WHEN NEW.status = 'rejected' THEN 'rejected'
      ELSE 'status_changed'
    END,
    jsonb_build_object('updated_at', NEW.updated_at)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER log_task_state_changes
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.log_task_state_change();

-- Log task creation
CREATE OR REPLACE FUNCTION public.log_task_creation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.task_audit_logs (
    task_id,
    actor_id,
    from_status,
    to_status,
    action,
    metadata
  ) VALUES (
    NEW.id,
    auth.uid(),
    NULL,
    NEW.status,
    'created',
    jsonb_build_object('title', NEW.title, 'task_type', NEW.task_type)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER log_task_created
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.log_task_creation();

-- =====================================================
-- SECTION 7: ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_audit_logs ENABLE ROW LEVEL SECURITY;

-- INSTITUTIONS POLICIES
CREATE POLICY "Super admins can view all institutions"
  ON public.institutions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users can view their own institution"
  ON public.institutions FOR SELECT
  TO authenticated
  USING (id = public.get_user_institution(auth.uid()));

CREATE POLICY "Super admins can manage institutions"
  ON public.institutions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- PROFILES POLICIES
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can view profiles in same institution"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "Super admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Super admins can manage all profiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- USER_ROLES POLICIES
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Super admins can manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage roles in their institution"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (
    public.has_role_at_institution(auth.uid(), 'school_admin', institution_id)
    AND role NOT IN ('super_admin', 'school_admin')
  );

-- CLASSES POLICIES
CREATE POLICY "Users can view classes in their institution"
  ON public.classes FOR SELECT
  TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "Super admins can view all classes"
  ON public.classes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can manage classes in their institution"
  ON public.classes FOR ALL
  TO authenticated
  USING (
    public.has_role_at_institution(auth.uid(), 'school_admin', institution_id)
  );

-- CLASS_ASSIGNMENTS POLICIES
CREATE POLICY "Users can view own assignments"
  ON public.class_assignments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Coordinators can view assignments in their classes"
  ON public.class_assignments FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND public.is_assigned_to_class(auth.uid(), class_id)
  );

CREATE POLICY "School admins can manage assignments in their institution"
  ON public.class_assignments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_id
      AND public.has_role_at_institution(auth.uid(), 'school_admin', c.institution_id)
    )
  );

-- TASKS POLICIES
CREATE POLICY "Users can view tasks they are assigned to"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (
    public.get_task_assignee(id) = auth.uid()
    OR public.get_task_assigner(id) = auth.uid()
  );

CREATE POLICY "School admins can view all tasks in their institution"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (
    public.has_role_at_institution(auth.uid(), 'school_admin', institution_id)
  );

CREATE POLICY "Super admins can view all tasks"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Authorized users can create tasks in their institution"
  ON public.tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'coordinator')
      OR public.has_role(auth.uid(), 'teacher')
    )
  );

CREATE POLICY "Task participants can update task status"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (
    public.get_task_assignee(id) = auth.uid()
    OR public.get_task_assigner(id) = auth.uid()
  );

-- TASK_ASSIGNMENTS POLICIES
CREATE POLICY "Users can view task assignments they are part of"
  ON public.task_assignments FOR SELECT
  TO authenticated
  USING (
    assigner_id = auth.uid() OR assignee_id = auth.uid()
  );

CREATE POLICY "School admins can view all task assignments in their institution"
  ON public.task_assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
      AND public.has_role_at_institution(auth.uid(), 'school_admin', t.institution_id)
    )
  );

CREATE POLICY "Authorized users can create task assignments"
  ON public.task_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    assigner_id = auth.uid()
    AND assigner_id != assignee_id
  );

-- TASK_LINKS POLICIES
CREATE POLICY "Users can view task links for their tasks"
  ON public.task_links FOR SELECT
  TO authenticated
  USING (
    public.get_task_assignee(task_id) = auth.uid()
    OR public.get_task_assigner(task_id) = auth.uid()
  );

CREATE POLICY "Task creators can add task links"
  ON public.task_links FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_task_assigner(task_id) = auth.uid()
  );

-- TASK_EVIDENCE POLICIES
CREATE POLICY "Users can view evidence for their tasks"
  ON public.task_evidence FOR SELECT
  TO authenticated
  USING (
    public.get_task_assignee(task_id) = auth.uid()
    OR public.get_task_assigner(task_id) = auth.uid()
  );

CREATE POLICY "Assignees can upload evidence"
  ON public.task_evidence FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_task_assignee(task_id) = auth.uid()
    AND uploaded_by = auth.uid()
  );

-- TASK_AUDIT_LOGS POLICIES (read-only for participants)
CREATE POLICY "Users can view audit logs for their tasks"
  ON public.task_audit_logs FOR SELECT
  TO authenticated
  USING (
    public.get_task_assignee(task_id) = auth.uid()
    OR public.get_task_assigner(task_id) = auth.uid()
  );

CREATE POLICY "School admins can view all audit logs in their institution"
  ON public.task_audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
      AND public.has_role_at_institution(auth.uid(), 'school_admin', t.institution_id)
    )
  );

-- SUBJECTS POLICIES
CREATE POLICY "Users can view subjects in their institution"
  ON public.subjects FOR SELECT
  TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "School admins can manage subjects"
  ON public.subjects FOR ALL
  TO authenticated
  USING (
    public.has_role_at_institution(auth.uid(), 'school_admin', institution_id)
  );

-- STUDENT_GROUPS POLICIES
CREATE POLICY "Users can view student groups in their classes"
  ON public.student_groups FOR SELECT
  TO authenticated
  USING (public.is_assigned_to_class(auth.uid(), class_id));

CREATE POLICY "Teachers and coordinators can manage student groups"
  ON public.student_groups FOR ALL
  TO authenticated
  USING (
    public.is_assigned_to_class(auth.uid(), class_id)
    AND (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'coordinator'))
  );

-- =====================================================
-- SECTION 8: PROFILE CREATION TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();