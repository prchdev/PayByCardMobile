/*
  # Add API Key Fields to Payment Gateway Settings

  1. Changes
    - Add `test_api_key` column to store test environment API key/App ID
    - Add `test_api_secret` column to store test environment API secret
    - Add `production_api_key` column to store production environment API key/App ID
    - Add `production_api_secret` column to store production environment API secret
    - Migrate existing `app_id` and `secret_key` values based on environment

  2. Migration Strategy
    - For gateways in 'Testing' environment: copy app_id to test_api_key, secret_key to test_api_secret
    - For gateways in 'Production' environment: copy app_id to production_api_key, secret_key to production_api_secret
    - Keep old columns for backward compatibility initially

  3. Notes
    - This allows proper separation of test and production credentials
    - Each gateway can now store both test and production credentials simultaneously
*/

-- Add new columns for API keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'test_api_key'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN test_api_key text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'test_api_secret'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN test_api_secret text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'production_api_key'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN production_api_key text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'production_api_secret'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN production_api_secret text DEFAULT '';
  END IF;
END $$;

-- Migrate existing data based on environment
UPDATE payment_gateway_settings
SET 
  test_api_key = CASE WHEN LOWER(environment) IN ('testing', 'test') THEN COALESCE(app_id, '') ELSE test_api_key END,
  test_api_secret = CASE WHEN LOWER(environment) IN ('testing', 'test') THEN COALESCE(secret_key, '') ELSE test_api_secret END,
  production_api_key = CASE WHEN LOWER(environment) IN ('production', 'prod') THEN COALESCE(app_id, '') ELSE production_api_key END,
  production_api_secret = CASE WHEN LOWER(environment) IN ('production', 'prod') THEN COALESCE(secret_key, '') ELSE production_api_secret END
WHERE app_id IS NOT NULL OR secret_key IS NOT NULL;