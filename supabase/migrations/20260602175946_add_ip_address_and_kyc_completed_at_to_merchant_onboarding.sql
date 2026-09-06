/*
  # Add IP address and KYC completion timestamp to merchant_onboarding

  1. Modified Tables
    - `merchant_onboarding`
      - `ip_address` (text, nullable) — IP address of the merchant's machine at time of KYC submission
      - `kyc_completed_at` (timestamptz, nullable) — Exact timestamp when KYC was completed (DigiLocker or manual)

  2. Notes
    - Both columns are nullable; existing rows remain unaffected
    - `ip_address` is populated by the merchant-digilocker-kyc edge function via the X-Forwarded-For header
    - `kyc_completed_at` is set to now() at the moment DigiLocker verification succeeds
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE merchant_onboarding ADD COLUMN ip_address text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'kyc_completed_at'
  ) THEN
    ALTER TABLE merchant_onboarding ADD COLUMN kyc_completed_at timestamptz;
  END IF;
END $$;
