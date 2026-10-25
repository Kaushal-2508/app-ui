-- Create storage bucket for study materials
INSERT INTO storage.buckets (id, name, public)
VALUES ('study-materials', 'study-materials', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload study materials
CREATE POLICY "Authenticated users can upload study materials"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'study-materials');

-- Allow anyone to view study materials (public bucket)
CREATE POLICY "Anyone can view study materials"
ON storage.objects
FOR SELECT
USING (bucket_id = 'study-materials');

-- Allow authenticated users to update their uploaded files
CREATE POLICY "Authenticated users can update study materials"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'study-materials');

-- Allow authenticated users to delete study materials
CREATE POLICY "Authenticated users can delete study materials"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'study-materials');