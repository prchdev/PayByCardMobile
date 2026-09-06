/*
  # Schedule auto-refund-kyc-expired cron job every 10 minutes

  ## Purpose
  Uses pg_cron + pg_net to call the `auto-refund-kyc-expired` edge function every
  10 minutes. It finds kyc_pending payments where the refund_after_hours threshold
  has been exceeded, initiates a gateway refund, and marks the payment as refunded.

  ## Changes
  1. Removes any existing version of the job (idempotent).
  2. Schedules a new cron job named "auto-refund-kyc-expired" firing every 10 minutes.

  ## Notes
  - Uses the anon key; the function is deployed with verify_jwt=false.
  - The function itself uses SUPABASE_SERVICE_ROLE_KEY internally for DB writes.
*/

SELECT cron.unschedule('auto-refund-kyc-expired')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-refund-kyc-expired'
);

SELECT cron.schedule(
  'auto-refund-kyc-expired',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/auto-refund-kyc-expired',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
