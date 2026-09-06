/*
  # Add login tracking columns to users table

  1. Changes
    - `users` table
      - `last_login_at` (timestamptz) — timestamp of the most recent successful login
      - `last_login_ip` (text) — IP address recorded at the most recent successful login

  2. Notes
    - Both columns are nullable; existing rows remain unaffected
    - Populated by login-user (for already-verified accounts) and verify-otp (first-time verification)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'last_login_at'
  ) THEN
    ALTER TABLE users ADD COLUMN last_login_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'last_login_ip'
  ) THEN
    ALTER TABLE users ADD COLUMN last_login_ip text;
  END IF;
END $$;
