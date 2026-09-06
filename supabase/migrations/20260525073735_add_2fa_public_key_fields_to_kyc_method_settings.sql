/*
  # Add 2FA Public Key fields to kyc_method_settings

  ## Summary
  Adds public key certificate and password fields for two-factor authentication
  (2FA) to the kyc_method_settings table. These are used by CashFree DigiLocker
  to generate an RSA-encrypted x-cf-signature header for API requests.

  ## Modified Table: kyc_method_settings

  ### New Columns
  - `test_public_key` (text) — PEM-format public key certificate for test environment 2FA
  - `test_public_key_password` (text) — Optional password/passphrase for the test public key
  - `production_public_key` (text) — PEM-format public key certificate for production environment 2FA
  - `production_public_key_password` (text) — Optional password/passphrase for the production public key

  ## Notes
  - These fields are optional; leave blank if 2FA is not configured
  - Only CashFree DigiLocker requires a public key file for 2FA
  - DigiLocker direct uses HMAC-SHA256 with the client secret (no separate key needed)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_method_settings' AND column_name = 'test_public_key'
  ) THEN
    ALTER TABLE kyc_method_settings ADD COLUMN test_public_key text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_method_settings' AND column_name = 'test_public_key_password'
  ) THEN
    ALTER TABLE kyc_method_settings ADD COLUMN test_public_key_password text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_method_settings' AND column_name = 'production_public_key'
  ) THEN
    ALTER TABLE kyc_method_settings ADD COLUMN production_public_key text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_method_settings' AND column_name = 'production_public_key_password'
  ) THEN
    ALTER TABLE kyc_method_settings ADD COLUMN production_public_key_password text NOT NULL DEFAULT '';
  END IF;
END $$;
