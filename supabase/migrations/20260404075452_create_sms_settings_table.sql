/*
  # Create SMS Settings Tables

  1. New Tables
    - `sms_settings`
      - `id` (uuid, primary key)
      - `send_otp_sms` (boolean) - Enable/disable OTP SMS sending
      - `send_transactional_sms` (boolean) - Enable/disable transactional SMS sending
      - `sender_id` (text) - SMS sender ID
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp
      - `created_by` (uuid, foreign key to admin_users) - Admin who created the record
      - `updated_by` (uuid, foreign key to admin_users) - Admin who last updated the record
      - `created_ip` (text) - IP address of creator
      - `updated_ip` (text) - IP address of last updater
    
    - `sms_provider_settings`
      - `id` (uuid, primary key)
      - `provider_name` (text) - Name of SMS provider (Fast2SMS, MSG91, SMSGatewayHub)
      - `is_enabled` (boolean) - Enable/disable provider
      - `is_default` (boolean) - Set as default provider
      - `api_key` (text) - Provider API key
      - `otp_template_id` (text) - Template ID for OTP messages
      - `transactional_template_id` (text) - Template ID for transactional messages
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp
      - `created_by` (uuid, foreign key to admin_users) - Admin who created the record
      - `updated_by` (uuid, foreign key to admin_users) - Admin who last updated the record
      - `created_ip` (text) - IP address of creator
      - `updated_ip` (text) - IP address of last updater

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated admin users only

  3. Initial Data
    - Create single row in sms_settings with default values
    - Create three rows in sms_provider_settings for Fast2SMS, MSG91, SMSGatewayHub
*/

-- Create sms_settings table
CREATE TABLE IF NOT EXISTS sms_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_otp_sms BOOLEAN DEFAULT true,
  send_transactional_sms BOOLEAN DEFAULT true,
  sender_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES admin_users(id),
  updated_by UUID REFERENCES admin_users(id),
  created_ip TEXT DEFAULT '',
  updated_ip TEXT DEFAULT ''
);

-- Create sms_provider_settings table
CREATE TABLE IF NOT EXISTS sms_provider_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,
  api_key TEXT DEFAULT '',
  otp_template_id TEXT DEFAULT '',
  transactional_template_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES admin_users(id),
  updated_by UUID REFERENCES admin_users(id),
  created_ip TEXT DEFAULT '',
  updated_ip TEXT DEFAULT ''
);

-- Enable RLS
ALTER TABLE sms_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_provider_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for sms_settings
CREATE POLICY "Admin users can view sms settings"
  ON sms_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.is_active = true
    )
  );

CREATE POLICY "Admin users can update sms settings"
  ON sms_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.is_active = true
    )
  );

-- Create policies for sms_provider_settings
CREATE POLICY "Admin users can view sms provider settings"
  ON sms_provider_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.is_active = true
    )
  );

CREATE POLICY "Admin users can update sms provider settings"
  ON sms_provider_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.is_active = true
    )
  );

-- Insert default sms_settings row if none exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sms_settings LIMIT 1) THEN
    INSERT INTO sms_settings (send_otp_sms, send_transactional_sms, sender_id)
    VALUES (true, true, '');
  END IF;
END $$;

-- Insert default SMS providers if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sms_provider_settings WHERE provider_name = 'Fast2SMS') THEN
    INSERT INTO sms_provider_settings (provider_name, is_enabled, is_default)
    VALUES ('Fast2SMS', false, false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sms_provider_settings WHERE provider_name = 'MSG91') THEN
    INSERT INTO sms_provider_settings (provider_name, is_enabled, is_default)
    VALUES ('MSG91', false, false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sms_provider_settings WHERE provider_name = 'SMSGatewayHub') THEN
    INSERT INTO sms_provider_settings (provider_name, is_enabled, is_default)
    VALUES ('SMSGatewayHub', false, false);
  END IF;
END $$;