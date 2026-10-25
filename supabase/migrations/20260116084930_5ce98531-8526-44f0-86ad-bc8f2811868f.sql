-- Create answer-sheets storage bucket for offline exam scanning
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'answer-sheets',
  'answer-sheets',
  true,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload answer sheets
CREATE POLICY "Authenticated users can upload answer sheets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'answer-sheets');

-- Allow public read access (for OCR processing)
CREATE POLICY "Public can view answer sheets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'answer-sheets');

-- Allow users to delete their uploads
CREATE POLICY "Users can delete own answer sheets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'answer-sheets');