/*
  # Add Approval Audit Columns to Business Info Table

  1. Changes
    - Add `approved_by_admin_id` column to track which admin approved/rejected
    - Add `approval_at` column to track when the approval/rejection happened
    - Add `approval_ip` column to track the IP address of the approval action
  
  2. Notes
    - These columns match the structure of kyc_pan_verification and kyc_address_proof tables
    - All columns are nullable since they only have values after admin review
    - This ensures consistency across all KYC tables for audit purposes
*/

-- Add approval audit columns to kyc_business_info table
DO $$
BEGIN
  -- Add approved_by_admin_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'approved_by_admin_id'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN approved_by_admin_id uuid REFERENCES auth.users(id);
  END IF;

  -- Add approval_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'approval_at'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN approval_at timestamptz;
  END IF;

  -- Add approval_ip column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'approval_ip'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN approval_ip text;
  END IF;
END $$;
