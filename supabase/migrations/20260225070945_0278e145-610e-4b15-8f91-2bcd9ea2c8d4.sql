
-- Create attendance_records table
CREATE TABLE public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'sick', 'casual', 'holiday')),
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'biometric', 'facial_recognition', 'mobile_checkin')),
  marked_by UUID REFERENCES auth.users(id),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(class_id, student_id, date)
);

-- Create attendance_settings table
CREATE TABLE public.attendance_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE UNIQUE,
  notify_parents_on_absent BOOLEAN NOT NULL DEFAULT true,
  absent_threshold_days INTEGER NOT NULL DEFAULT 3,
  tracking_methods JSONB NOT NULL DEFAULT '["manual"]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;

-- Triggers for updated_at
CREATE TRIGGER update_attendance_records_updated_at
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_attendance_settings_updated_at
  BEFORE UPDATE ON public.attendance_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS for attendance_records

-- Super admins: full access
CREATE POLICY "Super admins full access attendance_records"
  ON public.attendance_records FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- School admins: full access for their institution
CREATE POLICY "School admins full access own institution attendance"
  ON public.attendance_records FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

-- Teachers: SELECT/INSERT/UPDATE for classes they are assigned to
CREATE POLICY "Teachers select attendance for assigned classes"
  ON public.attendance_records FOR SELECT TO authenticated
  USING (public.is_teacher_for_class(auth.uid(), class_id));

CREATE POLICY "Teachers insert attendance for assigned classes"
  ON public.attendance_records FOR INSERT TO authenticated
  WITH CHECK (public.is_teacher_for_class(auth.uid(), class_id));

CREATE POLICY "Teachers update attendance for assigned classes"
  ON public.attendance_records FOR UPDATE TO authenticated
  USING (public.is_teacher_for_class(auth.uid(), class_id));

-- Coordinators: SELECT for their institution
CREATE POLICY "Coordinators select attendance own institution"
  ON public.attendance_records FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );

-- Students: SELECT own records only
CREATE POLICY "Students select own attendance"
  ON public.attendance_records FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    AND public.has_role(auth.uid(), 'student')
  );

-- RLS for attendance_settings

-- Super admins: full access
CREATE POLICY "Super admins full access attendance_settings"
  ON public.attendance_settings FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- School admins: full access for their institution
CREATE POLICY "School admins manage own attendance_settings"
  ON public.attendance_settings FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

-- Teachers/Coordinators: SELECT only
CREATE POLICY "Staff select attendance_settings"
  ON public.attendance_settings FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'coordinator'))
  );
