/*
  # Add Audit Fields to KYC Tables

  ## Summary
  Adds comprehensive audit tracking fields to all KYC verification tables for compliance and traceability.

  ## Changes

  ### kyc_pan_verification
  - `uploaded_at` - Timestamp when PAN document was uploaded
  - `upload_ip` - IP address of the client that uploaded the document
  - `approved_by_admin_id` - Admin user ID who approved/rejected the KYC
  - `approval_at` - Timestamp of the approval/rejection action
  - `approval_ip` - IP address of the admin computer during approval

  ### kyc_address_proof
  - Same five audit columns as above

  ### kyc_business_info
  - `uploaded_at` - Timestamp when business documents were uploaded
  - `upload_ip` - IP address of the client that uploaded the documents

  ## Security
  - No changes to existing RLS policies; new columns are covered by existing row-level rules
  - `approved_by_admin_id` and `approval_ip` are only writable via service role (edge functions)
*/

DO $$
BEGIN
  -- kyc_pan_verification audit columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_pan_verification' AND column_name = 'uploaded_at') THEN
    ALTER TABLE kyc_pan_verification ADD COLUMN uploaded_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_pan_verification' AND column_name = 'upload_ip') THEN
    ALTER TABLE kyc_pan_verification ADD COLUMN upload_ip text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_pan_verification' AND column_name = 'approved_by_admin_id') THEN
    ALTER TABLE kyc_pan_verification ADD COLUMN approved_by_admin_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_pan_verification' AND column_name = 'approval_at') THEN
    ALTER TABLE kyc_pan_verification ADD COLUMN approval_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_pan_verification' AND column_name = 'approval_ip') THEN
    ALTER TABLE kyc_pan_verification ADD COLUMN approval_ip text;
  END IF;

  -- kyc_address_proof audit columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_address_proof' AND column_name = 'uploaded_at') THEN
    ALTER TABLE kyc_address_proof ADD COLUMN uploaded_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_address_proof' AND column_name = 'upload_ip') THEN
    ALTER TABLE kyc_address_proof ADD COLUMN upload_ip text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_address_proof' AND column_name = 'approved_by_admin_id') THEN
    ALTER TABLE kyc_address_proof ADD COLUMN approved_by_admin_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_address_proof' AND column_name = 'approval_at') THEN
    ALTER TABLE kyc_address_proof ADD COLUMN approval_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_address_proof' AND column_name = 'approval_ip') THEN
    ALTER TABLE kyc_address_proof ADD COLUMN approval_ip text;
  END IF;

  -- kyc_business_info audit columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_business_info' AND column_name = 'uploaded_at') THEN
    ALTER TABLE kyc_business_info ADD COLUMN uploaded_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_business_info' AND column_name = 'upload_ip') THEN
    ALTER TABLE kyc_business_info ADD COLUMN upload_ip text;
  END IF;
END $$;
