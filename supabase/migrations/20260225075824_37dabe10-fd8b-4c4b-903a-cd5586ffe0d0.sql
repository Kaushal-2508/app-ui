
-- ============================================================
-- Communication & Collaboration Platform - Tables First
-- ============================================================

-- 1. institution_communication_settings
CREATE TABLE public.institution_communication_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  email_provider TEXT,
  email_api_key TEXT,
  email_from_address TEXT,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  sms_provider TEXT,
  sms_api_key TEXT,
  sms_sender_id TEXT,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  whatsapp_provider TEXT,
  whatsapp_api_key TEXT,
  whatsapp_phone_number TEXT,
  bulk_messaging_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(institution_id)
);

-- 2. conversations
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'direct',
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  title TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. conversation_participants
CREATE TABLE public.conversation_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  role TEXT NOT NULL DEFAULT 'member',
  last_read_at TIMESTAMPTZ,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

-- 4. conversation_messages
CREATE TABLE public.conversation_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id),
  content TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  attachment_url TEXT,
  attachment_name TEXT,
  is_edited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. circulars
CREATE TABLE public.circulars (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  scope TEXT NOT NULL DEFAULT 'institution',
  target_class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  target_wing_id UUID REFERENCES public.wings(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  attachment_urls JSONB DEFAULT '[]'::jsonb,
  published_by UUID NOT NULL REFERENCES public.profiles(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. circular_acknowledgements
CREATE TABLE public.circular_acknowledgements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  circular_id UUID NOT NULL REFERENCES public.circulars(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(circular_id, user_id)
);

-- 7. ptm_schedules
CREATE TABLE public.ptm_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. ptm_bookings
CREATE TABLE public.ptm_bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ptm_id UUID NOT NULL REFERENCES public.ptm_schedules(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES public.profiles(id),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id),
  slot_time TIME NOT NULL,
  notes TEXT,
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'booked',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Enable RLS on all tables
-- ============================================================
ALTER TABLE public.institution_communication_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circulars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circular_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ptm_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ptm_bookings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies (tables exist now, safe to reference)
-- ============================================================

-- institution_communication_settings
CREATE POLICY "inst_admins_select_comm_settings" ON public.institution_communication_settings FOR SELECT
  USING (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "inst_admins_insert_comm_settings" ON public.institution_communication_settings FOR INSERT
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "inst_admins_update_comm_settings" ON public.institution_communication_settings FOR UPDATE
  USING (public.is_institution_admin(auth.uid(), institution_id));

-- conversations
CREATE POLICY "conv_select" ON public.conversations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id = id AND cp.user_id = auth.uid())
    OR public.is_institution_admin(auth.uid(), institution_id)
  );
CREATE POLICY "conv_insert" ON public.conversations FOR INSERT
  WITH CHECK (public.get_user_institution(auth.uid()) = institution_id);
CREATE POLICY "conv_update" ON public.conversations FOR UPDATE
  USING (created_by = auth.uid() OR public.is_institution_admin(auth.uid(), institution_id));

-- conversation_participants (use security definer to avoid recursion)
CREATE OR REPLACE FUNCTION public.is_conversation_participant(_user_id uuid, _conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  )
$$;

CREATE POLICY "cp_select" ON public.conversation_participants FOR SELECT
  USING (
    public.is_conversation_participant(auth.uid(), conversation_id)
    OR public.is_institution_admin(auth.uid(), public.get_user_institution(auth.uid()))
  );
CREATE POLICY "cp_insert" ON public.conversation_participants FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND (c.created_by = auth.uid() OR public.is_institution_admin(auth.uid(), c.institution_id)))
    OR user_id = auth.uid()
  );
CREATE POLICY "cp_update" ON public.conversation_participants FOR UPDATE
  USING (user_id = auth.uid());

-- conversation_messages
CREATE POLICY "cm_select" ON public.conversation_messages FOR SELECT
  USING (
    public.is_conversation_participant(auth.uid(), conversation_id)
    OR public.is_institution_admin(auth.uid(), public.get_user_institution(auth.uid()))
  );
CREATE POLICY "cm_insert" ON public.conversation_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_participant(auth.uid(), conversation_id)
  );
CREATE POLICY "cm_update" ON public.conversation_messages FOR UPDATE
  USING (sender_id = auth.uid());

-- circulars
CREATE POLICY "circ_select" ON public.circulars FOR SELECT
  USING (public.get_user_institution(auth.uid()) = institution_id);
CREATE POLICY "circ_insert" ON public.circulars FOR INSERT
  WITH CHECK (
    published_by = auth.uid()
    AND public.get_user_institution(auth.uid()) = institution_id
    AND (
      public.is_institution_admin(auth.uid(), institution_id)
      OR public.has_role(auth.uid(), 'coordinator')
      OR public.has_role(auth.uid(), 'teacher')
    )
  );
CREATE POLICY "circ_update" ON public.circulars FOR UPDATE
  USING (published_by = auth.uid() OR public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "circ_delete" ON public.circulars FOR DELETE
  USING (public.is_institution_admin(auth.uid(), institution_id));

-- circular_acknowledgements
CREATE POLICY "ca_select" ON public.circular_acknowledgements FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.circulars c WHERE c.id = circular_id AND public.get_user_institution(auth.uid()) = c.institution_id));
CREATE POLICY "ca_insert" ON public.circular_acknowledgements FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.circulars c WHERE c.id = circular_id AND public.get_user_institution(auth.uid()) = c.institution_id)
  );

-- ptm_schedules
CREATE POLICY "ptm_select" ON public.ptm_schedules FOR SELECT
  USING (public.get_user_institution(auth.uid()) = institution_id);
CREATE POLICY "ptm_insert" ON public.ptm_schedules FOR INSERT
  WITH CHECK (created_by = auth.uid() AND public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "ptm_update" ON public.ptm_schedules FOR UPDATE
  USING (public.is_institution_admin(auth.uid(), institution_id));
CREATE POLICY "ptm_delete" ON public.ptm_schedules FOR DELETE
  USING (public.is_institution_admin(auth.uid(), institution_id));

-- ptm_bookings
CREATE POLICY "ptmb_select" ON public.ptm_bookings FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.ptm_schedules ps WHERE ps.id = ptm_id AND public.get_user_institution(auth.uid()) = ps.institution_id));
CREATE POLICY "ptmb_insert" ON public.ptm_bookings FOR INSERT
  WITH CHECK (
    parent_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.ptm_schedules ps WHERE ps.id = ptm_id AND public.get_user_institution(auth.uid()) = ps.institution_id)
  );
CREATE POLICY "ptmb_update" ON public.ptm_bookings FOR UPDATE
  USING (
    parent_id = auth.uid() OR teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.ptm_schedules ps WHERE ps.id = ptm_id AND public.is_institution_admin(auth.uid(), ps.institution_id))
  );

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_conversations_institution ON public.conversations(institution_id);
CREATE INDEX idx_conversations_created_by ON public.conversations(created_by);
CREATE INDEX idx_cp_user ON public.conversation_participants(user_id);
CREATE INDEX idx_cp_conv ON public.conversation_participants(conversation_id);
CREATE INDEX idx_cm_conv ON public.conversation_messages(conversation_id);
CREATE INDEX idx_cm_created ON public.conversation_messages(created_at DESC);
CREATE INDEX idx_circulars_institution ON public.circulars(institution_id);
CREATE INDEX idx_circulars_published ON public.circulars(published_at DESC);
CREATE INDEX idx_ca_circular ON public.circular_acknowledgements(circular_id);
CREATE INDEX idx_ptm_institution ON public.ptm_schedules(institution_id);
CREATE INDEX idx_ptm_date ON public.ptm_schedules(scheduled_date);
CREATE INDEX idx_ptmb_ptm ON public.ptm_bookings(ptm_id);

-- ============================================================
-- Triggers
-- ============================================================
CREATE TRIGGER update_inst_comm_settings_ts BEFORE UPDATE ON public.institution_communication_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_conversations_ts BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_conv_messages_ts BEFORE UPDATE ON public.conversation_messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_circulars_ts BEFORE UPDATE ON public.circulars FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ptm_schedules_ts BEFORE UPDATE ON public.ptm_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;

-- Storage bucket for circular attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('circular-attachments', 'circular-attachments', true);
CREATE POLICY "upload_circular_attachments" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'circular-attachments' AND auth.uid() IS NOT NULL);
CREATE POLICY "view_circular_attachments" ON storage.objects FOR SELECT USING (bucket_id = 'circular-attachments');
