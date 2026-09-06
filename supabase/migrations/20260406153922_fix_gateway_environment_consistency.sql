/*
  # Fix Gateway Environment Consistency

  1. Changes
    - Update all existing payment_gateway_settings records to use lowercase environment values
    - Add check constraint to payment_gateway_settings.environment column
    - Ensure consistency between payment_gateway_settings and payments tables
  
  2. Security
    - No RLS changes needed (constraint only)
*/

-- Update existing records: "Testing" -> "test"
UPDATE payment_gateway_settings 
SET environment = 'test'
WHERE lower(environment) = 'testing';

-- Update any "Production" variants to "production"
UPDATE payment_gateway_settings 
SET environment = 'production'
WHERE lower(environment) = 'production' AND environment != 'production';

-- Add check constraint to payment_gateway_settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'payment_gateway_settings_environment_check'
  ) THEN
    ALTER TABLE payment_gateway_settings 
    ADD CONSTRAINT payment_gateway_settings_environment_check 
    CHECK (environment IN ('test', 'production'));
  END IF;
END $$;
