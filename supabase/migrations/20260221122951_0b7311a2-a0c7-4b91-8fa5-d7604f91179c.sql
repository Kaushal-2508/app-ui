ALTER TABLE public.user_preferences 
ADD COLUMN IF NOT EXISTS sound_notifications boolean DEFAULT true;