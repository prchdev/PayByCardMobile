/*
  # Add Company Type and Document Fields to KYC Business Info

  1. Modified Tables
    - `kyc_business_info`
      - Added `company_type` (text) - Type of company (Sole Proprietorship, Partnership, LLP, etc.)
      - Added `loa_url` (text) - Letter of Authorization document URL
      - Added `moa_url` (text) - Memorandum of Association document URL
      - Added `aoa_url` (text) - Articles of Association document URL
      - Added `business_category_surge_charge` (numeric, default 0) - Surge charge percentage for business category

  2. Notes
    - LoA is mandatory for business info submission
    - MoA and AoA are required only for Private Limited Company and OPC
    - business_category_surge_charge is set by admin during approval
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'company_type'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN company_type text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'loa_url'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN loa_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'moa_url'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN moa_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'aoa_url'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN aoa_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'business_category_surge_charge'
  ) THEN
    ALTER TABLE kyc_business_info ADD COLUMN business_category_surge_charge numeric DEFAULT 0 NOT NULL;
  END IF;
END $$;