
-- =============================================
-- 1. Attendance Sessions (Mobile Check-in QR/PIN)
-- =============================================
CREATE TABLE public.attendance_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  class_id UUID NOT NULL REFERENCES public.classes(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  session_code TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'qr' CHECK (session_type IN ('qr', 'pin')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  max_check_ins INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(class_id, date, session_code)
);

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

-- Teachers can create/view sessions for their classes
CREATE POLICY "Teachers can manage their class sessions"
ON public.attendance_sessions FOR ALL
USING (
  public.is_teacher_for_class(auth.uid(), class_id)
  OR public.is_institution_admin(auth.uid(), institution_id)
  OR public.is_coordinator_for_class(auth.uid(), class_id)
);

-- Students can view active sessions for their classes
CREATE POLICY "Students can view active sessions for their classes"
ON public.attendance_sessions FOR SELECT
USING (
  public.is_assigned_to_class(auth.uid(), class_id)
  AND is_active = true
);

CREATE TRIGGER update_attendance_sessions_updated_at
BEFORE UPDATE ON public.attendance_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 2. Face Enrollments (Face Recognition)
-- =============================================
CREATE TABLE public.face_enrollments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  student_id UUID NOT NULL REFERENCES public.profiles(id),
  face_descriptor JSONB NOT NULL,
  photo_url TEXT,
  enrolled_by UUID REFERENCES public.profiles(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id)
);

ALTER TABLE public.face_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers and admins can manage face enrollments"
ON public.face_enrollments FOR ALL
USING (
  public.is_institution_admin(auth.uid(), institution_id)
  OR EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = auth.uid() AND ca.role = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_assignments ca2
      WHERE ca2.user_id = face_enrollments.student_id
      AND ca2.class_id = ca.class_id AND ca2.role = 'student'
    )
  )
);

CREATE POLICY "Students can view their own enrollment"
ON public.face_enrollments FOR SELECT
USING (student_id = auth.uid());

CREATE TRIGGER update_face_enrollments_updated_at
BEFORE UPDATE ON public.face_enrollments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 3. Biometric Enrollments
-- =============================================
CREATE TABLE public.biometric_enrollments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  student_id UUID NOT NULL REFERENCES public.profiles(id),
  fingerprint_template TEXT NOT NULL,
  device_id TEXT,
  enrolled_by UUID REFERENCES public.profiles(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id)
);

ALTER TABLE public.biometric_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage biometric enrollments"
ON public.biometric_enrollments FOR ALL
USING (
  public.is_institution_admin(auth.uid(), institution_id)
);

CREATE POLICY "Teachers can view enrollments for their students"
ON public.biometric_enrollments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = auth.uid() AND ca.role = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_assignments ca2
      WHERE ca2.user_id = biometric_enrollments.student_id
      AND ca2.class_id = ca.class_id AND ca2.role = 'student'
    )
  )
);

CREATE TRIGGER update_biometric_enrollments_updated_at
BEFORE UPDATE ON public.biometric_enrollments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 4. Storage bucket for face photos
-- =============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('face-photos', 'face-photos', false);

CREATE POLICY "Teachers and admins can upload face photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'face-photos' AND (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('teacher', 'school_admin', 'super_school_admin'))
));

CREATE POLICY "Teachers and admins can view face photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'face-photos' AND (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('teacher', 'school_admin', 'super_school_admin', 'coordinator'))
));
