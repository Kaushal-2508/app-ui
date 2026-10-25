
-- Create communication_templates table
CREATE TABLE public.communication_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'whatsapp')),
  subject TEXT,
  body TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;

-- RLS: Institution members can read templates
CREATE POLICY "Institution members can view templates"
ON public.communication_templates
FOR SELECT
USING (
  institution_id = public.get_user_institution(auth.uid())
);

-- RLS: Admins can insert templates
CREATE POLICY "Admins can create templates"
ON public.communication_templates
FOR INSERT
WITH CHECK (
  public.is_institution_admin(auth.uid(), institution_id)
);

-- RLS: Admins can update templates
CREATE POLICY "Admins can update templates"
ON public.communication_templates
FOR UPDATE
USING (
  public.is_institution_admin(auth.uid(), institution_id)
);

-- RLS: Admins can delete templates
CREATE POLICY "Admins can delete templates"
ON public.communication_templates
FOR DELETE
USING (
  public.is_institution_admin(auth.uid(), institution_id)
);

-- Trigger for updated_at
CREATE TRIGGER update_communication_templates_updated_at
BEFORE UPDATE ON public.communication_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add rating column to ptm_bookings
ALTER TABLE public.ptm_bookings ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating >= 1 AND rating <= 5);

-- Storage policies for circular-attachments bucket (bucket already exists)
CREATE POLICY "Institution members can read circular attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'circular-attachments');

CREATE POLICY "Authenticated users can upload circular attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'circular-attachments' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete own circular attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'circular-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
