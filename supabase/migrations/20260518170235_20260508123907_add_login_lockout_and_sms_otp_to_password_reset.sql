/*
  # Add login lockout and SMS OTP to password reset

  1. Changes to `users` table
    - `failed_login_attempts` (int, default 0) — tracks consecutive failed logins
    - `locked_until` (timestamptz, nullable) — account locked until this time after 5 failed attempts

  2. Changes to `user_password_reset_otps` table
    - `mobile_otp` (text, nullable) — separate OTP sent via SMS
    - `mobile_otp_verified` (boolean, default false) — tracks mobile OTP verification
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'failed_login_attempts'
  ) THEN
    ALTER TABLE users ADD COLUMN failed_login_attempts integer DEFAULT 0 NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'locked_until'
  ) THEN
    ALTER TABLE users ADD COLUMN locked_until timestamptz DEFAULT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_password_reset_otps' AND column_name = 'mobile_otp'
  ) THEN
    ALTER TABLE user_password_reset_otps ADD COLUMN mobile_otp text DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_password_reset_otps' AND column_name = 'mobile_otp_verified'
  ) THEN
    ALTER TABLE user_password_reset_otps ADD COLUMN mobile_otp_verified boolean DEFAULT false NOT NULL;
  END IF;
END $$;