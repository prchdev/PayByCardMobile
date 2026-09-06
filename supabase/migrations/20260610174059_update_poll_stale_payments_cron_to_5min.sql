
-- Update poll-stale-payments cron from every 10 minutes to every 5 minutes
SELECT cron.unschedule('poll-stale-payments');

SELECT cron.schedule(
  'poll-stale-payments',
  '*/5 * * * *',
  $$
SELECT net.http_post(
url                  := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/poll-stale-payments',
headers              := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
body                 := '{}'::jsonb,
timeout_milliseconds := 30000
);
$$
);
