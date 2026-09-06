/*
  # Add status and rejection_reason to kyc_business_info

  ## Changes
  1. Modified Tables
     - `kyc_business_info`
       - Add `status` (text, default 'pending') — tracks approval state: pending, verification_pending, verified, rejected
       - Add `rejection_reason` (text, nullable) — admin-set reason when status is rejected

  ## Notes
  - Existing rows will default to 'pending' status
  - Constraint mirrors the pattern used in kyc_pan_verification and kyc_address_proof
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'status'
  ) THEN
    ALTER TABLE kyc_business_info
      ADD COLUMN status text NOT NULL DEFAULT 'pending',
      ADD CONSTRAINT kyc_business_status_check CHECK (status IN ('pending', 'verification_pending', 'verified', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN rejection_reason text;
  END IF;
END $$;
