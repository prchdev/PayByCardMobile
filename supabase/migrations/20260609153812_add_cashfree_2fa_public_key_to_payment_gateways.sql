/*
  # Add Cashfree 2FA Public Key fields to payment_gateway_settings
  
  Adds test and production RSA 2FA public key fields for Cashfree Payout API
  verification. Used when Cashfree requires OTP-based 2FA for transfer authorization.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'test_cashfree_2fa_public_key'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN test_cashfree_2fa_public_key TEXT NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'production_cashfree_2fa_public_key'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN production_cashfree_2fa_public_key TEXT NOT NULL DEFAULT '';
  END IF;
END $$;
