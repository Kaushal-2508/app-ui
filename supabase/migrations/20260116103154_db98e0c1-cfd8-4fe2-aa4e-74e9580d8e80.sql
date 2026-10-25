-- Create storage bucket for voice comments
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-voice-comments', 'task-voice-comments', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload voice comments"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'task-voice-comments' 
  AND auth.role() = 'authenticated'
);

-- Allow anyone to view voice comments (public bucket)
CREATE POLICY "Anyone can view voice comments"
ON storage.objects FOR SELECT
USING (bucket_id = 'task-voice-comments');

-- Allow users to delete their own voice comments
CREATE POLICY "Users can delete their own voice comments"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'task-voice-comments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Add audio_url column to task_comments for voice messages
ALTER TABLE public.task_comments 
ADD COLUMN IF NOT EXISTS audio_url TEXT;