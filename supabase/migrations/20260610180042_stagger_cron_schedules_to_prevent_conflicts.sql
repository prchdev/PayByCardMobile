
-- Stagger cron schedules so no two jobs fire at the same minute.
--
-- Execution order each cycle:
--   :00/:05/:10... → poll-stale-payments  (resolves pending → settlement_pending/kyc_pending)
--   :02/:12/:22... → auto-payout          (processes settlement_pending → payout)
--   :04/:14/:24... → auto-refund-kyc-expired (processes kyc_pending → refund)
--   :07/:37        → check-settlement-status (polls gateway settlement state)
--
-- This prevents concurrent writes to the payments/payouts tables that could
-- cause duplicate payout rows or double-refunds.

-- ── auto-payout: shift to minute offset +2 ───────────────────────────────────
SELECT cron.unschedule('auto-payout')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-payout');

SELECT cron.schedule(
  'auto-payout',
  '2-59/10 * * * *',
  $$
  SELECT net.http_post(
    url                  := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/auto-payout',
    headers              := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
    body                 := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- ── auto-refund-kyc-expired: shift to minute offset +4 ───────────────────────
SELECT cron.unschedule('auto-refund-kyc-expired')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-refund-kyc-expired');

SELECT cron.schedule(
  'auto-refund-kyc-expired',
  '4-59/10 * * * *',
  $$
  SELECT net.http_post(
    url                  := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/auto-refund-kyc-expired',
    headers              := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
    body                 := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- ── check-settlement-status: shift to :07 and :37 ────────────────────────────
SELECT cron.unschedule('check-settlement-status')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-settlement-status');

SELECT cron.schedule(
  'check-settlement-status',
  '7,37 * * * *',
  $$
  SELECT net.http_post(
    url                  := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/check-settlement-status',
    headers              := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
    body                 := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- ── poll-stale-payments: unchanged (*/5), already first in cycle ─────────────
-- No change needed; it fires at :00/:05/:10... which is always before the others.
