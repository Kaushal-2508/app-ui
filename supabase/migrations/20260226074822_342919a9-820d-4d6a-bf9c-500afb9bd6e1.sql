
-- 1. Create leave_requests table
CREATE TABLE public.leave_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  student_id UUID NOT NULL REFERENCES public.profiles(id),
  class_id UUID NOT NULL REFERENCES public.classes(id),
  leave_type TEXT NOT NULL DEFAULT 'personal' CHECK (leave_type IN ('sick', 'personal', 'family', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own leave requests"
  ON public.leave_requests FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Students can create own leave requests"
  ON public.leave_requests FOR INSERT
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can update own pending leave requests"
  ON public.leave_requests FOR UPDATE
  USING (student_id = auth.uid() AND status = 'pending');

CREATE POLICY "Students can delete own pending leave requests"
  ON public.leave_requests FOR DELETE
  USING (student_id = auth.uid() AND status = 'pending');

CREATE POLICY "Teachers and admins can view leave requests in their institution"
  ON public.leave_requests FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()) AND public.has_role(auth.uid(), 'teacher'));

CREATE POLICY "Admins can view all leave requests in institution"
  ON public.leave_requests FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()) AND public.has_role(auth.uid(), 'school_admin'));

CREATE POLICY "Teachers and admins can review leave requests"
  ON public.leave_requests FOR UPDATE
  USING (institution_id = public.get_user_institution(auth.uid()) AND (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'school_admin')));

CREATE TRIGGER update_leave_requests_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Create appointments table
CREATE TABLE public.appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id),
  student_id UUID NOT NULL REFERENCES public.profiles(id),
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  teacher_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own appointments"
  ON public.appointments FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Students can create appointments"
  ON public.appointments FOR INSERT
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can cancel own pending appointments"
  ON public.appointments FOR UPDATE
  USING (student_id = auth.uid() AND status = 'pending');

CREATE POLICY "Teachers can view their appointments"
  ON public.appointments FOR SELECT
  USING (teacher_id = auth.uid());

CREATE POLICY "Teachers can manage their appointments"
  ON public.appointments FOR UPDATE
  USING (teacher_id = auth.uid());

CREATE POLICY "Admins can view all appointments in institution"
  ON public.appointments FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()) AND public.has_role(auth.uid(), 'school_admin'));

CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. DB trigger: notify on new conversation message
CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_participant RECORD;
  v_conv_title TEXT;
  v_sender_name TEXT;
BEGIN
  SELECT full_name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT COALESCE(title, 'Direct Message') INTO v_conv_title FROM public.conversations WHERE id = NEW.conversation_id;

  FOR v_participant IN
    SELECT user_id FROM public.conversation_participants
    WHERE conversation_id = NEW.conversation_id AND user_id != NEW.sender_id
  LOOP
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (
      v_participant.user_id,
      'message',
      'New message from ' || COALESCE(v_sender_name, 'Unknown'),
      LEFT(NEW.content, 100),
      '/school/communication',
      jsonb_build_object('conversation_id', NEW.conversation_id, 'message_id', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_new_message
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();

-- 4. DB trigger: notify on absence
CREATE OR REPLACE FUNCTION public.notify_student_absent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_class_name TEXT;
BEGIN
  IF NEW.status = 'absent' THEN
    SELECT name INTO v_class_name FROM public.classes WHERE id = NEW.class_id;

    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (
      NEW.student_id,
      'attendance',
      'Marked Absent',
      'You were marked absent in ' || COALESCE(v_class_name, 'your class') || ' on ' || NEW.date::TEXT,
      '/student/dashboard',
      jsonb_build_object('attendance_id', NEW.id, 'class_id', NEW.class_id, 'date', NEW.date)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_student_absent
  AFTER INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.notify_student_absent();

-- 5. Storage bucket for message attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('message-attachments', 'message-attachments', false);

CREATE POLICY "Participants can upload attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'message-attachments' AND auth.uid() IS NOT NULL);

CREATE POLICY "Participants can view attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'message-attachments' AND auth.uid() IS NOT NULL);
