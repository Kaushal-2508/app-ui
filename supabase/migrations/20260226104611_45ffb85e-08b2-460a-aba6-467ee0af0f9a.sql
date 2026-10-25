
-- Create institution_features table
CREATE TABLE public.institution_features (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  enabled_at TIMESTAMPTZ DEFAULT now(),
  enabled_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, feature_id)
);

-- Enable RLS
ALTER TABLE public.institution_features ENABLE ROW LEVEL SECURITY;

-- Super admins can do everything
CREATE POLICY "Super admins can manage all institution features"
ON public.institution_features
FOR ALL
USING (public.has_super_admin_access(auth.uid()));

-- Institution admins can view their own features
CREATE POLICY "Institution admins can view their features"
ON public.institution_features
FOR SELECT
USING (public.is_institution_admin(auth.uid(), institution_id));

-- All authenticated users can view their institution's features
CREATE POLICY "Users can view own institution features"
ON public.institution_features
FOR SELECT
USING (institution_id = public.get_user_institution(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_institution_features_updated_at
BEFORE UPDATE ON public.institution_features
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: seed all features for existing institutions
DO $$
DECLARE
  v_inst RECORD;
  v_features TEXT[] := ARRAY[
    'dashboard', 'user_management', 'classes',
    'exams', 'syllabus', 'evaluations', 'reports', 'question_bank', 'student_passport',
    'tasks', 'wings', 'proctoring', 'recheck_management', 'attendance', 'fee_management', 'hr_payroll', 'communication', 'circulars', 'ptm_scheduling', 'holiday_calendar',
    'ai_question_generation', 'ocr_scanning', 'billing', 'ai_predictions', 'ai_grading', 'biometric_attendance'
  ];
  v_feature TEXT;
BEGIN
  FOR v_inst IN SELECT id FROM public.institutions LOOP
    FOREACH v_feature IN ARRAY v_features LOOP
      INSERT INTO public.institution_features (institution_id, feature_id, is_enabled)
      VALUES (v_inst.id, v_feature, true)
      ON CONFLICT (institution_id, feature_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
