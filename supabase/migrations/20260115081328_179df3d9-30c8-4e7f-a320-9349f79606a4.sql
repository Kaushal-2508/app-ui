-- Publish all finalized results that were never published
UPDATE final_results 
SET 
  is_published = true, 
  published_at = now()
WHERE 
  finalized_at IS NOT NULL 
  AND is_published = false;