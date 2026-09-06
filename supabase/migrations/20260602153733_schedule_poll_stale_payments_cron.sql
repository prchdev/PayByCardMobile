/*
  # Schedule stale-payment polling job every 10 minutes

  ## Purpose
  Uses pg_cron + pg_net to call the `poll-stale-payments` edge function every
  10 minutes from inside the database.  This runs entirely server-side — no
  external scheduler or client is required.

  ## What it does
  1. Enables the pg_cron and pg_net extensions (idempotent).
  2. Removes any previously registered version of the job (idempotent).
  3. Schedules a new cron job named "poll-stale-payments" that fires every
     10 minutes and POSTs to the poll-stale-payments edge function endpoint.

  ## Notes
  - The Authorization header uses the service role key stored in
    `app.settings.service_role_key` — Supabase sets this automatically.
  - pg_net runs the HTTP call asynchronously; the cron job returns immediately
    and does not block.
  - To pause the job: UPDATE cron.job SET active = false WHERE jobname = 'poll-stale-payments';
  - To remove the job: SELECT cron.unschedule('poll-stale-payments');
*/

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing version of this job to avoid duplicates
SELECT cron.unschedule('poll-stale-payments')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'poll-stale-payments'
);

-- Schedule: every 10 minutes
SELECT cron.schedule(
  'poll-stale-payments',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/poll-stale-payments',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
               ),
    body    := '{}'::jsonb
  );
  $$
);
