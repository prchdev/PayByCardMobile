-- Delete failed payout records that never reached the gateway (no gateway_transaction_id).
-- These were created when the v1 API returned a deprecation error before any transfer was initiated.
-- The auto-payout cron will retry them fresh using the v2 API.
DELETE FROM payouts
WHERE status = 'failed'
  AND gateway_transaction_id IS NULL
  AND payout_type IN ('auto', 'split');
