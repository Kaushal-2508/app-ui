-- Create payments table for tracking institution payments
CREATE TABLE IF NOT EXISTS public.payment_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    payment_type TEXT NOT NULL DEFAULT 'subscription' CHECK (payment_type IN ('subscription', 'one_time', 'refund')),
    description TEXT,
    invoice_number TEXT,
    payment_date TIMESTAMP WITH TIME ZONE,
    due_date TIMESTAMP WITH TIME ZONE,
    payment_method TEXT,
    transaction_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create institution_subscriptions table
CREATE TABLE IF NOT EXISTS public.institution_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL UNIQUE,
    plan_name TEXT NOT NULL DEFAULT 'basic',
    plan_type TEXT NOT NULL DEFAULT 'monthly' CHECK (plan_type IN ('monthly', 'yearly', 'custom')),
    monthly_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'past_due', 'cancelled')),
    billing_cycle_start DATE,
    next_billing_date DATE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    cancelled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create system_audit_logs table for comprehensive audit trail
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    entity_name TEXT,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for audit logs queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.system_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.system_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.system_audit_logs(created_at DESC);

-- Create index for payment records
CREATE INDEX IF NOT EXISTS idx_payment_records_institution ON public.payment_records(institution_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_status ON public.payment_records(status);

-- Enable RLS
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for payment_records
CREATE POLICY "Super admins can manage all payments"
ON public.payment_records FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can view their institution payments"
ON public.payment_records FOR SELECT
TO authenticated
USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
);

-- RLS policies for institution_subscriptions
CREATE POLICY "Super admins can manage all subscriptions"
ON public.institution_subscriptions FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can view their subscription"
ON public.institution_subscriptions FOR SELECT
TO authenticated
USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
);

-- RLS policies for system_audit_logs
CREATE POLICY "Super admins can view all audit logs"
ON public.system_audit_logs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins can create audit logs"
ON public.system_audit_logs FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can view their institution audit logs"
ON public.system_audit_logs FOR SELECT
TO authenticated
USING (
    public.has_role(auth.uid(), 'school_admin')
    AND (
        metadata->>'institution_id' = public.get_user_institution(auth.uid())::TEXT
        OR actor_id = auth.uid()
    )
);

-- Trigger for updated_at
CREATE TRIGGER update_payment_records_updated_at
BEFORE UPDATE ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_institution_subscriptions_updated_at
BEFORE UPDATE ON public.institution_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to log audit events
CREATE OR REPLACE FUNCTION public.log_audit_event(
    _action TEXT,
    _entity_type TEXT,
    _entity_id UUID DEFAULT NULL,
    _entity_name TEXT DEFAULT NULL,
    _old_values JSONB DEFAULT NULL,
    _new_values JSONB DEFAULT NULL,
    _metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO public.system_audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        entity_name,
        old_values,
        new_values,
        metadata
    ) VALUES (
        auth.uid(),
        _action,
        _entity_type,
        _entity_id,
        _entity_name,
        _old_values,
        _new_values,
        _metadata
    ) RETURNING id INTO v_audit_id;
    
    RETURN v_audit_id;
END;
$$;