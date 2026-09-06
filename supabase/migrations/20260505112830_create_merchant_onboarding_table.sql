/*
  # Create Merchant Onboarding Table

  1. New Tables
    - `merchant_onboarding`
      - `id` (uuid, primary key)
      - `token` (text, unique) - Unique access token for public link
      - `payment_id` (uuid) - Reference to payment that triggered this
      - `sender_name` (text) - Name of person who sent money
      - `category_name` (text) - Payment category
      - `beneficiary_bank_account` (text) - Bank account number of receiver
      - `beneficiary_ifsc` (text) - IFSC of receiver
      - `beneficiary_name` (text) - Name of beneficiary
      - `email` (text) - Merchant's email
      - `mobile` (text) - Merchant's mobile
      - `pan_number` (text) - PAN number
      - `pan_photo_url` (text) - Uploaded PAN photo
      - `status` (text) - pending, verified, expired, refunded
      - `expires_at` (timestamptz) - When the link expires
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Service role access only
*/

CREATE TABLE IF NOT EXISTS merchant_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  payment_id uuid,
  sender_name text DEFAULT '',
  category_name text DEFAULT '',
  beneficiary_bank_account text DEFAULT '',
  beneficiary_ifsc text DEFAULT '',
  beneficiary_name text DEFAULT '',
  email text DEFAULT '',
  mobile text DEFAULT '',
  pan_number text DEFAULT '',
  pan_photo_url text DEFAULT '',
  status text DEFAULT 'pending' NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE merchant_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage merchant onboarding"
  ON merchant_onboarding
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);