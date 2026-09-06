-- Add indexes for FK columns that are missing them (performance + integrity)

CREATE INDEX IF NOT EXISTS idx_kyc_method_settings_updated_by_admin
  ON kyc_method_settings(updated_by_admin_id);

CREATE INDEX IF NOT EXISTS idx_master_settings_updated_by
  ON master_settings(updated_by);

CREATE INDEX IF NOT EXISTS idx_refund_transactions_gateway_id
  ON refund_transactions(gateway_id);

CREATE INDEX IF NOT EXISTS idx_refund_transactions_payout_id
  ON refund_transactions(payout_id);
