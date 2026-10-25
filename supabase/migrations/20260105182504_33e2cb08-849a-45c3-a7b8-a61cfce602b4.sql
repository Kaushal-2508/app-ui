-- Add roll_number to profiles if not exists
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS roll_number VARCHAR(50);

-- Add match_method to ocr_uploads to track how student was matched
ALTER TABLE public.ocr_uploads
ADD COLUMN IF NOT EXISTS roll_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS match_method VARCHAR(20) DEFAULT 'manual';

-- Create index on profiles roll_number for fast lookup
CREATE INDEX IF NOT EXISTS idx_profiles_roll_number ON public.profiles(roll_number);

-- Create index on ocr_uploads for faster queries
CREATE INDEX IF NOT EXISTS idx_ocr_uploads_status ON public.ocr_uploads(status);
CREATE INDEX IF NOT EXISTS idx_ocr_uploads_exam_class ON public.ocr_uploads(exam_id, class_id);