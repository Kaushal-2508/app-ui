-- Add password management columns to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS password_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_password_change TIMESTAMP WITH TIME ZONE;

-- Add employee to app_role enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'employee' AND enumtypid = 'public.app_role'::regtype) THEN
        ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'employee';
    END IF;
END$$;

-- Create employee_levels table for employee hierarchy
CREATE TABLE IF NOT EXISTS public.employee_levels (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    level_name TEXT NOT NULL,
    level_number INTEGER NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default employee levels
INSERT INTO public.employee_levels (level_name, level_number, description, permissions)
VALUES 
    ('Level 1', 1, 'Basic access - Limited scope', '{"can_view_reports": true, "can_manage_tasks": false}'),
    ('Level 2', 2, 'Standard access - Medium scope', '{"can_view_reports": true, "can_manage_tasks": true, "can_create_exams": false}'),
    ('Level 3', 3, 'Advanced access - Large scope', '{"can_view_reports": true, "can_manage_tasks": true, "can_create_exams": true}')
ON CONFLICT DO NOTHING;

-- Add employee_level_id to user_roles for employees
ALTER TABLE public.user_roles
ADD COLUMN IF NOT EXISTS employee_level_id UUID REFERENCES public.employee_levels(id);

-- Create wings table for coordinator assignment
CREATE TABLE IF NOT EXISTS public.wings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(institution_id, name)
);

-- Create wing_assignments table
CREATE TABLE IF NOT EXISTS public.wing_assignments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    wing_id UUID NOT NULL REFERENCES public.wings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    assigned_by UUID REFERENCES public.profiles(id),
    UNIQUE(wing_id, user_id)
);

-- Enable RLS on new tables
ALTER TABLE public.employee_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wing_assignments ENABLE ROW LEVEL SECURITY;

-- RLS policies for employee_levels
CREATE POLICY "Super admins can manage employee levels"
ON public.employee_levels FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Everyone can view employee levels"
ON public.employee_levels FOR SELECT
USING (true);

-- RLS policies for wings
CREATE POLICY "Super admins can manage all wings"
ON public.wings FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "School admins can manage their institution wings"
ON public.wings FOR ALL
USING (has_role_at_institution(auth.uid(), 'school_admin'::app_role, institution_id));

CREATE POLICY "Users can view wings in their institution"
ON public.wings FOR SELECT
USING (institution_id = get_user_institution(auth.uid()));

-- RLS policies for wing_assignments
CREATE POLICY "Super admins can manage all wing assignments"
ON public.wing_assignments FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "School admins can manage wing assignments in their institution"
ON public.wing_assignments FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM wings w
        WHERE w.id = wing_assignments.wing_id
        AND has_role_at_institution(auth.uid(), 'school_admin'::app_role, w.institution_id)
    )
);

CREATE POLICY "Users can view their own wing assignments"
ON public.wing_assignments FOR SELECT
USING (user_id = auth.uid());

-- Add Grade 0 to grade_levels if not exists
INSERT INTO public.grade_levels (grade_name, grade_number, display_order, is_active)
VALUES ('Grade 0 (Pre-School)', 0, -1, true)
ON CONFLICT DO NOTHING;

-- Create study_materials table
CREATE TABLE IF NOT EXISTS public.study_materials (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES public.subjects(id),
    grade_level_id UUID REFERENCES public.grade_levels(id),
    title TEXT NOT NULL,
    description TEXT,
    publisher TEXT,
    material_type TEXT DEFAULT 'book', -- book, pdf, link, video
    file_url TEXT,
    external_link TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on study_materials
ALTER TABLE public.study_materials ENABLE ROW LEVEL SECURITY;

-- RLS policies for study_materials
CREATE POLICY "Super admins can manage all study materials"
ON public.study_materials FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "School admins can manage their institution study materials"
ON public.study_materials FOR ALL
USING (has_role_at_institution(auth.uid(), 'school_admin'::app_role, institution_id));

CREATE POLICY "Teachers can create study materials"
ON public.study_materials FOR INSERT
WITH CHECK (
    institution_id = get_user_institution(auth.uid())
    AND has_role(auth.uid(), 'teacher'::app_role)
    AND created_by = auth.uid()
);

CREATE POLICY "Users can view study materials in their institution"
ON public.study_materials FOR SELECT
USING (institution_id = get_user_institution(auth.uid()));