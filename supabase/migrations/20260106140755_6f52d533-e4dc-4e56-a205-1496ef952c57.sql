-- 1. Add password_expires_at column to profiles for 7-day expiry tracking
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS password_expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '7 days'),
ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- 2. Create payment_receipts table for individual receipt generation
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES public.payment_records(id),
  receipt_number TEXT NOT NULL UNIQUE,
  amount DECIMAL(10,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method TEXT,
  receipt_data JSONB,
  receipt_file_url TEXT,
  generated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Create subscription_alerts table for billing alerts
CREATE TABLE IF NOT EXISTS public.subscription_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('payment_due', 'payment_overdue', 'expiring_soon', 'expired', 'quota_exceeded')),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  is_dismissed BOOLEAN DEFAULT false,
  due_date DATE,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Add multi-admin support flag to institutions
ALTER TABLE public.institutions
ADD COLUMN IF NOT EXISTS max_admins INTEGER DEFAULT 3;

-- 5. Update question_bank to auto-approve questions (remove approval dependency)
ALTER TABLE public.question_bank 
ALTER COLUMN is_approved SET DEFAULT true;

-- 6. Add employee_level_id to user_roles for employee-level based access
ALTER TABLE public.user_roles
ADD COLUMN IF NOT EXISTS employee_level_id UUID REFERENCES public.employee_levels(id);

-- 7. Add super_admin_access flag to employee_levels
ALTER TABLE public.employee_levels
ADD COLUMN IF NOT EXISTS super_admin_access BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS can_manage_institutions BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS can_manage_billing BOOLEAN DEFAULT false;

-- 8. Enable RLS on new tables
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_alerts ENABLE ROW LEVEL SECURITY;

-- 9. Create RLS policies for payment_receipts
CREATE POLICY "Super admins can view all receipts"
ON public.payment_receipts FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can view their institution receipts"
ON public.payment_receipts FOR SELECT
TO authenticated
USING (
  institution_id IN (
    SELECT institution_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Super admins can create receipts"
ON public.payment_receipts FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 10. Create RLS policies for subscription_alerts
CREATE POLICY "Super admins can view all alerts"
ON public.subscription_alerts FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can view their institution alerts"
ON public.subscription_alerts FOR SELECT
TO authenticated
USING (
  institution_id IN (
    SELECT institution_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Super admins can manage alerts"
ON public.subscription_alerts FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can update their alerts"
ON public.subscription_alerts FOR UPDATE
TO authenticated
USING (
  institution_id IN (
    SELECT institution_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- 11. Create function to check password expiry
CREATE OR REPLACE FUNCTION public.check_password_expiry(_user_id uuid)
RETURNS TABLE(is_expired boolean, expires_at timestamp with time zone, days_remaining integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    COALESCE(password_expires_at < now(), false) as is_expired,
    password_expires_at as expires_at,
    GREATEST(0, EXTRACT(DAY FROM password_expires_at - now())::integer) as days_remaining
  FROM public.profiles
  WHERE id = _user_id
$$;

-- 12. Create function to reset password expiry (call after password change)
CREATE OR REPLACE FUNCTION public.reset_password_expiry(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET 
    password_expires_at = now() + INTERVAL '7 days',
    password_set_at = now(),
    must_reset_password = false
  WHERE id = _user_id;
END;
$$;

-- 13. Create function to generate receipt number
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix TEXT := 'RCP';
  v_year TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  v_month TEXT := LPAD(EXTRACT(MONTH FROM CURRENT_DATE)::TEXT, 2, '0');
  v_count INTEGER;
  v_receipt_number TEXT;
BEGIN
  -- Count receipts this month
  SELECT COUNT(*) + 1 INTO v_count
  FROM public.payment_receipts
  WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
    AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE);
  
  v_receipt_number := v_prefix || '-' || v_year || v_month || '-' || LPAD(v_count::TEXT, 5, '0');
  RETURN v_receipt_number;
END;
$$;

-- 14. Create function to check employee level super admin access
CREATE OR REPLACE FUNCTION public.has_super_admin_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    LEFT JOIN public.employee_levels el ON el.id = ur.employee_level_id
    WHERE ur.user_id = _user_id 
    AND (
      ur.role = 'super_admin' 
      OR el.super_admin_access = true
    )
  )
$$;

-- 15. Create index for faster alert queries
CREATE INDEX IF NOT EXISTS idx_subscription_alerts_institution ON public.subscription_alerts(institution_id);
CREATE INDEX IF NOT EXISTS idx_subscription_alerts_type ON public.subscription_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_institution ON public.payment_receipts(institution_id);