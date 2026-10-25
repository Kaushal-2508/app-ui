-- Add wing_id to tasks for wing-based scoping
ALTER TABLE public.tasks ADD COLUMN wing_id UUID REFERENCES public.wings(id);

-- Enable realtime for tasks table
ALTER TABLE public.tasks REPLICA IDENTITY FULL;

-- Enable realtime for task_assignments table  
ALTER TABLE public.task_assignments REPLICA IDENTITY FULL;

-- Enable realtime for task_evidence table
ALTER TABLE public.task_evidence REPLICA IDENTITY FULL;

-- Enable realtime for task_comments table
ALTER TABLE public.task_comments REPLICA IDENTITY FULL;

-- Create AI suggested tasks table for principal
CREATE TABLE public.ai_suggested_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES public.institutions(id) NOT NULL,
  suggested_for UUID REFERENCES public.profiles(id) NOT NULL,
  suggested_assignee UUID REFERENCES public.profiles(id),
  wing_id UUID REFERENCES public.wings(id),
  title TEXT NOT NULL,
  description TEXT,
  task_type public.task_type DEFAULT 'general',
  priority INTEGER DEFAULT 2 CHECK (priority >= 1 AND priority <= 3),
  source_type TEXT NOT NULL, -- 'performance', 'evaluation', 'attendance', 'exam_results'
  source_data JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  actioned_at TIMESTAMP WITH TIME ZONE,
  actioned_by UUID REFERENCES public.profiles(id)
);

-- Enable RLS on ai_suggested_tasks
ALTER TABLE public.ai_suggested_tasks ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_suggested_tasks
CREATE POLICY "Users can view their own suggested tasks"
ON public.ai_suggested_tasks FOR SELECT
USING (auth.uid() = suggested_for);

CREATE POLICY "Super admins can view all suggested tasks"
ON public.ai_suggested_tasks FOR SELECT
USING (public.has_super_admin_access(auth.uid()));

CREATE POLICY "School admins can view institution suggested tasks"
ON public.ai_suggested_tasks FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'school_admin'
    AND institution_id = ai_suggested_tasks.institution_id
  )
);

CREATE POLICY "Users can update their own suggested tasks"
ON public.ai_suggested_tasks FOR UPDATE
USING (auth.uid() = suggested_for)
WITH CHECK (auth.uid() = suggested_for);

CREATE POLICY "Edge functions can insert suggested tasks"
ON public.ai_suggested_tasks FOR INSERT
WITH CHECK (true);

-- Create index for efficient queries
CREATE INDEX idx_ai_suggested_tasks_suggested_for ON public.ai_suggested_tasks(suggested_for);
CREATE INDEX idx_ai_suggested_tasks_institution ON public.ai_suggested_tasks(institution_id);
CREATE INDEX idx_ai_suggested_tasks_status ON public.ai_suggested_tasks(status);

-- Add tasks to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_evidence;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;