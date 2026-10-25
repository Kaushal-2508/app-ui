
-- Add image_url column to exam_questions
ALTER TABLE public.exam_questions ADD COLUMN image_url TEXT;

-- Add image_url column to question_bank
ALTER TABLE public.question_bank ADD COLUMN image_url TEXT;

-- Create question-images storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('question-images', 'question-images', true);

-- Allow authenticated users to upload to question-images
CREATE POLICY "Authenticated users can upload question images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'question-images');

-- Allow public read access to question images
CREATE POLICY "Anyone can view question images"
ON storage.objects FOR SELECT
USING (bucket_id = 'question-images');

-- Allow authenticated users to update their uploads
CREATE POLICY "Authenticated users can update question images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'question-images');

-- Allow authenticated users to delete question images
CREATE POLICY "Authenticated users can delete question images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'question-images');
