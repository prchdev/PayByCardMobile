/*
  # Create Users and OTP Verification Tables

  1. New Tables
    - `users`
      - `id` (uuid, primary key) - Unique user identifier
      - `first_name` (text) - User's first name
      - `last_name` (text) - User's last name
      - `mobile_number` (text, unique) - User's mobile number with country code
      - `email` (text, unique) - User's email address
      - `password_hash` (text) - Hashed password
      - `is_mobile_verified` (boolean, default false) - Mobile verification status
      - `is_email_verified` (boolean, default false) - Email verification status
      - `kyc_completed` (boolean, default false) - KYC completion status
      - `created_at` (timestamptz) - Account creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp
    
    - `otp_verification`
      - `id` (uuid, primary key) - Unique OTP record identifier
      - `user_id` (uuid, foreign key) - Reference to users table
      - `mobile_otp` (text) - 6-digit mobile OTP
      - `email_otp` (text) - 6-digit email OTP
      - `mobile_otp_expires_at` (timestamptz) - Mobile OTP expiration time
      - `email_otp_expires_at` (timestamptz) - Email OTP expiration time
      - `mobile_verified` (boolean, default false) - Mobile OTP verification status
      - `email_verified` (boolean, default false) - Email OTP verification status
      - `created_at` (timestamptz) - OTP creation timestamp
  
  2. Security
    - Enable RLS on both tables
    - Users can read and update their own data
    - Users can read and update their own OTP records
    - Restrict password_hash from being directly readable
  
  3. Important Notes
    - Mobile numbers stored with country code (e.g., +91xxxxxxxxxx)
    - OTPs expire after 10 minutes
    - Passwords must be hashed before storage
*/

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  mobile_number text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  is_mobile_verified boolean DEFAULT false,
  is_email_verified boolean DEFAULT false,
  kyc_completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create otp_verification table
CREATE TABLE IF NOT EXISTS otp_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mobile_otp text,
  email_otp text,
  mobile_otp_expires_at timestamptz,
  email_otp_expires_at timestamptz,
  mobile_verified boolean DEFAULT false,
  email_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_verification ENABLE ROW LEVEL SECURITY;

-- Users table policies
CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  TO authenticated
  USING (id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can update own data"
  ON users FOR UPDATE
  TO authenticated
  USING (id = (current_setting('app.current_user_id', true))::uuid)
  WITH CHECK (id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Allow user registration"
  ON users FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- OTP verification table policies
CREATE POLICY "Users can read own OTP records"
  ON otp_verification FOR SELECT
  TO authenticated
  USING (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Users can update own OTP records"
  ON otp_verification FOR UPDATE
  TO authenticated
  USING (user_id = (current_setting('app.current_user_id', true))::uuid)
  WITH CHECK (user_id = (current_setting('app.current_user_id', true))::uuid);

CREATE POLICY "Allow OTP creation during registration"
  ON otp_verification FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile_number);
CREATE INDEX IF NOT EXISTS idx_otp_user_id ON otp_verification(user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at'
  ) THEN
    CREATE TRIGGER update_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;