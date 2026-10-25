-- Global AI Configuration (universal for all institutions)
CREATE TABLE public.global_ai_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- AI Usage Quotas (institution-level limits)
CREATE TABLE public.ai_usage_quotas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE,
  daily_question_limit INTEGER NOT NULL DEFAULT 50,
  daily_token_limit INTEGER NOT NULL DEFAULT 100000,
  monthly_token_limit INTEGER NOT NULL DEFAULT 2000000,
  question_generation_enabled BOOLEAN NOT NULL DEFAULT true,
  ocr_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(institution_id)
);

-- Teacher-level quota overrides
CREATE TABLE public.teacher_ai_quotas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  daily_question_limit INTEGER,
  daily_token_limit INTEGER,
  question_generation_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(teacher_id)
);

-- AI Usage Logs (immutable audit trail)
CREATE TABLE public.ai_usage_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID REFERENCES public.institutions(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  service_type TEXT NOT NULL CHECK (service_type IN ('question_generation', 'ocr')),
  tokens_used INTEGER NOT NULL DEFAULT 0,
  questions_generated INTEGER NOT NULL DEFAULT 0,
  request_status TEXT NOT NULL CHECK (request_status IN ('success', 'failed', 'quota_exceeded')),
  error_message TEXT,
  request_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- AI Config Changes Audit Log
CREATE TABLE public.ai_config_changes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  change_type TEXT NOT NULL,
  config_key TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Daily/Monthly usage tracking
CREATE TABLE public.ai_daily_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  questions_generated INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  UNIQUE(institution_id, user_id, usage_date)
);

CREATE TABLE public.ai_monthly_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID REFERENCES public.institutions(id) ON DELETE CASCADE,
  usage_month DATE NOT NULL,
  tokens_used BIGINT NOT NULL DEFAULT 0,
  UNIQUE(institution_id, usage_month)
);

-- Enable RLS
ALTER TABLE public.global_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_ai_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_config_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_monthly_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies using user_roles table
CREATE POLICY "Super admins can manage global AI config"
  ON public.global_ai_config FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "Super admins can manage all quotas"
  ON public.ai_usage_quotas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "School admins can view their institution quotas"
  ON public.ai_usage_quotas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'school_admin'
      AND user_roles.institution_id = ai_usage_quotas.institution_id
    )
  );

CREATE POLICY "Super admins can manage teacher quotas"
  ON public.teacher_ai_quotas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "Teachers can view their own quotas"
  ON public.teacher_ai_quotas FOR SELECT
  USING (teacher_id = auth.uid());

CREATE POLICY "Super admins can view all usage logs"
  ON public.ai_usage_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "School admins can view institution logs"
  ON public.ai_usage_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'school_admin'
      AND user_roles.institution_id = ai_usage_logs.institution_id
    )
  );

CREATE POLICY "Users can view their own logs"
  ON public.ai_usage_logs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Super admins can view config changes"
  ON public.ai_config_changes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "Super admins can view all daily usage"
  ON public.ai_daily_usage FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

CREATE POLICY "Users can view their own daily usage"
  ON public.ai_daily_usage FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Super admins can view all monthly usage"
  ON public.ai_monthly_usage FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'super_admin'
    )
  );

-- Insert default global config entries
INSERT INTO public.global_ai_config (config_key, config_value, is_enabled, description) VALUES
  ('OPENAI_API_KEY', NULL, true, 'OpenAI API key for question generation'),
  ('GOOGLE_GEMINI_API_KEY', NULL, true, 'Google Gemini API key for OCR processing'),
  ('DEFAULT_AI_MODEL', 'gpt-4o-mini', true, 'Default AI model for question generation');

-- Indexes
CREATE INDEX idx_ai_usage_logs_institution ON public.ai_usage_logs(institution_id);
CREATE INDEX idx_ai_usage_logs_user ON public.ai_usage_logs(user_id);
CREATE INDEX idx_ai_usage_logs_created ON public.ai_usage_logs(created_at);
CREATE INDEX idx_ai_daily_usage_date ON public.ai_daily_usage(usage_date);
CREATE INDEX idx_ai_monthly_usage_month ON public.ai_monthly_usage(usage_month);

-- Triggers for updated_at
CREATE TRIGGER update_global_ai_config_updated_at
  BEFORE UPDATE ON public.global_ai_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_usage_quotas_updated_at
  BEFORE UPDATE ON public.ai_usage_quotas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_teacher_ai_quotas_updated_at
  BEFORE UPDATE ON public.teacher_ai_quotas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();