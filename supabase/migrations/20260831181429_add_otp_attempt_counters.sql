ALTER TABLE otp_verification ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE user_password_reset_otps ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE admin_login_otps ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;