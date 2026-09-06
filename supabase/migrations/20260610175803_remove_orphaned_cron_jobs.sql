
-- Remove orphaned cron jobs that call non-local / old edge functions.
-- These were superseded by correctly-named replacements and represent dead code
-- that can cause duplicate processing (double-refund risk for auto-refund-expired-kyc).

-- Job 5: old name for auto-refund-kyc-expired — replaced by job 6
SELECT cron.unschedule('auto-refund-expired-kyc')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-refund-expired-kyc');

-- Job 8: old name for check-settlement-status — replaced by job 7
SELECT cron.unschedule('refresh-settlement-status')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-settlement-status');
