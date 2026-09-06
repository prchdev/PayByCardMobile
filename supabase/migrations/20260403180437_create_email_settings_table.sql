/*
  # Create Email Settings Table

  1. New Tables
    - `email_settings`
      - `id` (uuid, primary key) - Unique identifier
      - `from_email` (text) - Sender email address
      - `from_display_name` (text) - Display name for sender
      - `smtp_username` (text) - SMTP authentication username
      - `smtp_password` (text) - Encrypted SMTP password
      - `smtp_server` (text) - SMTP server hostname
      - `smtp_port` (integer) - SMTP server port
      - `use_tls` (boolean) - Enable TLS/SSL encryption
      - `is_active` (boolean) - Whether this configuration is active
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp
      - `updated_by` (uuid) - Admin who last updated the settings

  2. Security
    - Enable RLS on `email_settings` table
    - Only service role can access email settings (no public access)
    - Settings are managed exclusively through Edge Functions

  3. Important Notes
    - Only one active configuration should exist at a time
    - SMTP password should be encrypted before storage
    - This table is only accessible via Edge Functions with service role
*/

-- Create email_settings table
CREATE TABLE IF NOT EXISTS email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email text NOT NULL,
  from_display_name text NOT NULL,
  smtp_username text NOT NULL,
  smtp_password text NOT NULL,
  smtp_server text NOT NULL,
  smtp_port integer NOT NULL DEFAULT 587,
  use_tls boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;

-- Create policy that restricts all access (only service role via Edge Functions)
CREATE POLICY "Email settings accessible only via service role"
  ON email_settings
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_email_settings_active ON email_settings(is_active) WHERE is_active = true;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_email_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_email_settings_updated_at
  BEFORE UPDATE ON email_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_email_settings_updated_at();