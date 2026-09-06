/*
  # Create user password reset OTPs table

  1. New Table
    - `user_password_reset_otps`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `email` (text) - email address for quick lookup
      - `otp` (text) - the 6-digit OTP
      - `is_verified` (boolean, default false)
      - `expires_at` (timestamptz) - OTP expiry
      - `created_at` (timestamptz)
      - `verified_at` (timestamptz, nullable)

  2. Security
    - Enable RLS
    - Service role only (all operations done via edge functions with service key)

  3. Notes
    - One active OTP per user at a time (enforced by DELETE before INSERT in functions)
    - Mirrors admin_password_reset_otps pattern
*/

CREATE TABLE IF NOT EXISTS user_password_reset_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  otp text NOT NULL,
  is_verified boolean DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  verified_at timestamptz
);

ALTER TABLE user_password_reset_otps ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_user_pwd_reset_otps_user_id ON user_password_reset_otps(user_id);
CREATE INDEX IF NOT EXISTS idx_user_pwd_reset_otps_email ON user_password_reset_otps(email);