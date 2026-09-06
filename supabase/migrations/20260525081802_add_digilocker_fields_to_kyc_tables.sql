/*
  # Add DigiLocker fields to KYC tables

  ## Changes

  ### kyc_pan_verification
  - `digilocker_verified` (boolean, default false) — whether this record was auto-verified via DigiLocker
  - `digilocker_provider` (text, nullable) — name of the DigiLocker provider used (e.g., 'DigiLocker', 'CashFree DigiLocker')

  ### kyc_address_proof
  - `aadhaar_number` (text, nullable) — masked Aadhaar number fetched from DigiLocker (last 4 digits visible)
  - `digilocker_verified` (boolean, default false)
  - `digilocker_provider` (text, nullable)

  ### Notes
  - All columns are added with IF NOT EXISTS guards to be idempotent
  - aadhaar_number stores only the masked value (XXXX-XXXX-1234) as returned by UIDAI — never the full number
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_pan_verification' AND column_name = 'digilocker_verified'
  ) THEN
    ALTER TABLE kyc_pan_verification ADD COLUMN digilocker_verified boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_pan_verification' AND column_name = 'digilocker_provider'
  ) THEN
    ALTER TABLE kyc_pan_verification ADD COLUMN digilocker_provider text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_address_proof' AND column_name = 'aadhaar_number'
  ) THEN
    ALTER TABLE kyc_address_proof ADD COLUMN aadhaar_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_address_proof' AND column_name = 'digilocker_verified'
  ) THEN
    ALTER TABLE kyc_address_proof ADD COLUMN digilocker_verified boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_address_proof' AND column_name = 'digilocker_provider'
  ) THEN
    ALTER TABLE kyc_address_proof ADD COLUMN digilocker_provider text;
  END IF;
END $$;
