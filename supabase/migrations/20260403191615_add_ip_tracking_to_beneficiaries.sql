/*
  # Add IP address and timestamp tracking to beneficiaries

  1. Changes
    - Add `created_ip` column to store IP address when beneficiary is added
    - Add `created_timestamp` column to store exact timestamp when beneficiary is added
    - Add `updated_ip` column to store IP address when beneficiary is last updated
    - Add `updated_timestamp` column to store exact timestamp when beneficiary is last updated

  2. Notes
    - These fields will help track when and from where beneficiaries are added/modified
    - IP addresses stored as text to accommodate both IPv4 and IPv6
    - Timestamps provide audit trail for compliance and security
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beneficiaries' AND column_name = 'created_ip'
  ) THEN
    ALTER TABLE beneficiaries ADD COLUMN created_ip text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beneficiaries' AND column_name = 'created_timestamp'
  ) THEN
    ALTER TABLE beneficiaries ADD COLUMN created_timestamp timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beneficiaries' AND column_name = 'updated_ip'
  ) THEN
    ALTER TABLE beneficiaries ADD COLUMN updated_ip text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beneficiaries' AND column_name = 'updated_timestamp'
  ) THEN
    ALTER TABLE beneficiaries ADD COLUMN updated_timestamp timestamptz DEFAULT now();
  END IF;
END $$;
