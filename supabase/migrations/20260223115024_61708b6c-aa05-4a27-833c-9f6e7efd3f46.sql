
-- Create reported_issues table
CREATE TABLE public.reported_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reporter_name text,
  reporter_email text,
  reporter_role text,
  institution_name text,
  institution_id uuid,
  classes_assigned text,
  subject text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reported_issues ENABLE ROW LEVEL SECURITY;

-- Users can insert their own reports
CREATE POLICY "Users can insert own reports"
ON public.reported_issues FOR INSERT
TO authenticated
WITH CHECK (reporter_id = auth.uid());

-- Users can view their own reports
CREATE POLICY "Users can view own reports"
ON public.reported_issues FOR SELECT
TO authenticated
USING (reporter_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- Super admins can update all reports
CREATE POLICY "Super admins can update all reports"
ON public.reported_issues FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_reported_issues_updated_at
BEFORE UPDATE ON public.reported_issues
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
