/*
  # Add Company Bank Account Details to Master Settings

  1. Changes to `master_settings`
    - `bank_beneficiary_name` (text) - Account holder / beneficiary name
    - `bank_ifsc_code` (text) - IFSC code of the bank branch
    - `bank_account_number` (text) - Bank account number
    - `bank_branch_name` (text) - Branch name (fetched via IFSC API)
    - `bank_name` (text) - Bank name (fetched via IFSC API)
    - `bank_account_type` (text) - Account type: current / savings

  2. Notes
    - All new columns default to empty string so existing rows are unaffected
    - No destructive changes — purely additive
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'master_settings' AND column_name = 'bank_beneficiary_name'
  ) THEN
    ALTER TABLE master_settings ADD COLUMN bank_beneficiary_name text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'master_settings' AND column_name = 'bank_ifsc_code'
  ) THEN
    ALTER TABLE master_settings ADD COLUMN bank_ifsc_code text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'master_settings' AND column_name = 'bank_account_number'
  ) THEN
    ALTER TABLE master_settings ADD COLUMN bank_account_number text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'master_settings' AND column_name = 'bank_branch_name'
  ) THEN
    ALTER TABLE master_settings ADD COLUMN bank_branch_name text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'master_settings' AND column_name = 'bank_name'
  ) THEN
    ALTER TABLE master_settings ADD COLUMN bank_name text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'master_settings' AND column_name = 'bank_account_type'
  ) THEN
    ALTER TABLE master_settings ADD COLUMN bank_account_type text DEFAULT 'current';
  END IF;
END $$;
