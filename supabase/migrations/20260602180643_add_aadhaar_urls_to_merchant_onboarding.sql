/*
  # Add aadhaar_front_url and aadhaar_back_url to merchant_onboarding

  1. Modified Tables
    - `merchant_onboarding`
      - `aadhaar_front_url` (text, nullable) — URL of address proof XML/image (front), stored in kyc-documents bucket
      - `aadhaar_back_url` (text, nullable) — URL of address proof XML/image (back), stored in kyc-documents bucket

  2. Notes
    - Both columns are nullable; existing rows remain unaffected
    - Populated by the merchant-digilocker-kyc edge function after successful DigiLocker verification
    - Used in admin panel to display XML document links
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'aadhaar_front_url'
  ) THEN
    ALTER TABLE merchant_onboarding ADD COLUMN aadhaar_front_url text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'aadhaar_back_url'
  ) THEN
    ALTER TABLE merchant_onboarding ADD COLUMN aadhaar_back_url text;
  END IF;
END $$;
