-- Add environment-specific payout API credential columns to payment_gateway_settings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_gateway_settings' AND column_name = 'test_payout_client_id') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN test_payout_client_id text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_gateway_settings' AND column_name = 'test_payout_client_secret') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN test_payout_client_secret text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_gateway_settings' AND column_name = 'production_payout_client_id') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN production_payout_client_id text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_gateway_settings' AND column_name = 'production_payout_client_secret') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN production_payout_client_secret text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_gateway_settings' AND column_name = 'test_payout_account_number') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN test_payout_account_number text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_gateway_settings' AND column_name = 'production_payout_account_number') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN production_payout_account_number text DEFAULT '';
  END IF;
END $$;

-- Migrate existing cashfree_payout_client_id/secret to production fields (non-destructive)
UPDATE payment_gateway_settings
SET
  production_payout_client_id     = COALESCE(NULLIF(cashfree_payout_client_id, ''), production_payout_client_id),
  production_payout_client_secret = COALESCE(NULLIF(cashfree_payout_client_secret, ''), production_payout_client_secret)
WHERE (cashfree_payout_client_id IS NOT NULL AND cashfree_payout_client_id != '')
   OR (cashfree_payout_client_secret IS NOT NULL AND cashfree_payout_client_secret != '');

-- Migrate existing razorpay_account_number to production field (non-destructive)
UPDATE payment_gateway_settings
SET production_payout_account_number = COALESCE(NULLIF(razorpay_account_number, ''), production_payout_account_number)
WHERE razorpay_account_number IS NOT NULL AND razorpay_account_number != '';
