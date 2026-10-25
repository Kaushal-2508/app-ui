-- Create subscription_alerts table for billing alerts
CREATE TABLE IF NOT EXISTS public.subscription_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('payment_due', 'subscription_expiring', 'payment_overdue')),
  due_date DATE NOT NULL,
  amount DECIMAL(10,2),
  is_acknowledged BOOLEAN DEFAULT false,
  acknowledged_by UUID REFERENCES public.profiles(id),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  sent_to_school BOOLEAN DEFAULT false,
  sent_to_internal BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subscription_alerts ENABLE ROW LEVEL SECURITY;

-- RLS policies for subscription_alerts
CREATE POLICY "Super admins can manage all alerts"
ON public.subscription_alerts
FOR ALL
TO authenticated
USING (public.has_super_admin_access(auth.uid()));

CREATE POLICY "School admins can view their alerts"
ON public.subscription_alerts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'school_admin'
    AND ur.institution_id = subscription_alerts.institution_id
  )
);

-- Create school_custom_topics table for local topic repository
CREATE TABLE IF NOT EXISTS public.school_custom_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.universal_subjects(id),
  grade_level_id UUID REFERENCES public.grade_levels(id),
  topic_name TEXT NOT NULL,
  chapter_name TEXT,
  chapter_number INTEGER,
  description TEXT,
  keywords TEXT[],
  created_by UUID REFERENCES public.profiles(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.school_custom_topics ENABLE ROW LEVEL SECURITY;

-- RLS policies for school_custom_topics
CREATE POLICY "Users can view their institution topics"
ON public.school_custom_topics
FOR SELECT
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

CREATE POLICY "Teachers and coordinators can create topics"
ON public.school_custom_topics
FOR INSERT
TO authenticated
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('teacher', 'coordinator', 'school_admin')
  )
);

CREATE POLICY "Super admins can manage all topics"
ON public.school_custom_topics
FOR ALL
TO authenticated
USING (public.has_super_admin_access(auth.uid()));

-- Function to generate subscription alerts
CREATE OR REPLACE FUNCTION public.generate_subscription_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription RECORD;
BEGIN
  FOR v_subscription IN 
    SELECT id, institution_id, next_billing_date, monthly_amount, status
    FROM public.institution_subscriptions
    WHERE status = 'active'
    AND next_billing_date IS NOT NULL
  LOOP
    -- Payment due alert (7 days before)
    IF v_subscription.next_billing_date - INTERVAL '7 days' <= CURRENT_DATE 
       AND v_subscription.next_billing_date > CURRENT_DATE THEN
      INSERT INTO public.subscription_alerts (institution_id, alert_type, due_date, amount)
      VALUES (v_subscription.institution_id, 'payment_due', v_subscription.next_billing_date, v_subscription.monthly_amount)
      ON CONFLICT DO NOTHING;
    END IF;
    
    -- Overdue alert
    IF v_subscription.next_billing_date < CURRENT_DATE THEN
      INSERT INTO public.subscription_alerts (institution_id, alert_type, due_date, amount)
      VALUES (v_subscription.institution_id, 'payment_overdue', v_subscription.next_billing_date, v_subscription.monthly_amount)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- Update question_bank default for is_approved to true (remove approval flow)
ALTER TABLE public.question_bank 
ALTER COLUMN is_approved SET DEFAULT true;

-- Update existing unapproved questions to approved
UPDATE public.question_bank SET is_approved = true WHERE is_approved = false;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_subscription_alerts_institution ON public.subscription_alerts(institution_id);
CREATE INDEX IF NOT EXISTS idx_subscription_alerts_due_date ON public.subscription_alerts(due_date);
CREATE INDEX IF NOT EXISTS idx_school_custom_topics_institution ON public.school_custom_topics(institution_id);
CREATE INDEX IF NOT EXISTS idx_school_custom_topics_subject ON public.school_custom_topics(subject_id);