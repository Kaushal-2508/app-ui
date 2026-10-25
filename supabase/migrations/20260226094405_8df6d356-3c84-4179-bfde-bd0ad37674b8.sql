
-- =============================================
-- HR & Payroll System — 8 Tables + Storage
-- =============================================

-- 1. Staff Salary Structures
CREATE TABLE public.staff_salary_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  basic_salary NUMERIC NOT NULL DEFAULT 0,
  hra NUMERIC NOT NULL DEFAULT 0,
  da NUMERIC NOT NULL DEFAULT 0,
  ta NUMERIC NOT NULL DEFAULT 0,
  medical_allowance NUMERIC NOT NULL DEFAULT 0,
  special_allowance NUMERIC NOT NULL DEFAULT 0,
  other_allowances JSONB DEFAULT '{}',
  pf_percentage NUMERIC NOT NULL DEFAULT 12,
  esi_percentage NUMERIC NOT NULL DEFAULT 0.75,
  professional_tax NUMERIC NOT NULL DEFAULT 0,
  tds_percentage NUMERIC NOT NULL DEFAULT 0,
  other_deductions JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Staff Salary Assignments
CREATE TABLE public.staff_salary_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  salary_structure_id UUID NOT NULL REFERENCES public.staff_salary_structures(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  override_basic NUMERIC,
  override_hra NUMERIC,
  bank_name TEXT,
  bank_account_number TEXT,
  ifsc_code TEXT,
  pan_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Payroll Runs
CREATE TABLE public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','completed','cancelled')),
  run_by UUID REFERENCES public.profiles(id),
  total_gross NUMERIC NOT NULL DEFAULT 0,
  total_deductions NUMERIC NOT NULL DEFAULT 0,
  total_net NUMERIC NOT NULL DEFAULT 0,
  run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, month, year)
);

-- 4. Payroll Entries
CREATE TABLE public.payroll_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  basic_salary NUMERIC NOT NULL DEFAULT 0,
  hra NUMERIC NOT NULL DEFAULT 0,
  da NUMERIC NOT NULL DEFAULT 0,
  ta NUMERIC NOT NULL DEFAULT 0,
  medical_allowance NUMERIC NOT NULL DEFAULT 0,
  special_allowance NUMERIC NOT NULL DEFAULT 0,
  other_allowances JSONB DEFAULT '{}',
  gross_salary NUMERIC NOT NULL DEFAULT 0,
  pf_deduction NUMERIC NOT NULL DEFAULT 0,
  esi_deduction NUMERIC NOT NULL DEFAULT 0,
  professional_tax NUMERIC NOT NULL DEFAULT 0,
  tds_deduction NUMERIC NOT NULL DEFAULT 0,
  other_deductions JSONB DEFAULT '{}',
  attendance_days INTEGER NOT NULL DEFAULT 0,
  working_days INTEGER NOT NULL DEFAULT 0,
  attendance_adjustment NUMERIC NOT NULL DEFAULT 0,
  net_salary NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','held')),
  paid_at TIMESTAMPTZ,
  UNIQUE(payroll_run_id, user_id)
);

-- 5. Staff Leave Requests
CREATE TABLE public.staff_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual','sick','casual','maternity','paternity','unpaid','other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Staff Leave Balances
CREATE TABLE public.staff_leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  annual_total INTEGER NOT NULL DEFAULT 12,
  annual_used INTEGER NOT NULL DEFAULT 0,
  sick_total INTEGER NOT NULL DEFAULT 10,
  sick_used INTEGER NOT NULL DEFAULT 0,
  casual_total INTEGER NOT NULL DEFAULT 8,
  casual_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, user_id, academic_year)
);

-- 7. Staff Documents
CREATE TABLE public.staff_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('id_proof','certificate','contract','pan_card','aadhar','other')),
  document_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES public.profiles(id)
);

-- 8. Holiday Calendar
CREATE TABLE public.holiday_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'school' CHECK (type IN ('national','state','school','optional')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id, holiday_date)
);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('staff-documents', 'staff-documents', false)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Updated_at triggers
-- =============================================
CREATE TRIGGER update_staff_salary_structures_updated_at BEFORE UPDATE ON public.staff_salary_structures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_staff_salary_assignments_updated_at BEFORE UPDATE ON public.staff_salary_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_staff_leave_requests_updated_at BEFORE UPDATE ON public.staff_leave_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_staff_leave_balances_updated_at BEFORE UPDATE ON public.staff_leave_balances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- RLS Policies
-- =============================================

-- staff_salary_structures
ALTER TABLE public.staff_salary_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access salary structures" ON public.staff_salary_structures FOR ALL USING (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "Staff view active salary structures" ON public.staff_salary_structures FOR SELECT USING (
  institution_id = public.get_user_institution(auth.uid()) AND is_active = true
);

-- staff_salary_assignments
ALTER TABLE public.staff_salary_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access salary assignments" ON public.staff_salary_assignments FOR ALL USING (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "Staff view own salary assignment" ON public.staff_salary_assignments FOR SELECT USING (user_id = auth.uid());

-- payroll_runs
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access payroll runs" ON public.payroll_runs FOR ALL USING (public.is_institution_admin(auth.uid(), institution_id));

-- payroll_entries
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access payroll entries" ON public.payroll_entries FOR ALL USING (
  EXISTS (SELECT 1 FROM public.payroll_runs pr WHERE pr.id = payroll_run_id AND public.is_institution_admin(auth.uid(), pr.institution_id))
);
CREATE POLICY "Staff view own payroll entries" ON public.payroll_entries FOR SELECT USING (user_id = auth.uid());

-- staff_leave_requests
ALTER TABLE public.staff_leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access staff leave requests" ON public.staff_leave_requests FOR ALL USING (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "Staff manage own leave requests" ON public.staff_leave_requests FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- staff_leave_balances
ALTER TABLE public.staff_leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access staff leave balances" ON public.staff_leave_balances FOR ALL USING (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "Staff view own leave balance" ON public.staff_leave_balances FOR SELECT USING (user_id = auth.uid());

-- staff_documents
ALTER TABLE public.staff_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access staff documents" ON public.staff_documents FOR ALL USING (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "Staff view own documents" ON public.staff_documents FOR SELECT USING (user_id = auth.uid());

-- holiday_calendar
ALTER TABLE public.holiday_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access holiday calendar" ON public.holiday_calendar FOR ALL USING (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "Staff view holidays" ON public.holiday_calendar FOR SELECT USING (institution_id = public.get_user_institution(auth.uid()));

-- Storage policies for staff-documents bucket
CREATE POLICY "Admins upload staff documents" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'staff-documents' AND public.is_institution_admin(auth.uid(), (public.get_user_institution(auth.uid())))
);
CREATE POLICY "Admins read staff documents" ON storage.objects FOR SELECT USING (
  bucket_id = 'staff-documents' AND public.is_institution_admin(auth.uid(), (public.get_user_institution(auth.uid())))
);
CREATE POLICY "Staff read own documents" ON storage.objects FOR SELECT USING (
  bucket_id = 'staff-documents' AND auth.uid()::text = (storage.foldername(name))[1]
);
CREATE POLICY "Admins delete staff documents" ON storage.objects FOR DELETE USING (
  bucket_id = 'staff-documents' AND public.is_institution_admin(auth.uid(), (public.get_user_institution(auth.uid())))
);
