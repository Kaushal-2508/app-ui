-- Add unique constraint on attempt_id for exam_insights table to allow upserts
ALTER TABLE public.exam_insights 
ADD CONSTRAINT exam_insights_attempt_id_key UNIQUE (attempt_id);