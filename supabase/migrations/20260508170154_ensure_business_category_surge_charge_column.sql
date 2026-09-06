/*
  # Ensure business_category_surge_charge column exists in kyc_business_info

  Column already exists but adding a default value of 0 if not already set.
  This is a safe no-op if the column is already correctly defined.
*/
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_business_info' AND column_name = 'business_category_surge_charge'
  ) THEN
    -- Set default for existing column
    ALTER TABLE kyc_business_info ALTER COLUMN business_category_surge_charge SET DEFAULT 0;
  END IF;
END $$;
