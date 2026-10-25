
-- ============================================================
-- FEE MANAGEMENT SYSTEM - Complete Database Schema
-- ============================================================

-- 1. FEE CATEGORIES
CREATE TABLE public.fee_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all fee categories"
  ON public.fee_categories FOR ALL
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins can manage fee categories"
  ON public.fee_categories FOR ALL
  USING (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Institution members can view fee categories"
  ON public.fee_categories FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

-- 2. FEE STRUCTURES
CREATE TABLE public.fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  fee_category_id UUID NOT NULL REFERENCES public.fee_categories(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  academic_year TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'annual' CHECK (frequency IN ('annual', 'term', 'monthly', 'one_time')),
  due_day INTEGER,
  late_fee_amount NUMERIC NOT NULL DEFAULT 0,
  late_fee_type TEXT NOT NULL DEFAULT 'fixed' CHECK (late_fee_type IN ('fixed', 'percentage')),
  grace_period_days INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all fee structures"
  ON public.fee_structures FOR ALL
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins can manage fee structures"
  ON public.fee_structures FOR ALL
  USING (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Institution members can view fee structures"
  ON public.fee_structures FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE TRIGGER update_fee_structures_updated_at
  BEFORE UPDATE ON public.fee_structures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. STUDENT FEE ASSIGNMENTS
CREATE TABLE public.student_fee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fee_structure_id UUID NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  discount_reason TEXT,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'waived', 'cancelled')),
  assigned_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.student_fee_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all fee assignments"
  ON public.student_fee_assignments FOR ALL
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins can manage fee assignments"
  ON public.student_fee_assignments FOR ALL
  USING (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students can view own fee assignments"
  ON public.student_fee_assignments FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Teachers can view assigned class students fees"
  ON public.student_fee_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.class_assignments ca
      JOIN public.class_assignments sa ON sa.class_id = ca.class_id
      WHERE ca.user_id = auth.uid()
        AND ca.role IN ('teacher', 'coordinator')
        AND sa.user_id = student_fee_assignments.student_id
        AND sa.role = 'student'
    )
  );

-- 4. FEE INSTALLMENTS
CREATE TABLE public.fee_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.student_fee_assignments(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'partially_paid', 'waived')),
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  paid_date TIMESTAMPTZ,
  late_fee_applied NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT,
  transaction_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all installments"
  ON public.fee_installments FOR ALL
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins can manage installments"
  ON public.fee_installments FOR ALL
  USING (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students can view own installments"
  ON public.fee_installments FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Teachers can view assigned class students installments"
  ON public.fee_installments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.class_assignments ca
      JOIN public.class_assignments sa ON sa.class_id = ca.class_id
      WHERE ca.user_id = auth.uid()
        AND ca.role IN ('teacher', 'coordinator')
        AND sa.user_id = fee_installments.student_id
        AND sa.role = 'student'
    )
  );

CREATE TRIGGER update_fee_installments_updated_at
  BEFORE UPDATE ON public.fee_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. FEE RECEIPTS
CREATE TABLE public.fee_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES public.fee_installments(id) ON DELETE SET NULL,
  receipt_number TEXT NOT NULL UNIQUE,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT,
  received_by UUID REFERENCES public.profiles(id),
  receipt_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all fee receipts"
  ON public.fee_receipts FOR ALL
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins can manage fee receipts"
  ON public.fee_receipts FOR ALL
  USING (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students can view own fee receipts"
  ON public.fee_receipts FOR SELECT
  USING (student_id = auth.uid());

-- 6. FEE CONCESSIONS
CREATE TABLE public.fee_concessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  concession_type TEXT NOT NULL CHECK (concession_type IN ('scholarship', 'sibling_discount', 'staff_child', 'financial_aid', 'other')),
  percentage NUMERIC,
  fixed_amount NUMERIC,
  reason TEXT,
  approved_by UUID REFERENCES public.profiles(id),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_concessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all concessions"
  ON public.fee_concessions FOR ALL
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins can manage concessions"
  ON public.fee_concessions FOR ALL
  USING (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students can view own concessions"
  ON public.fee_concessions FOR SELECT
  USING (student_id = auth.uid());

-- ============================================================
-- DATABASE FUNCTIONS
-- ============================================================

-- Generate sequential fee receipt numbers per institution per month
CREATE OR REPLACE FUNCTION public.generate_fee_receipt_number(_institution_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT := 'FEE';
  v_year TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  v_month TEXT := LPAD(EXTRACT(MONTH FROM CURRENT_DATE)::TEXT, 2, '0');
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count
  FROM public.fee_receipts
  WHERE institution_id = _institution_id
    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
    AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE);
  
  RETURN v_prefix || '-' || v_year || v_month || '-' || LPAD(v_count::TEXT, 5, '0');
END;
$$;

-- Apply late fees to overdue installments for an institution
CREATE OR REPLACE FUNCTION public.apply_late_fees(_institution_id uuid)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_installment RECORD;
  v_late_fee NUMERIC;
BEGIN
  FOR v_installment IN
    SELECT fi.id, fi.amount, fi.due_date, fi.late_fee_applied,
           fs.late_fee_amount, fs.late_fee_type, fs.grace_period_days
    FROM public.fee_installments fi
    JOIN public.student_fee_assignments sfa ON sfa.id = fi.assignment_id
    JOIN public.fee_structures fs ON fs.id = sfa.fee_structure_id
    WHERE fi.institution_id = _institution_id
      AND fi.status IN ('pending', 'overdue', 'partially_paid')
      AND fi.due_date + fs.grace_period_days < CURRENT_DATE
      AND fi.late_fee_applied = 0
      AND fs.late_fee_amount > 0
  LOOP
    v_late_fee := CASE v_installment.late_fee_type
      WHEN 'percentage' THEN v_installment.amount * v_installment.late_fee_amount / 100
      ELSE v_installment.late_fee_amount
    END;

    UPDATE public.fee_installments
    SET late_fee_applied = v_late_fee,
        status = 'overdue'
    WHERE id = v_installment.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Get student fee summary
CREATE OR REPLACE FUNCTION public.get_student_fee_summary(_student_id uuid)
RETURNS TABLE(
  total_fees NUMERIC,
  total_paid NUMERIC,
  total_pending NUMERIC,
  total_overdue NUMERIC,
  total_late_fees NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(fi.amount + fi.late_fee_applied), 0) as total_fees,
    COALESCE(SUM(fi.paid_amount), 0) as total_paid,
    COALESCE(SUM(CASE WHEN fi.status IN ('pending', 'partially_paid') THEN fi.amount + fi.late_fee_applied - fi.paid_amount ELSE 0 END), 0) as total_pending,
    COALESCE(SUM(CASE WHEN fi.status = 'overdue' THEN fi.amount + fi.late_fee_applied - fi.paid_amount ELSE 0 END), 0) as total_overdue,
    COALESCE(SUM(fi.late_fee_applied), 0) as total_late_fees
  FROM public.fee_installments fi
  JOIN public.student_fee_assignments sfa ON sfa.id = fi.assignment_id
  WHERE fi.student_id = _student_id
    AND sfa.status = 'active';
$$;

-- Get institution fee analytics
CREATE OR REPLACE FUNCTION public.get_institution_fee_analytics(_institution_id uuid)
RETURNS TABLE(
  total_expected NUMERIC,
  total_collected NUMERIC,
  total_pending NUMERIC,
  total_overdue NUMERIC,
  collection_rate NUMERIC,
  defaulter_count BIGINT,
  total_students BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(fi.amount + fi.late_fee_applied), 0) as total_expected,
    COALESCE(SUM(fi.paid_amount), 0) as total_collected,
    COALESCE(SUM(CASE WHEN fi.status IN ('pending', 'partially_paid') THEN fi.amount + fi.late_fee_applied - fi.paid_amount ELSE 0 END), 0) as total_pending,
    COALESCE(SUM(CASE WHEN fi.status = 'overdue' THEN fi.amount + fi.late_fee_applied - fi.paid_amount ELSE 0 END), 0) as total_overdue,
    CASE WHEN SUM(fi.amount + fi.late_fee_applied) > 0
      THEN ROUND(SUM(fi.paid_amount) * 100.0 / SUM(fi.amount + fi.late_fee_applied), 1)
      ELSE 0
    END as collection_rate,
    COUNT(DISTINCT CASE WHEN fi.status = 'overdue' THEN fi.student_id END) as defaulter_count,
    COUNT(DISTINCT fi.student_id) as total_students
  FROM public.fee_installments fi
  JOIN public.student_fee_assignments sfa ON sfa.id = fi.assignment_id
  WHERE fi.institution_id = _institution_id
    AND sfa.status = 'active';
$$;

-- Indexes for performance
CREATE INDEX idx_fee_categories_institution ON public.fee_categories(institution_id);
CREATE INDEX idx_fee_structures_institution ON public.fee_structures(institution_id);
CREATE INDEX idx_fee_structures_category ON public.fee_structures(fee_category_id);
CREATE INDEX idx_fee_structures_class ON public.fee_structures(class_id);
CREATE INDEX idx_student_fee_assignments_student ON public.student_fee_assignments(student_id);
CREATE INDEX idx_student_fee_assignments_institution ON public.student_fee_assignments(institution_id);
CREATE INDEX idx_fee_installments_student ON public.fee_installments(student_id);
CREATE INDEX idx_fee_installments_institution ON public.fee_installments(institution_id);
CREATE INDEX idx_fee_installments_status ON public.fee_installments(status);
CREATE INDEX idx_fee_installments_due_date ON public.fee_installments(due_date);
CREATE INDEX idx_fee_receipts_student ON public.fee_receipts(student_id);
CREATE INDEX idx_fee_receipts_institution ON public.fee_receipts(institution_id);
CREATE INDEX idx_fee_concessions_student ON public.fee_concessions(student_id);
CREATE INDEX idx_fee_concessions_institution ON public.fee_concessions(institution_id);
