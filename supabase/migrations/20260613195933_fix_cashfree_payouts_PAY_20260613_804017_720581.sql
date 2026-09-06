-- Fix payouts incorrectly marked failed for PAY-20260613-804017 and PAY-20260613-720581
-- CashFree returned RECEIVED but cf_transfer_id was stored instead of transfer_id,
-- causing the status poll to 404 → falsely mapped to failed.

UPDATE payouts
SET
  status = 'processing',
  failure_reason = NULL,
  gateway_transaction_id = 'AUTO-PAY-20260613-804017',
  updated_at = NOW()
WHERE id = '0add5482-3f9a-4b7f-958f-749ba4135c57';

UPDATE payouts
SET
  status = 'processing',
  failure_reason = NULL,
  gateway_transaction_id = 'AUTO-PAY-20260613-720581',
  updated_at = NOW()
WHERE id = 'c01b35ec-a7a6-4823-abd2-aea234a164ac';

UPDATE payments
SET
  auto_payout_failed = FALSE,
  updated_at = NOW()
WHERE payment_reference IN ('PAY-20260613-804017', 'PAY-20260613-720581');
