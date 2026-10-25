-- Phase 1: Database Schema Changes for Enhanced Features

-- 1.1 Wing-Class Mappings (group classes under wings)
CREATE TABLE public.wing_class_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wing_id UUID NOT NULL REFERENCES public.wings(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(wing_id, class_id)
);

-- 1.2 Subject-Class Mappings (which subjects are taught in which class)
CREATE TABLE public.subject_class_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(class_id, subject_id)
);

-- 1.3 Add supervisor_id to task_assignments for coordinator supervision
ALTER TABLE public.task_assignments 
ADD COLUMN IF NOT EXISTS supervisor_id UUID REFERENCES public.profiles(id);

-- 1.4 Notifications table for in-app notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'task_overdue', 'task_reminder', 'task_escalation', 'task_submitted', 'badge_earned', etc.
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- URL to navigate to
  is_read BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 1.5 Task comments table (for supervisor observations and communication)
CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 1.6 Create indexes for performance
CREATE INDEX idx_wing_class_mappings_wing ON public.wing_class_mappings(wing_id);
CREATE INDEX idx_wing_class_mappings_class ON public.wing_class_mappings(class_id);
CREATE INDEX idx_subject_class_mappings_institution ON public.subject_class_mappings(institution_id);
CREATE INDEX idx_subject_class_mappings_class ON public.subject_class_mappings(class_id);
CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_task_comments_task ON public.task_comments(task_id);
CREATE INDEX idx_task_assignments_supervisor ON public.task_assignments(supervisor_id);

-- Enable RLS on all new tables
ALTER TABLE public.wing_class_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_class_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for wing_class_mappings
CREATE POLICY "Users can view wing-class mappings in their institution"
ON public.wing_class_mappings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.wings w
    WHERE w.id = wing_id
    AND w.institution_id = public.get_user_institution(auth.uid())
  )
);

CREATE POLICY "School admins can manage wing-class mappings"
ON public.wing_class_mappings FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.wings w
    WHERE w.id = wing_id
    AND w.institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin') 
      OR public.has_role(auth.uid(), 'super_admin')
    )
  )
);

-- RLS Policies for subject_class_mappings
CREATE POLICY "Users can view subject-class mappings in their institution"
ON public.subject_class_mappings FOR SELECT
USING (institution_id = public.get_user_institution(auth.uid()) OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can manage subject-class mappings"
ON public.subject_class_mappings FOR ALL
USING (
  (institution_id = public.get_user_institution(auth.uid()) AND public.has_role(auth.uid(), 'school_admin'))
  OR public.has_role(auth.uid(), 'super_admin')
);

-- RLS Policies for notifications
CREATE POLICY "Users can view their own notifications"
ON public.notifications FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
ON public.notifications FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "System can insert notifications"
ON public.notifications FOR INSERT
WITH CHECK (true);

-- RLS Policies for task_comments
CREATE POLICY "Task participants can view comments"
ON public.task_comments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = task_comments.task_id
    AND (ta.assignee_id = auth.uid() OR ta.assigner_id = auth.uid() OR ta.supervisor_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'super_admin')
);

CREATE POLICY "Task participants can add comments"
ON public.task_comments FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = task_comments.task_id
    AND (ta.assignee_id = auth.uid() OR ta.assigner_id = auth.uid() OR ta.supervisor_id = auth.uid())
  )
);

-- Helper function to get supervisor for a task
CREATE OR REPLACE FUNCTION public.get_task_supervisor(_task_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT supervisor_id FROM public.task_assignments WHERE task_id = _task_id
$$;

-- Helper function to check if user is task supervisor
CREATE OR REPLACE FUNCTION public.is_task_supervisor(_user_id uuid, _task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_assignments
    WHERE task_id = _task_id AND supervisor_id = _user_id
  )
$$;