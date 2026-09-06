/*
  # Create Payment Gateway Settings Table

  1. New Tables
    - `payment_gateway_settings`
      - `id` (uuid, primary key) - Unique identifier for each gateway configuration
      - `gateway_name` (text) - Name of the payment gateway (RazorPay, CashFree, PayU, etc.)
      - `environment` (text) - Environment type (Production/Testing)
      - `is_enabled` (boolean) - Whether the gateway is enabled
      - `app_id` (text) - Application ID for the gateway
      - `secret_key` (text) - Secret key for the gateway (encrypted in production)
      - `supported_cards` (jsonb) - Array of supported card types
      - `instant_settlement_cards` (jsonb) - Array of cards with instant settlement
      - `default_payment_cards` (jsonb) - Array of cards set as default for this gateway
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record last update timestamp
      - `created_by` (uuid) - Admin user who created the record
      - `updated_by` (uuid) - Admin user who last updated the record

  2. Security
    - Enable RLS on `payment_gateway_settings` table
    - Add policies for authenticated admin users to manage gateway settings
    - Only admins can view and modify gateway configurations

  3. Notes
    - Card types supported: Visa, MasterCard, Rupay, American Express, Dinner Club
    - Only one gateway can have default payment cards at a time
    - Gateway names: RazorPay, CashFree, PayU, EaseBuzz, EnKash, ZaakPay, CCAvenue
*/

CREATE TABLE IF NOT EXISTS payment_gateway_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_name text NOT NULL,
  environment text NOT NULL DEFAULT 'Testing',
  is_enabled boolean NOT NULL DEFAULT false,
  app_id text DEFAULT '',
  secret_key text DEFAULT '',
  supported_cards jsonb DEFAULT '[]'::jsonb,
  instant_settlement_cards jsonb DEFAULT '[]'::jsonb,
  default_payment_cards jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT unique_gateway_name UNIQUE (gateway_name)
);

ALTER TABLE payment_gateway_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view gateway settings"
  ON payment_gateway_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.email LIKE '%@admin.%'
    )
  );

CREATE POLICY "Admins can insert gateway settings"
  ON payment_gateway_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.email LIKE '%@admin.%'
    )
  );

CREATE POLICY "Admins can update gateway settings"
  ON payment_gateway_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.email LIKE '%@admin.%'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.email LIKE '%@admin.%'
    )
  );

CREATE POLICY "Admins can delete gateway settings"
  ON payment_gateway_settings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.email LIKE '%@admin.%'
    )
  );

-- Insert default gateway configurations
INSERT INTO payment_gateway_settings (gateway_name, environment, is_enabled) VALUES
  ('RazorPay', 'Testing', false),
  ('CashFree', 'Testing', false),
  ('PayU', 'Testing', false),
  ('EaseBuzz', 'Testing', false),
  ('EnKash', 'Testing', false),
  ('ZaakPay', 'Testing', false),
  ('CCAvenue', 'Testing', false)
ON CONFLICT (gateway_name) DO NOTHING;