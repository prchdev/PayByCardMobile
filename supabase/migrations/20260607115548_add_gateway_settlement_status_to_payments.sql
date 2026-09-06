ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS gateway_settlement_status text,
  ADD COLUMN IF NOT EXISTS gateway_settlement_checked_at timestamptz;

COMMENT ON COLUMN payments.gateway_settlement_status IS
  'Last known gateway settlement state: settled | captured | paid | not_captured | not_paid | check_failed | no_tx_id | not_applicable';
COMMENT ON COLUMN payments.gateway_settlement_checked_at IS
  'When gateway_settlement_status was last refreshed';
