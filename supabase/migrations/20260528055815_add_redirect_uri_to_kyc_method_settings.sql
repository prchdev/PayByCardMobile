/*
  # Add Redirect URI fields to kyc_method_settings

  ## Summary
  Adds redirect_uri fields for both test and production environments to the
  kyc_method_settings table. The APISetu DigiLocker OAuth 2.0 flow requires
  a redirect_uri that must be pre-registered in the DigiLocker Partner Portal.
  This URI is used in the authorization code flow and must match exactly.

  ## Modified Table: kyc_method_settings

  ### New Columns
  - `test_redirect_uri` (text) — Callback URL registered in DigiLocker Partner Portal for test environment
  - `production_redirect_uri` (text) — Callback URL registered in DigiLocker Partner Portal for production environment

  ## Notes
  - The redirect_uri must match exactly what is registered in the DigiLocker/APISetu Partner Portal
  - Used in OAuth 2.0 authorization code flow: /oauth2/1/authorize and /oauth2/2/token endpoints
  - Required for both DigiLocker direct and CashFree DigiLocker providers
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_method_settings' AND column_name = 'test_redirect_uri'
  ) THEN
    ALTER TABLE kyc_method_settings ADD COLUMN test_redirect_uri text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_method_settings' AND column_name = 'production_redirect_uri'
  ) THEN
    ALTER TABLE kyc_method_settings ADD COLUMN production_redirect_uri text NOT NULL DEFAULT '';
  END IF;
END $$;
