/*
  # Create Master Settings Table

  1. New Tables
    - `master_settings`
      - `id` (uuid, primary key)
      - `company_name` (text) - Company name for billing
      - `address` (text) - Company address
      - `cin` (text) - Company Identification Number
      - `gst_number` (text) - GST Number
      - `pan` (text) - PAN number
      - `tan` (text) - TAN number
      - `company_logo_url` (text) - URL to uploaded logo
      - `website_url` (text) - Company website
      - `support_email` (text) - Support email
      - `phone_number` (text) - Contact phone
      - `updated_by` (uuid) - Last admin who updated
      - `updated_at` (timestamptz) - Last update timestamp
      - `created_at` (timestamptz) - Creation timestamp

  2. Security
    - Enable RLS on `master_settings` table
    - Add policy for service role access only
*/

CREATE TABLE IF NOT EXISTS master_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text DEFAULT '',
  address text DEFAULT '',
  cin text DEFAULT '',
  gst_number text DEFAULT '',
  pan text DEFAULT '',
  tan text DEFAULT '',
  company_logo_url text DEFAULT '',
  website_url text DEFAULT '',
  support_email text DEFAULT '',
  phone_number text DEFAULT '',
  updated_by uuid REFERENCES admin_users(id),
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE master_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage master settings"
  ON master_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);