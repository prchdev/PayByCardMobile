ALTER TABLE payments ADD COLUMN IF NOT EXISTS auto_payout_failed boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_payments_auto_payout_failed ON payments (auto_payout_failed) WHERE auto_payout_failed = true;
