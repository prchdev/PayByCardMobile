/*
  # Fix stale-payment cron job — replace current_setting() with hardcoded values

  ## Problem
  The previous cron schedule used current_setting('app.settings.supabase_url') and
  current_setting('app.settings.service_role_key'), but those GUC parameters are not
  set in this Supabase project, causing every run to fail with:
    ERROR: unrecognized configuration parameter "app.settings.supabase_url"

  ## Fix
  Reschedule the job using the project URL and anon key hardcoded directly into the
  pg_net call.  The poll-stale-payments edge function is deployed with verify_jwt=false
  so it does not require a service role token to be invoked — the anon key is sufficient
  to pass the gateway check.  The function itself creates an internal supabase client
  with SUPABASE_SERVICE_ROLE_KEY (injected automatically by the edge runtime) for all
  privileged DB operations.

  ## Changes
  1. Unschedule the broken job.
  2. Re-schedule with literal URL + anon key embedded in the SQL command.
*/

-- Drop the broken job first
SELECT cron.unschedule('poll-stale-payments')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'poll-stale-payments'
);

-- Re-schedule every 10 minutes with hardcoded credentials
SELECT cron.schedule(
  'poll-stale-payments',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/poll-stale-payments',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
