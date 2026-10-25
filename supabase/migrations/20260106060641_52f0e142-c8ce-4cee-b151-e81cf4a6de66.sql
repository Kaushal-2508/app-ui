-- 1. Add onboarding tracking to user_preferences
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS tour_steps_completed jsonb DEFAULT '[]';

-- 2. Create parent-student linking table
CREATE TABLE IF NOT EXISTS public.parent_student_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  student_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  relationship text DEFAULT 'parent',
  verified boolean DEFAULT false,
  verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(parent_id, student_id)
);

-- Enable RLS on parent_student_links
ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;

-- Parents can view their own links
CREATE POLICY "Parents can view their own student links"
ON public.parent_student_links
FOR SELECT
USING (auth.uid() = parent_id);

-- Parents can create links (pending verification)
CREATE POLICY "Parents can create student links"
ON public.parent_student_links
FOR INSERT
WITH CHECK (auth.uid() = parent_id);

-- School admins can manage links for their institution using user_roles table
CREATE POLICY "School admins can manage parent student links"
ON public.parent_student_links
FOR ALL
USING (
  public.has_role(auth.uid(), 'school_admin') OR public.has_role(auth.uid(), 'super_admin')
);

-- 3. Create notification queue for async emails
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  notification_type text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  priority integer DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  scheduled_for timestamp with time zone DEFAULT now(),
  sent_at timestamp with time zone,
  attempts integer DEFAULT 0,
  last_attempt_at timestamp with time zone,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on notification_queue
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

-- Only super admins can view notification queue
CREATE POLICY "Super admins can view notification queue"
ON public.notification_queue
FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

-- System can insert notifications (via service role in edge functions)
CREATE POLICY "Allow insert for authenticated users"
ON public.notification_queue
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Create index for processing pending notifications
CREATE INDEX IF NOT EXISTS idx_notification_queue_pending 
ON public.notification_queue(status, scheduled_for) 
WHERE status = 'pending';

-- Create index for recipient lookups
CREATE INDEX IF NOT EXISTS idx_notification_queue_recipient 
ON public.notification_queue(recipient_id);

-- Add trigger for updated_at on parent_student_links
CREATE TRIGGER update_parent_student_links_updated_at
BEFORE UPDATE ON public.parent_student_links
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add trigger for updated_at on notification_queue
CREATE TRIGGER update_notification_queue_updated_at
BEFORE UPDATE ON public.notification_queue
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();