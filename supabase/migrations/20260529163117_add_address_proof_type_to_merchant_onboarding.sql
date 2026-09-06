/*
  # Add address_proof_type to merchant_onboarding

  Adds a column to record which document type was used as address proof
  during DigiLocker KYC (aadhar, passport, voter_id, driving_license).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'address_proof_type'
  ) THEN
    ALTER TABLE merchant_onboarding
      ADD COLUMN address_proof_type text DEFAULT 'aadhar';
  END IF;
END $$;
