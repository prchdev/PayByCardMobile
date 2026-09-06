-- Fix payout incorrectly marked failed due to wrong gateway_transaction_id lookup
-- CashFree returned RECEIVED (success) but the cf_transfer_id was stored instead of
-- the client transfer_id, causing the status poll to 404 and mark it failed.

UPDATE payouts
SET
  status = 'processing',
  failure_reason = NULL,
  gateway_transaction_id = 'AUTO-PAY-20260613-534276',
  updated_at = NOW()
WHERE id = '641e9b26-3e3c-4d96-8bbe-ffd29caad08e';

UPDATE payments
SET
  auto_payout_failed = FALSE,
  updated_at = NOW()
WHERE payment_reference = 'PAY-20260613-534276';
