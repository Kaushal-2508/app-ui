-- =====================================================================
-- Homework & Assignment — Phase 6: schedule homework-notify-pass every 15 min.
-- Uses the public anon JWT (same pattern as send-task-notifications). The
-- function is idempotent (homework_notifications_sent UNIQUE), so re-runs are
-- safe; verify_jwt=true gates at the gateway via the anon JWT.
-- =====================================================================
do $$
begin
  perform cron.unschedule('homework-notify-pass-15min');
exception when others then null;
end;
$$;

select cron.schedule(
  'homework-notify-pass-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/homework-notify-pass',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5eW1rZ29oY2lqZWtzbXJ6dXl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1MjAxMTMsImV4cCI6MjA4MzA5NjExM30.-pC2a4z1oCiUy6Cxy0X4NnGg8gzfco4rnbmmf88e9AI"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);
