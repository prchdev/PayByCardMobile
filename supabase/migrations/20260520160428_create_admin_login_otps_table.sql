/*
  # Create Admin Login OTPs Table (2FA)

  1. New Tables
    - `admin_login_otps`
      - `id` (uuid, primary key)
      - `admin_id` (uuid, references admin_users)
      - `email` (text)
      - `otp` (text, 6-digit code)
      - `is_used` (boolean, default false)
      - `expires_at` (timestamptz, 10 minute validity)
      - `created_at` (timestamptz)
      - `used_at` (timestamptz, nullable)

  2. Security
    - Enable RLS — no direct access, only via service role Edge Functions

  3. Notes
    - Used for login 2FA: after credentials pass, OTP is emailed
    - OTP expires after 10 minutes and can only be used once
*/

CREATE TABLE IF NOT EXISTS admin_login_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  email text NOT NULL,
  otp text NOT NULL,
  is_used boolean DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  used_at timestamptz
);

ALTER TABLE admin_login_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to admin login OTPs"
  ON admin_login_otps
  FOR ALL
  TO authenticated
  USING (false);

CREATE INDEX IF NOT EXISTS idx_admin_login_otps_email ON admin_login_otps(email);
CREATE INDEX IF NOT EXISTS idx_admin_login_otps_admin_id ON admin_login_otps(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_login_otps_expires_at ON admin_login_otps(expires_at);
