/*
  # Create KYC Tables

  This migration creates the tables required for KYC (Know Your Customer) verification.

  ## New Tables

  1. `kyc_pan_verification`
     - `id` (uuid, primary key)
     - `user_id` (uuid, FK to users) - owner
     - `pan_number` (text) - PAN card number
     - `pan_photo_url` (text) - URL of uploaded PAN card photo
     - `status` (text) - 'pending' | 'verification_pending' | 'verified' | 'rejected'
     - `rejection_reason` (text, nullable)
     - `created_at`, `updated_at`

  2. `kyc_address_proof`
     - `id` (uuid, primary key)
     - `user_id` (uuid, FK to users)
     - `address` (text) - full address
     - `city` (text)
     - `state` (text)
     - `pincode` (text)
     - `proof_type` (text) - 'aadhar' | 'passport' | 'voter_id' | 'driving_license'
     - `front_photo_url` (text)
     - `back_photo_url` (text)
     - `status` (text) - 'pending' | 'verification_pending' | 'verified' | 'rejected'
     - `rejection_reason` (text, nullable)
     - `created_at`, `updated_at`

  3. `kyc_business_info`
     - `id` (uuid, primary key)
     - `user_id` (uuid, FK to users)
     - `business_name` (text)
     - `incorporation_number` (text)
     - `gst_number` (text)
     - `incorporation_certificate_url` (text)
     - `gst_certificate_url` (text)
     - `created_at`, `updated_at`

  ## Security
  - RLS enabled on all tables
  - Users can only access their own KYC records

  ## Storage Buckets
  - `kyc-documents` bucket for storing uploaded files
*/

CREATE TABLE IF NOT EXISTS kyc_pan_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pan_number text,
  pan_photo_url text,
  status text NOT NULL DEFAULT 'pending',
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT kyc_pan_status_check CHECK (status IN ('pending', 'verification_pending', 'verified', 'rejected'))
);

CREATE TABLE IF NOT EXISTS kyc_address_proof (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address text,
  city text,
  state text,
  pincode text,
  proof_type text,
  front_photo_url text,
  back_photo_url text,
  status text NOT NULL DEFAULT 'pending',
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT kyc_address_status_check CHECK (status IN ('pending', 'verification_pending', 'verified', 'rejected')),
  CONSTRAINT kyc_proof_type_check CHECK (proof_type IN ('aadhar', 'passport', 'voter_id', 'driving_license'))
);

CREATE TABLE IF NOT EXISTS kyc_business_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name text,
  incorporation_number text,
  gst_number text,
  incorporation_certificate_url text,
  gst_certificate_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE kyc_pan_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_address_proof ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_business_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own pan verification"
  ON kyc_pan_verification FOR SELECT
  TO anon, authenticated
  USING (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can insert own pan verification"
  ON kyc_pan_verification FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can update own pan verification"
  ON kyc_pan_verification FOR UPDATE
  TO anon, authenticated
  USING (user_id = (current_setting('app.current_user_id', true))::uuid)
  WITH CHECK (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can select own address proof"
  ON kyc_address_proof FOR SELECT
  TO anon, authenticated
  USING (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can insert own address proof"
  ON kyc_address_proof FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can update own address proof"
  ON kyc_address_proof FOR UPDATE
  TO anon, authenticated
  USING (user_id = (current_setting('app.current_user_id', true))::uuid)
  WITH CHECK (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can select own business info"
  ON kyc_business_info FOR SELECT
  TO anon, authenticated
  USING (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can insert own business info"
  ON kyc_business_info FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can update own business info"
  ON kyc_business_info FOR UPDATE
  TO anon, authenticated
  USING (user_id = (current_setting('app.current_user_id', true))::uuid)
  WITH CHECK (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE INDEX IF NOT EXISTS idx_kyc_pan_user_id ON kyc_pan_verification(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_address_user_id ON kyc_address_proof(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_business_user_id ON kyc_business_info(user_id);

CREATE OR REPLACE FUNCTION update_kyc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_kyc_pan_updated_at') THEN
    CREATE TRIGGER update_kyc_pan_updated_at
      BEFORE UPDATE ON kyc_pan_verification
      FOR EACH ROW EXECUTE FUNCTION update_kyc_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_kyc_address_updated_at') THEN
    CREATE TRIGGER update_kyc_address_updated_at
      BEFORE UPDATE ON kyc_address_proof
      FOR EACH ROW EXECUTE FUNCTION update_kyc_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_kyc_business_updated_at') THEN
    CREATE TRIGGER update_kyc_business_updated_at
      BEFORE UPDATE ON kyc_business_info
      FOR EACH ROW EXECUTE FUNCTION update_kyc_updated_at();
  END IF;
END $$;
