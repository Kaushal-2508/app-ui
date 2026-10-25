
-- Create student_remarks table
CREATE TABLE public.student_remarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id),
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  exam_id UUID REFERENCES public.exams(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.universal_subjects(id),
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('exam', 'topic', 'behaviour', 'improvement', 'general')),
  remark_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.student_remarks ENABLE ROW LEVEL SECURITY;

-- Teachers can insert remarks for students in their classes
CREATE POLICY "Teachers can create remarks"
  ON public.student_remarks FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid());

-- Teachers can view their own remarks
CREATE POLICY "Teachers view own remarks"
  ON public.student_remarks FOR SELECT TO authenticated
  USING (teacher_id = auth.uid());

-- Students can view their own remarks
CREATE POLICY "Students view own remarks"
  ON public.student_remarks FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- School admins can view all remarks in their institution
CREATE POLICY "Admins view institution remarks"
  ON public.student_remarks FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

-- Super admins can view all remarks
CREATE POLICY "Super admins view all remarks"
  ON public.student_remarks FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Coordinators can view remarks for students in their wing classes
CREATE POLICY "Coordinators view wing remarks"
  ON public.student_remarks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM class_assignments ca
      JOIN wing_class_mappings wcm ON wcm.class_id = ca.class_id
      JOIN wing_assignments wa ON wa.wing_id = wcm.wing_id
      WHERE ca.user_id = student_remarks.student_id
        AND ca.role = 'student'
        AND wa.user_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_student_remarks_updated_at
  BEFORE UPDATE ON public.student_remarks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_student_remarks_student_id ON public.student_remarks(student_id);
CREATE INDEX idx_student_remarks_exam_id ON public.student_remarks(exam_id);
CREATE INDEX idx_student_remarks_institution_id ON public.student_remarks(institution_id);
