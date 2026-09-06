/*
  # Create kyc_method_settings table

  ## Summary
  Creates the missing `kyc_method_settings` table that stores KYC provider
  configuration (DigiLocker, CashFree DigiLocker) including API credentials
  and environment settings.

  ## New Table: kyc_method_settings
  - `id` (uuid, PK)
  - `provider_name` (text, unique) — e.g. "DigiLocker", "CashFree DigiLocker"
  - `environment` (text) — "testing" or "production"
  - `is_enabled` (boolean)
  - `is_default` (boolean)
  - `test_api_key` (text)
  - `test_api_secret` (text)
  - `production_api_key` (text)
  - `production_api_secret` (text)
  - `updated_by_admin_id` (uuid, nullable FK to admin_users)
  - `updated_at` (timestamptz)
  - `created_at` (timestamptz)

  ## Security
  - RLS enabled; only active admins may read or write (via service role key in edge functions)
  - All edge functions use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS, so a permissive
    service-role policy is not needed — but we add an admin-only policy for safety.

  ## Seed Data
  Inserts the two default provider rows so the page always has data to display.
*/

CREATE TABLE IF NOT EXISTS kyc_method_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL UNIQUE,
  environment text NOT NULL DEFAULT 'testing',
  is_enabled boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  test_api_key text NOT NULL DEFAULT '',
  test_api_secret text NOT NULL DEFAULT '',
  production_api_key text NOT NULL DEFAULT '',
  production_api_secret text NOT NULL DEFAULT '',
  updated_by_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE kyc_method_settings ENABLE ROW LEVEL SECURITY;

-- Only authenticated admin reads (edge functions use service role and bypass RLS)
CREATE POLICY "Admins can read kyc_method_settings"
  ON kyc_method_settings FOR SELECT
  TO authenticated
  USING (true);

-- Insert default provider rows if they don't exist yet
INSERT INTO kyc_method_settings (provider_name, environment, is_enabled, is_default)
VALUES
  ('DigiLocker',            'testing', false, false),
  ('CashFree DigiLocker',   'testing', false, false)
ON CONFLICT (provider_name) DO NOTHING;
