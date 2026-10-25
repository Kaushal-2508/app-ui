-- Schedule send-task-notifications edge function to run every 30 minutes
SELECT cron.schedule(
  'send-task-notifications-every-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/send-task-notifications',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5eW1rZ29oY2lqZWtzbXJ6dXl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1MjAxMTMsImV4cCI6MjA4MzA5NjExM30.-pC2a4z1oCiUy6Cxy0X4NnGg8gzfco4rnbmmf88e9AI"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);