/*
  # Create Admin Password Reset System

  1. New Tables
    - `admin_password_reset_otps`
      - `id` (uuid, primary key)
      - `admin_id` (uuid, references admin_users)
      - `email` (text)
      - `otp` (text, 6-digit code)
      - `is_verified` (boolean, default false)
      - `expires_at` (timestamptz, 10 minutes validity)
      - `created_at` (timestamptz)
      - `verified_at` (timestamptz, nullable)
  
  2. Security
    - Enable RLS on admin_password_reset_otps table
    - No direct access policies (only via Edge Functions with service role)
  
  3. Notes
    - OTPs expire after 10 minutes
    - Only unverified OTPs can be used for password reset
    - After verification, admin can reset password within the same session
*/

CREATE TABLE IF NOT EXISTS admin_password_reset_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  email text NOT NULL,
  otp text NOT NULL,
  is_verified boolean DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  verified_at timestamptz
);

ALTER TABLE admin_password_reset_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to admin password reset OTPs"
  ON admin_password_reset_otps
  FOR ALL
  TO authenticated
  USING (false);

CREATE INDEX IF NOT EXISTS idx_admin_password_reset_otps_email ON admin_password_reset_otps(email);
CREATE INDEX IF NOT EXISTS idx_admin_password_reset_otps_admin_id ON admin_password_reset_otps(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_password_reset_otps_expires_at ON admin_password_reset_otps(expires_at);
