
-- Schedule a cron job to process scheduled bulk email and SMS campaigns.
-- Fires every 5 minutes, picks up campaigns whose scheduled_at has passed,
-- and triggers the edge functions to send them.

SELECT cron.unschedule('process-scheduled-bulk-campaigns')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-bulk-campaigns');

SELECT cron.schedule(
  'process-scheduled-bulk-campaigns',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url                  := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/admin-bulk-email',
    headers              := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
    body                 := '{"action":"process_scheduled"}'::jsonb,
    timeout_milliseconds := 55000
  );
  SELECT net.http_post(
    url                  := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/admin-bulk-sms',
    headers              := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
    body                 := '{"action":"process_scheduled"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
