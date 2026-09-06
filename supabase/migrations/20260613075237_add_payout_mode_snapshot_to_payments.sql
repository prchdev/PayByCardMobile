-- Add payout_mode snapshot to payments table to capture the gateway's mode at transaction creation time
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_mode TEXT;

-- Back-fill existing payments from their linked gateway (best-effort for historical data)
UPDATE payments p
SET payout_mode = gs.payout_mode
FROM payment_gateway_settings gs
WHERE p.payment_gateway_id = gs.id
  AND p.payout_mode IS NULL;
