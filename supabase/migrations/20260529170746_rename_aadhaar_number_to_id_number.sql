/*
  # Rename aadhaar_number to id_number

  ## Summary
  The `aadhaar_number` column on `kyc_address_proof` and `merchant_onboarding`
  is replaced by the general-purpose `id_number` column that already exists on
  both tables (added by a prior migration). This removes the Aadhaar-specific
  column and consolidates identity numbers into a single field that supports
  all address proof types (Aadhaar, Passport, Voter ID, Driving License).

  ## Changes
  1. `kyc_address_proof` — migrate aadhaar_number → id_number where id_number is null, then drop aadhaar_number
  2. `merchant_onboarding` — same migration, then drop aadhaar_number
*/

-- 1. kyc_address_proof: backfill id_number from aadhaar_number for older rows
UPDATE kyc_address_proof
SET id_number = aadhaar_number
WHERE id_number IS NULL AND aadhaar_number IS NOT NULL;

-- Drop aadhaar_number column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_address_proof' AND column_name = 'aadhaar_number'
  ) THEN
    ALTER TABLE kyc_address_proof DROP COLUMN aadhaar_number;
  END IF;
END $$;

-- 2. merchant_onboarding: backfill id_number from aadhaar_number for older rows
UPDATE merchant_onboarding
SET id_number = aadhaar_number
WHERE id_number IS NULL AND aadhaar_number IS NOT NULL;

-- Drop aadhaar_number column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'aadhaar_number'
  ) THEN
    ALTER TABLE merchant_onboarding DROP COLUMN aadhaar_number;
  END IF;
END $$;
